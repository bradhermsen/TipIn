import { api, getSession } from "./api.js";
import { esc } from "./ui.js";

// Header with the team name and navigation tabs
export async function teamHeader(teamId, active) {
  let name = "Team";
  try {
    const teams = await api(`/coachteams/coach/${getSession().userId}`);
    name = (teams.find((t) => t.teamId === teamId) || {}).teamDisplayName || name;
  } catch {
    /* the header still works without the name */
  }
  return `<a class="small" href="/" data-link>‹ Your Teams</a>
    <h1>${esc(name)}</h1>
    <div class="tabs" role="tablist">
      <button type="button" role="tab" data-go="/teams/${esc(teamId)}/games" aria-selected="${active === "games"}">Games</button>
      <button type="button" role="tab" data-go="/teams/${esc(teamId)}/roster" aria-selected="${active === "roster"}">Roster</button>
      <button type="button" role="tab" data-go="/teams/${esc(teamId)}/coaches" aria-selected="${active === "coaches"}">Coaches</button>
    </div>`;
}

export function wireTabs(root, navigate) {
  root.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => navigate(b.dataset.go)));
}
