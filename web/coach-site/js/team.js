import { api, getSession } from "./api.js";
import { esc } from "./ui.js";

// Header with the team name and the Roster / Games tabs
export async function teamHeader(teamId, active) {
  let name = "Team";
  let multiple = false;
  try {
    const teams = await api(`/coachteams/coach/${getSession().userId}`);
    multiple = teams.length > 1;
    name = (teams.find((t) => t.teamId === teamId) || {}).teamName || name;
  } catch {
    /* the header still works without the name */
  }
  return `${multiple ? `<a class="small" href="/" data-link>‹ All teams</a>` : ""}
    <h1>${esc(name)}</h1>
    <div class="tabs" role="tablist">
      <button type="button" role="tab" data-go="/teams/${esc(teamId)}" aria-selected="${active === "roster"}">Roster</button>
      <button type="button" role="tab" data-go="/teams/${esc(teamId)}/games" aria-selected="${active === "games"}">Games</button>
    </div>`;
}

export function wireTabs(root, navigate) {
  root.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => navigate(b.dataset.go)));
}
