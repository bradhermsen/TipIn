import { api, getSession } from "./api.js";
import { esc, positionLabel } from "./ui.js";

export const sortRoster = (a, b) =>
  (a.jerseyNumber ?? 999) - (b.jerseyNumber ?? 999)
  || a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);

export function rosterTable(players) {
  return `<div class="roster-table-wrap"><table class="roster-table">
    <thead><tr><th scope="col">Jersey</th><th scope="col">Player</th><th scope="col">Position</th>
      <th scope="col">Grade</th><th scope="col">Status</th></tr></thead><tbody>
    ${[...players].sort(sortRoster).map(p => `<tr>
      <td>${esc(p.jerseyNumber ?? "-")}</td><td>${esc(p.firstName)} ${esc(p.lastName)}</td>
      <td>${esc(positionLabel(p.position))}</td><td>${esc(p.grade ?? "-")}</td>
      <td>${p.isRosterActive ? "Active" : "Inactive"}</td></tr>`).join("")}
    </tbody></table></div>`;
}

export async function renderAllPlayers(app, navigate) {
  const path = location.pathname;
  app.innerHTML = `<p class="muted">Loading all players...</p>`;
  let teams;
  try {
    teams = await api(`/coachteams/coach/${getSession().userId}`);
  } catch (err) {
    if (location.pathname !== path) return;
    app.innerHTML = `<a href="/" data-link>Your Teams</a><div class="msg error">${esc(err.message)}</div>
      <button id="players-retry" type="button">Retry</button>`;
    app.querySelector("#players-retry").onclick = () => renderAllPlayers(app, navigate);
    return;
  }
  const results = await Promise.allSettled(teams.map(t =>
    api(`/coach/teams/${t.teamId}/roster?includeInactive=true`)));
  if (location.pathname !== path) return;
  app.innerHTML = `<a href="/" data-link>Your Teams</a><h1>All Players</h1>
    <p class="muted">Players across your assigned teams, including inactive players.
      Players on more than one team appear under each team with their team-specific jersey and position.</p>
    <label for="players-search">Search players or teams</label>
    <input id="players-search" type="search" placeholder="Name, team, or jersey number" />
    <div id="players-results"></div>`;
  const draw = () => {
    const query = app.querySelector("#players-search").value.trim().toLocaleLowerCase();
    let matches = 0;
    app.querySelector("#players-results").innerHTML = teams.map((team, i) => {
      const result = results[i];
      const name = team.teamDisplayName || "Team";
      if (result.status === "rejected") {
        return `<section class="card"><h2>${esc(name)}</h2>
          <div class="msg error">Could not load this team's players: ${esc(result.reason.message)}</div>
          <button type="button" class="secondary" data-retry>Retry</button></section>`;
      }
      const players = result.value.filter(p =>
        `${name} ${p.firstName} ${p.lastName} ${p.jerseyNumber ?? ""}`.toLocaleLowerCase().includes(query));
      matches += players.length;
      if (query && !players.length) return "";
      return `<section class="card"><h2>${esc(name)}</h2>
        <p><a href="/teams/${esc(team.teamId)}/roster" data-link>Open roster</a>
          | <a href="/teams/${esc(team.teamId)}/roster/print" data-link>Print roster</a></p>
        ${players.length ? rosterTable(players) : `<p class="muted">No players on this roster.</p>`}</section>`;
    }).join("") + (!teams.length ? `<p class="muted">No teams are assigned to your account yet.</p>`
      : query && !matches ? `<p class="muted">No matching players in the loaded rosters.</p>` : "");
    app.querySelectorAll("[data-retry]").forEach(button => {
      button.onclick = () => renderAllPlayers(app, navigate);
    });
  };
  app.querySelector("#players-search").oninput = draw;
  draw();
}

export async function renderPrintRoster(app, teamId, navigate) {
  const path = location.pathname;
  app.innerHTML = `<p class="muted">Loading printable roster...</p>`;
  try {
    const [teams, players] = await Promise.all([
      api(`/coachteams/coach/${getSession().userId}`),
      api(`/coach/teams/${teamId}/roster?includeInactive=true`),
    ]);
    if (location.pathname !== path) return;
    const team = teams.find(t => t.teamId.toLowerCase() === teamId.toLowerCase());
    if (!team) throw new Error("This team is not assigned to your account.");
    app.innerHTML = `<div class="roster-actions print-controls">
      <a href="/teams/${esc(teamId)}/roster" data-link>Back to roster</a>
      <button type="button" id="print-roster">Print / Save PDF</button>
      <span id="print-status" role="status"></span></div>
      <article class="print-roster">
        <header class="print-roster-heading"><img src="/assets/tipin-print-logo.svg" alt="TipIn Scoring" />
          <div><h1>${esc(team.teamDisplayName || "Team")} Roster</h1>
          <p>All players - active and inactive</p></div></header>
        <p>${players.length} player${players.length === 1 ? "" : "s"} | Printed ${esc(new Date().toLocaleDateString())}</p>
        ${players.length ? rosterTable(players) : `<p>No players on this roster.</p>`}
      </article>`;
    const button = app.querySelector("#print-roster");
    button.onclick = async () => {
      button.disabled = true;
      app.querySelector("#print-status").textContent = "";
      try {
        const logo = app.querySelector(".print-roster-heading img");
        if (!logo.complete) await new Promise(resolve => {
          logo.addEventListener("load", resolve, { once: true });
          logo.addEventListener("error", resolve, { once: true });
        });
        if (button.isConnected && location.pathname === path) window.print();
      } catch (err) {
        console.error("Could not open roster printing", err);
        const status = app.querySelector("#print-status");
        if (status) status.textContent = "Could not open printing. Try your browser's Print command.";
      } finally {
        button.disabled = false;
      }
    };
  } catch (err) {
    if (location.pathname !== path) return;
    app.innerHTML = `<a href="/teams/${esc(teamId)}/roster" data-link>Back to roster</a>
      <div class="msg error">${esc(err.message)}</div><button id="print-retry" type="button">Retry</button>`;
    app.querySelector("#print-retry").onclick = () => renderPrintRoster(app, teamId, navigate);
  }
}
