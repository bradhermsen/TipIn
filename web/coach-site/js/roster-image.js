import { api } from "./api.js";
import { $, esc, modal, POSITIONS, toast } from "./ui.js";
import { parseRosterText, validateImportRow, ROSTER_COLUMNS, setRosterColumn } from "./roster-image-parser.js";

let engine;
function loadEngine() {
  if (!engine) engine = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/tesseract/tesseract.min.js";
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => { engine = null; script.remove(); reject(new Error("Could not load local OCR files. Reload the page and try again.")); };
    document.head.appendChild(script);
  });
  return engine;
}

export function openRosterImage(teamId, reload) {
  let worker, imageUrl, closed = false, importing = false, rows = [], changed = false;
  let columns = ROSTER_COLUMNS.map(([field]) => field);
  const m = modal(`<h2>Import roster from image</h2>
    <p class="msg warn"><strong>Beta:</strong> This feature is intended to make importing rosters quicker.
      Corrections will be needed. Review and verify every player's information against the original roster before adding players.</p>
    <p class="muted small">Choose a clear printed roster photo or screenshot (JPEG, PNG, or WebP, up to 10 MB).
      Image recognition runs on this device. The image is not uploaded. Only reviewed player fields are sent when you confirm.</p>
    <label for="roster-image">Roster photo or screenshot</label><input id="roster-image" type="file" accept="image/jpeg,image/png,image/webp" />
    <img id="roster-preview" alt="Selected roster" class="roster-preview" hidden />
    <div id="ocr-status" role="status"></div><div id="import-error" role="alert"></div>
    <label for="ocr-text">Recognized text (correct it before building the preview)</label>
    <textarea id="ocr-text" rows="8"></textarea>
    <p class="small muted">Column order: match the fields to the roster from left to right. Each field can be selected once.</p>
    <div class="grid2" id="roster-columns">${columns.map((field, i) => `<div>
      <label for="roster-column-${i}">Column ${i + 1}</label><select id="roster-column-${i}" data-column="${i}"></select></div>`).join("")}</div>
    <button type="button" class="secondary block" id="build-preview">Review players</button>
    <div id="import-rows"></div>
    <label class="check"><input type="checkbox" id="reviewed" /> I checked every selected player's name and numbers against the image.</label>
    <button type="button" class="block" id="import-players" disabled>Add reviewed players</button>
    <button type="button" class="link-btn" id="close-import">Cancel</button>`);
  const error = (text) => { $("#import-error", m.el).innerHTML = `<div class="msg error">${esc(text)}</div>`; };
  const drawColumns = () => {
    m.el.querySelectorAll("[data-column]").forEach((select, i) => {
      select.innerHTML = ROSTER_COLUMNS.filter(([field]) => !columns.slice(0, i).includes(field))
        .map(([field, label]) => `<option value="${field}" ${columns[i] === field ? "selected" : ""}>${label}</option>`).join("");
      select.onchange = () => {
        columns = setRosterColumn(columns, i, select.value);
        drawColumns();
        rows = [];
        $("#import-rows", m.el).innerHTML = "";
        $("#reviewed", m.el).checked = false;
        $("#import-players", m.el).disabled = true;
      };
    });
  };
  drawColumns();
  const close = () => {
    if (importing) return;
    closed = true;
    if (worker) worker.terminate();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    m.close();
    if (changed) reload();
  };
  // Keep the dialog open until its explicit close action releases OCR resources.
  m.el.parentElement.addEventListener("click", (e) => {
    if (e.target === m.el.parentElement) e.stopImmediatePropagation();
  }, true);
  $("#close-import", m.el).onclick = close;
  $("#roster-image", m.el).onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (imageUrl) { URL.revokeObjectURL(imageUrl); imageUrl = null; }
    $("#roster-preview", m.el).hidden = true;
    $("#import-error", m.el).textContent = "";
    $("#ocr-text", m.el).value = "";
    $("#import-rows", m.el).innerHTML = "";
    rows = [];
    $("#reviewed", m.el).checked = false;
    $("#import-players", m.el).disabled = true;
    let bitmap;
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
        throw new Error("Choose a JPEG, PNG, or WebP image no larger than 10 MB.");
      }
      bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 25000000) throw new Error("Image is too large to read safely. Crop or resize it below 25 megapixels.");
      bitmap.close(); bitmap = null;
      imageUrl = URL.createObjectURL(file);
      $("#roster-preview", m.el).src = imageUrl;
      $("#roster-preview", m.el).hidden = false;
      $("#roster-image", m.el).disabled = true;
      $("#build-preview", m.el).disabled = true;
      $("#ocr-status", m.el).textContent = "Loading local OCR. The first download may take a moment...";
      const tesseract = await loadEngine();
      if (closed) return;
      worker = await tesseract.createWorker("eng", 1, {
        workerPath: "/vendor/tesseract/worker.min.js", corePath: "/vendor/core",
        langPath: "/vendor/eng", workerBlobURL: false,
        logger: (progress) => {
          if (!closed) $("#ocr-status", m.el).textContent = `${progress.status} ${Math.round((progress.progress || 0) * 100)}%`;
        },
      });
      if (closed) { await worker.terminate(); worker = null; return; }
      const { data } = await worker.recognize(file);
      if (!closed) {
        $("#ocr-text", m.el).value = data.text;
        $("#ocr-status", m.el).textContent = data.text.trim()
          ? "Recognition complete. Review the text and all player fields; OCR can misread names and numbers."
          : "No text found. Try a clearer crop or enter roster text manually.";
      }
    } catch (err) {
      if (!closed) error(`Could not read the image: ${err.message}`);
    } finally {
      if (bitmap) bitmap.close();
      if (worker) { await worker.terminate(); worker = null; }
      if (!closed) {
        $("#roster-image", m.el).disabled = false;
        $("#build-preview", m.el).disabled = false;
      }
    }
  };
  const draw = () => {
    $("#import-rows", m.el).innerHTML = rows.map((r, i) => `<section class="card import-player" data-row="${i}">
      <label class="check"><input type="checkbox" data-field="selected" ${r.selected ? "checked" : ""} ${r.done ? "disabled" : ""} /> ${r.done ? "Added" : "Include player"}</label>
      <p class="small muted">Source: ${esc(r.source)}</p>
      <div class="grid2"><div><label>First name<input type="text" data-field="firstName" maxlength="100" value="${esc(r.firstName)}" /></label></div>
      <div><label>Last name<input type="text" data-field="lastName" maxlength="100" value="${esc(r.lastName)}" /></label></div></div>
      <div class="player-details"><div><label>Grade<input type="number" data-field="grade" min="1" max="12" value="${esc(r.grade)}" /></label></div>
      <div><label>Jersey #<input type="number" data-field="jerseyNumber" min="0" max="99" value="${esc(r.jerseyNumber)}" /></label></div>
      <div><label>Position<select data-field="position">${POSITIONS.map(([v, text]) => `<option value="${v}" ${r.position === v ? "selected" : ""}>${text}</option>`).join("")}</select></label></div></div>
      <div data-feedback>${r.message || validateImportRow(r) || !r.grade || !r.jerseyNumber || !r.position
        ? `<div class="msg ${r.done ? "ok" : "warn"}">${esc(r.message || validateImportRow(r) || "Some fields were not recognized. Verify against the image; optional fields may remain blank.")}</div>`
        : `<p class="small muted">Review all fields against the image.</p>`}</div>
    </section>`).join("");
    m.el.querySelectorAll("[data-row]").forEach((box) => {
      const r = rows[Number(box.dataset.row)];
      box.querySelectorAll("[data-field]").forEach((input) => {
        input.disabled = r.done;
        input.onchange = () => {
          r[input.dataset.field] = input.type === "checkbox" ? input.checked : input.value;
          r.confirm = false; r.existingPlayerId = null;
          $("#reviewed", m.el).checked = false; $("#import-players", m.el).disabled = true;
        };
      });
    });
  };
  $("#build-preview", m.el).onclick = () => {
    if (changed) return error("Some players were already added. Close this import and start a new one to read another image.");
    const parsed = parseRosterText($("#ocr-text", m.el).value, columns);
    if (!parsed.length) return error("No player rows found. Add or correct the roster text first.");
    if (parsed.length > 60) return error("Import at most 60 rows at a time. Remove headings and non-player text.");
    rows = parsed.map((r) => ({ ...r, selected: true }));
    $("#reviewed", m.el).checked = false; $("#import-players", m.el).disabled = true;
    $("#import-error", m.el).textContent = "";
    draw();
  };
  $("#reviewed", m.el).onchange = (e) => { $("#import-players", m.el).disabled = !e.target.checked || !rows.some((r) => r.selected && !r.done); };
  $("#import-players", m.el).onclick = async () => {
    const pending = rows.filter((r) => r.selected && !r.done);
    if (!$("#reviewed", m.el).checked || !pending.length) return;
    for (const row of pending) {
      const invalid = validateImportRow(row);
      if (invalid) { row.message = invalid; draw(); return error("Correct the highlighted row before adding players."); }
    }
    importing = true;
    m.el.querySelectorAll("button, input, select, textarea").forEach((el) => { el.disabled = true; });
    $("#import-error", m.el).textContent = "";
    try {
      for (const row of pending) {
        try {
          await api(`/coach/teams/${teamId}/roster`, { method: "POST", body: {
            existingPlayerId: row.existingPlayerId || null,
            firstName: row.firstName.trim(), lastName: row.lastName.trim(),
            grade: row.grade === "" ? null : Number(row.grade),
            jerseyNumber: row.jerseyNumber === "" ? null : Number(row.jerseyNumber),
            position: row.position || null, confirm: !!row.confirm,
          } });
          row.done = true; row.selected = false; row.message = "Added to roster"; changed = true;
        } catch (err) {
          row.message = err.message;
          row.warning = err;
          break;
        }
      }
    } finally {
      importing = false;
      m.el.querySelectorAll("button, input, select, textarea").forEach((el) => { el.disabled = false; });
      draw();
      $("#reviewed", m.el).checked = false;
      $("#import-players", m.el).disabled = true;
      $("#close-import", m.el).textContent = "Done";
      if (changed) {
        for (const id of ["roster-image", "ocr-text", "build-preview"]) $(`#${id}`, m.el).disabled = true;
        m.el.querySelectorAll("[data-column]").forEach((select) => { select.disabled = true; });
      }
    }
    const failed = pending.find((r) => !r.done);
    if (!failed) { toast("Reviewed players added"); return; }
    error("Import paused. Added rows are kept and will not be added again. Resolve this row or uncheck it, review remaining rows, then continue.");
    const box = m.el.querySelector(`[data-row="${rows.indexOf(failed)}"] [data-feedback]`);
    const err = failed.warning;
    if (err.code === "POSSIBLE_DUPLICATE") {
      const matches = err.data.details.matches || [];
      box.innerHTML += `<label>Existing player<select id="existing-match"><option value="">Choose existing player</option>
        ${matches.map((p) => `<option value="${esc(p.playerId)}" ${p.onThisTeam ? "disabled" : ""}>${esc(p.firstName)} ${esc(p.lastName)}${p.onThisTeam ? " (already on roster; uncheck this row)" : ""}</option>`).join("")}</select></label>`;
    }
    if (["POSSIBLE_DUPLICATE", "JERSEY_IN_USE"].includes(err.code)) {
      box.innerHTML += `<label class="check"><input type="checkbox" id="confirm-warning" /> I checked the duplicate/jersey warning and want to add anyway.</label>`;
      $("#confirm-warning", box).onchange = (e) => { failed.confirm = e.target.checked; };
    }
    const existing = $("#existing-match", box);
    if (existing) existing.onchange = (e) => { failed.existingPlayerId = e.target.value || null; failed.confirm = false; };
  };
}
