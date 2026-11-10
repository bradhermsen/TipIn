import { api } from "./api.js";
import { $, esc, modal, toast, POSITIONS, positionLabel } from "./ui.js";
import { teamHeader, wireTabs } from "./team.js";

const positionOptions = (selected) =>
  POSITIONS.map(([v, l]) => `<option value="${v}" ${v === (selected || "") ? "selected" : ""}>${l}</option>`).join("");

const numOrNull = (v) => (String(v).trim() === "" ? null : Number(v));

export async function renderRoster(app, teamId, navigate) {
  app.innerHTML = `<p class="muted">Loading roster…</p>`;
  const header = await teamHeader(teamId, "roster");
  let roster;
  try {
    roster = await api(`/coach/teams/${teamId}/roster`);
  } catch (err) {
    app.innerHTML = header + `<div class="msg error">${esc(err.message)}</div>`;
    wireTabs(app, navigate);
    return;
  }
  roster.sort((a, b) => (a.jerseyNumber ?? 999) - (b.jerseyNumber ?? 999) || a.lastName.localeCompare(b.lastName));

  const reload = () => renderRoster(app, teamId, navigate);

  app.innerHTML = `${header}
    <div class="row spread"><span class="muted">${roster.length} player${roster.length === 1 ? "" : "s"}</span>
      <button type="button" id="add">+ Add player</button></div>
    <div class="card" style="margin-top:12px">
      ${roster.length ? roster.map((p) => `
        <div class="player">
          <div class="jersey">${p.jerseyNumber ?? "–"}</div>
          <div class="name">${esc(p.firstName)} ${esc(p.lastName)}
            <small>${[positionLabel(p.position), p.grade ? "Grade " + p.grade : ""].filter(Boolean).map(esc).join(" · ")}</small></div>
          <button type="button" class="secondary" data-edit="${esc(p.rosterEntryId)}">Edit</button>
        </div>`).join("") : `<p class="muted">No players yet. Add your first player.</p>`}
    </div>`;
  wireTabs(app, navigate);

  $("#add").addEventListener("click", () => openAdd(teamId, reload));
  app.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => openEdit(teamId, roster.find((p) => p.rosterEntryId === b.dataset.edit), reload))
  );
}

// Shows the server's "are you sure" warnings and lets the coach confirm
function warningHtml(err) {
  if (err.code === "POSSIBLE_DUPLICATE") {
    const matches = (err.data.details.matches || [])
      .map((m) => `<li>${esc(m.firstName)} ${esc(m.lastName)}${m.grade ? ` (Grade ${m.grade})` : ""}</li>`)
      .join("");
    return `<div class="msg warn"><b>A player with this name already exists.</b><ul>${matches}</ul>
      Use <b>Search</b> to add the existing player, or add this one as a new player anyway.</div>`;
  }
  return `<div class="msg warn">${esc(err.message)}</div>`;
}

async function submitWithConfirm({ box, run, button, onDone }) {
  const errBox = $("#err", box);
  const go = async (confirm) => {
    button.disabled = true;
    try {
      await run(confirm);
      onDone();
    } catch (err) {
      button.disabled = false;
      if (err.status === 409 && (err.code === "JERSEY_IN_USE" || err.code === "POSSIBLE_DUPLICATE")) {
        errBox.innerHTML = warningHtml(err) + `<button type="button" id="confirm" class="secondary block">Add anyway</button>`;
        $("#confirm", box).onclick = () => go(true);
      } else {
        errBox.innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
      }
    }
  };
  go(false);
}

function openAdd(teamId, reload) {
  const m = modal(`<h2>Add player</h2>
    <label for="q">Search existing players by name</label>
    <div class="row"><input id="q" type="search" placeholder="Last or first name" /><button type="button" id="go">Search</button></div>
    <div id="results"></div>
    <div class="row spread" style="margin-top:12px"><span class="muted small">Not listed?</span>
      <button type="button" class="secondary" id="new">Add a new player</button></div>
    <button type="button" class="link-btn" id="cancel">Cancel</button>`);
  const box = m.el;
  $("#cancel", box).onclick = m.close;
  $("#new", box).onclick = () => { m.close(); openPlayerForm({ teamId, reload }); };

  const search = async () => {
    const q = $("#q", box).value.trim();
    const out = $("#results", box);
    if (q.length < 2) return (out.innerHTML = `<div class="msg warn">Enter at least 2 characters.</div>`);
    out.innerHTML = `<p class="muted">Searching…</p>`;
    try {
      const data = await api(`/coach/teams/${teamId}/player-search?q=${encodeURIComponent(q)}`);
      const list = Array.isArray(data) ? data : data.matches || [];
      out.innerHTML = list.length
        ? list.map((p) => `<div class="player"><div class="jersey">${p.jerseyNumber ?? "–"}</div>
            <div class="name">${esc(p.firstName)} ${esc(p.lastName)}<small>${p.grade ? "Grade " + p.grade : ""}</small></div>
            ${p.onThisTeam ? `<span class="pill">On roster</span>` : `<button type="button" data-pick="${esc(p.playerId)}">Add</button>`}</div>`).join("")
        : `<p class="muted">No matches.</p>`;
      out.querySelectorAll("[data-pick]").forEach((b) =>
        b.addEventListener("click", () => {
          const p = list.find((x) => x.playerId === b.dataset.pick);
          m.close();
          openPlayerForm({ teamId, reload, existing: p });
        })
      );
    } catch (err) {
      out.innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
    }
  };
  $("#go", box).onclick = search;
  $("#q", box).addEventListener("keydown", (e) => e.key === "Enter" && search());
}

// Add (new or existing player) form: names only for brand-new players
function openPlayerForm({ teamId, reload, existing }) {
  const m = modal(`<h2>${existing ? `Add ${esc(existing.firstName)} ${esc(existing.lastName)}` : "New player"}</h2>
    <div id="err"></div>
    <form id="f" novalidate>
      ${existing ? "" : `<div class="grid2"><div><label for="fn">First name</label><input id="fn" type="text" /></div>
        <div><label for="ln">Last name</label><input id="ln" type="text" /></div></div>`}
      <div class="${existing ? "grid2" : "player-details"}">
        ${existing ? "" : `<div><label for="gr">Grade</label><input id="gr" type="number" min="1" max="12" inputmode="numeric" /></div>`}
        <div><label for="jn">Jersey #</label><input id="jn" type="number" min="0" max="99" inputmode="numeric" value="${existing?.jerseyNumber ?? ""}" /></div>
        <div><label for="pos">Position</label><select id="pos">${positionOptions("")}</select></div></div>
      <button type="submit" class="block">Add to roster</button>
      <button type="button" class="link-btn" id="cancel">Cancel</button>
    </form>`);
  const box = m.el;
  $("#cancel", box).onclick = m.close;
  $("#f", box).addEventListener("submit", (e) => {
    e.preventDefault();
    const body = {
      existingPlayerId: existing ? existing.playerId : null,
      firstName: existing ? null : $("#fn", box).value.trim(),
      lastName: existing ? null : $("#ln", box).value.trim(),
      grade: existing ? null : numOrNull($("#gr", box).value),
      jerseyNumber: numOrNull($("#jn", box).value),
      position: $("#pos", box).value || null,
    };
    submitWithConfirm({
      box,
      button: $("#f button[type=submit]", box),
      run: (confirm) => api(`/coach/teams/${teamId}/roster`, { method: "POST", body: { ...body, confirm } }),
      onDone: () => { m.close(); toast("Player added"); reload(); },
    });
  });
}

function openEdit(teamId, p, reload) {
  const m = modal(`<h2>Edit player</h2>
    <div id="err"></div>
    <form id="f" novalidate>
      <div class="grid2"><div><label for="fn">First name</label><input id="fn" type="text" value="${esc(p.firstName)}" /></div>
        <div><label for="ln">Last name</label><input id="ln" type="text" value="${esc(p.lastName)}" /></div></div>
      <label for="gr">Grade</label><input id="gr" type="number" min="1" max="12" inputmode="numeric" value="${p.grade ?? ""}" />
      <div class="grid2"><div><label for="jn">Jersey #</label><input id="jn" type="number" min="0" max="99" inputmode="numeric" value="${p.jerseyNumber ?? ""}" /></div>
        <div><label for="pos">Position</label><select id="pos">${positionOptions(p.position)}</select></div></div>
      <p class="muted small">Name and grade apply to the player everywhere. Jersey and position apply to this team only.</p>
      <button type="submit" class="block">Save</button>
      <button type="button" class="danger block" id="remove">Remove from roster</button>
      <button type="button" class="link-btn" id="cancel">Cancel</button>
    </form>`);
  const box = m.el;
  $("#cancel", box).onclick = m.close;

  $("#f", box).addEventListener("submit", (e) => {
    e.preventDefault();
    submitWithConfirm({
      box,
      button: $("#f button[type=submit]", box),
      run: (confirm) => api(`/coach/teams/${teamId}/roster/${p.rosterEntryId}`, {
        method: "PUT",
        body: {
          firstName: $("#fn", box).value.trim(),
          lastName: $("#ln", box).value.trim(),
          grade: numOrNull($("#gr", box).value),
          jerseyNumber: numOrNull($("#jn", box).value),
          position: $("#pos", box).value || null,
          confirm,
        },
      }),
      onDone: () => { m.close(); toast("Saved"); reload(); },
    });
  });

  $("#remove", box).onclick = async () => {
    if (!confirm(`Remove ${p.firstName} ${p.lastName} from this roster?`)) return;
    try {
      await api(`/coach/teams/${teamId}/roster/${p.rosterEntryId}`, { method: "DELETE" });
      m.close();
      toast("Player removed");
      reload();
    } catch (err) {
      $("#err", box).innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
    }
  };
}
