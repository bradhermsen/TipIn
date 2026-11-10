import { api, ApiError, getSession } from "./api.js";
import { $, esc, modal, toast, formatGameTime, positionLabel, needsLineup } from "./ui.js";
import { teamHeader, wireTabs } from "./team.js";

export async function renderGames(app, teamId, navigate) {
  app.innerHTML = `<p class="muted">Loading games…</p>`;
  const header = await teamHeader(teamId, "games");
  let games;
  try {
    games = await api(`/coach/teams/${teamId}/games`);
  } catch (err) {
    app.innerHTML = header + `<div class="msg error">${esc(err.message)}</div>`;
    wireTabs(app, navigate);
    return;
  }
  app.innerHTML = header + (games.length
    ? games.map((g) => `<a class="card" href="/teams/${esc(teamId)}/games/${esc(g.gameId)}" data-link>
        <div class="row spread"><b>${g.isHome ? "vs" : "at"} ${esc(g.opponentDisplayName)}</b>
          ${g.locked ? `<span class="pill locked">Signed</span>` : needsLineup(g) ? `<span class="pill live">Needs lineup</span>` : ""}</div>
        <div class="muted small">${esc(formatGameTime(g.gameDateTime))}</div></a>`).join("")
    : `<div class="card muted">No games in the next 60 days.</div>`);
  wireTabs(app, navigate);
}

export async function renderLineup(app, teamId, gameId, navigate) {
  app.innerHTML = `<p class="muted">Loading lineup…</p>`;
  let roster, state, managerAccess;
  try {
    [roster, state, managerAccess] = await Promise.all([
      api(`/coach/teams/${teamId}/roster`),
      api(`/coach/games/${gameId}/teams/${teamId}/lineup`),
      api(`/coach/games/${gameId}/teams/${teamId}/game-manager-access`),
    ]);
    validateState(state);
  } catch (err) {
    if (err.status === 401 && !getSession()) return;
    app.innerHTML = `<div class="msg error">${esc(err.message)}</div><a href="/teams/${esc(teamId)}/games" data-link>‹ Games</a>`;
    return;
  }
  roster.sort((a, b) => (a.jerseyNumber ?? 999) - (b.jerseyNumber ?? 999) || a.lastName.localeCompare(b.lastName));

  const rosterIds = new Set(roster.map((p) => p.playerId));
  let participants = new Set(state.participantIds.filter((id) => rosterIds.has(id)));
  let starters = new Set(state.starterIds.filter((id) => participants.has(id)));
  let dirty = false;

  const isGoalie = (p) => (p.position || "").toUpperCase() === "G" || p.isGoalie;
  const need = state.isVarsity ? "Varsity: pick exactly 6 starters, including a goalie." : "Pick your starters, including a goalie.";

  function draw(banner = "") {
    const locked = state.locked;
    app.innerHTML = `<a class="small" href="/teams/${esc(teamId)}/games" data-link>‹ Games</a>
      <h1>Game lineup</h1>
      ${managerAccess.code ? `<button type="button" class="link-btn gm-access-link" id="view-gm-code" aria-haspopup="dialog">View Game Manager Access Code</button>
        <dialog class="gm-access-dialog" id="gm-access-dialog" aria-labelledby="gm-access-title" aria-describedby="gm-access-description">
          <h2 id="gm-access-title">Game Manager Access</h2>
          <p id="gm-access-description">Use this code in the Game Manager app.</p>
          <div class="row"><strong id="gm-code">${esc(managerAccess.code)}</strong> <button type="button" class="secondary" id="copy-gm-code">Copy code</button></div>
          <p class="small muted">Share only with your authorized scorekeeper. Existing game-day access rules apply.</p>
          <p id="gm-copy-status" class="small" role="status"></p>
          <button type="button" class="secondary" id="close-gm-code">Close</button>
        </dialog>` : ""}
      ${locked ? `<div class="msg ok"><b>Signed and locked</b> by ${esc(state.signedBy || "coach")}${state.signedAtUtc ? " on " + esc(new Date(/Z$/i.test(state.signedAtUtc) ? state.signedAtUtc : state.signedAtUtc + "Z").toLocaleString()) : ""}.
        To change it, email <a href="mailto:info@tipinscoring.com">info@tipinscoring.com</a> to unlock it.</div>` : `<p class="muted small">${esc(need)}</p>`}
      <div id="banner">${banner}</div>
      <div class="card">
        <div class="lineup-head small muted"><span>Player</span><span>Active</span><span>Starting</span></div>
        ${roster.length ? roster.map((p) => `
          <div class="lineup-row">
            <div class="jersey">${p.jerseyNumber ?? "–"}</div>
            <div class="who">${esc(p.firstName)} ${esc(p.lastName)}<div class="muted small">${esc(positionLabel(isGoalie(p) ? "G" : p.position))}</div></div>
            <button type="button" class="toggle" data-play="${esc(p.playerId)}" aria-pressed="${participants.has(p.playerId)}" ${locked ? "disabled" : ""}>${participants.has(p.playerId) ? "Active" : "Inactive"}</button>
            <button type="button" class="toggle starter" data-start="${esc(p.playerId)}" aria-pressed="${starters.has(p.playerId)}" ${locked || !participants.has(p.playerId) ? "disabled" : ""}>Start</button>
          </div>`).join("") : `<p class="muted">Add players to your roster first.</p>`}
        <p class="small muted" id="count">${participants.size} active · ${starters.size} starting</p>
      </div>
      ${locked ? "" : `<div class="sticky-actions">
        <button type="button" class="secondary" id="save" ${dirty ? "" : "disabled"}>${dirty ? "Save changes" : "Saved"}</button>
        <button type="button" id="sign" ${dirty || !starters.size ? "disabled" : ""}>Sign &amp; lock</button></div>
        ${dirty ? `<p class="small muted">Save your changes before signing.</p>` : ""}`}`;

    const accessDialog = $("#gm-access-dialog", app);
    if (accessDialog) {
      const copyStatus = $("#gm-copy-status", accessDialog);
      $("#view-gm-code", app).addEventListener("click", () => {
        copyStatus.textContent = "";
        accessDialog.showModal();
      });
      $("#close-gm-code", accessDialog).addEventListener("click", () => accessDialog.close());
      accessDialog.addEventListener("click", (event) => {
        if (event.target !== accessDialog) return;
        const bounds = accessDialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom) accessDialog.close();
      });
      $("#copy-gm-code", accessDialog).addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(managerAccess.code);
          copyStatus.textContent = "Code copied.";
        } catch {
          copyStatus.textContent = "Could not copy the code. Select and copy the code above.";
        }
      });
    }
    app.querySelectorAll("[data-play]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.play;
      if (participants.has(id)) { participants.delete(id); starters.delete(id); } else participants.add(id);
      dirty = true; draw();
    }));
    app.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.start;
      starters.has(id) ? starters.delete(id) : starters.add(id);
      dirty = true; draw();
    }));
    if (!locked) {
      $("#save").addEventListener("click", save);
      $("#sign").addEventListener("click", openSign);
    }
  }

  function validateState(s) {
    if (!s || !Array.isArray(s.participantIds) || !Array.isArray(s.starterIds) || !Number.isInteger(s.version)) {
      throw new Error("The server returned an invalid lineup. Your changes have not been cleared. Try again.");
    }
  }

  const applyState = (s) => {
    validateState(s);
    state = s;
    participants = new Set(s.participantIds.filter((id) => rosterIds.has(id)));
    starters = new Set(s.starterIds.filter((id) => participants.has(id)));
    dirty = false;
  };

  function handleConflict(err) {
    if (err.code === "STALE_VERSION") {
      const current = err.data.details.current;
      if (current) applyState(current);
      draw(`<div class="msg warn">Someone else changed this lineup. The latest version is shown; redo your changes if needed.</div>`);
      return true;
    }
    if (err.code === "LINEUP_LOCKED") {
      renderLineup(app, teamId, gameId, navigate);
      return true;
    }
    return false;
  }

  async function save() {
    const btn = $("#save");
    btn.disabled = true;
    try {
      const s = await api(`/coach/games/${gameId}/teams/${teamId}/lineup`, {
        method: "PUT",
        body: { expectedVersion: state.version, participantIds: [...participants], starterIds: [...starters] },
      });
      applyState(s);
      draw();
      toast("Lineup saved");
    } catch (err) {
      if (err instanceof ApiError && handleConflict(err)) return;
      btn.disabled = false;
      $("#banner").innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
    }
  }

  function openSign() {
    const startersList = roster.filter((p) => starters.has(p.playerId))
      .map((p) => `<li>#${p.jerseyNumber ?? "–"} ${esc(p.firstName)} ${esc(p.lastName)}${isGoalie(p) ? " (G)" : ""}</li>`).join("");
    const m = modal(`<h2>Sign &amp; lock lineup</h2>
      <p class="muted">${participants.size} active. Starters:</p><ul>${startersList}</ul>
      <div class="msg warn small">Once signed, the lineup is locked. Only an administrator can unlock it.</div>
      <div id="err"></div>
      <label for="signer">Type your full name to sign</label>
      <input id="signer" type="text" autocomplete="name" />
      <button type="button" class="block" id="confirm">Sign &amp; lock</button>
      <button type="button" class="link-btn" id="cancel">Cancel</button>`);
    $("#cancel", m.el).onclick = m.close;
    $("#confirm", m.el).onclick = async () => {
      const signer = $("#signer", m.el).value.trim();
      if (!signer) return ($("#err", m.el).innerHTML = `<div class="msg error">Enter your name to sign.</div>`);
      const btn = $("#confirm", m.el);
      btn.disabled = true;
      try {
        await api(`/coach/games/${gameId}/teams/${teamId}/lineup/sign`, {
          method: "POST",
          body: { expectedVersion: state.version, signerName: signer, device: navigator.userAgent.slice(0, 120) },
        });
        m.close();
        toast("Lineup signed");
        renderLineup(app, teamId, gameId, navigate);
      } catch (err) {
        btn.disabled = false;
        if (err instanceof ApiError && (err.code === "STALE_VERSION" || err.code === "LINEUP_LOCKED")) {
          m.close();
          renderLineup(app, teamId, gameId, navigate);
          return;
        }
        $("#err", m.el).innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
      }
    };
  }

  draw();
}
