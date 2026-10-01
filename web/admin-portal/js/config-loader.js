// Loads /config.json and exposes apiBase globally before other scripts run

window.configReady = (async function loadConfig() {
  try {
    const res = await fetch("/config.json");
    const config = await res.json();

    let resolvedApiBase = config.apiBase;
    const currentHost = window.location.hostname;

    // When the portal is opened over LAN IP, rewrite localhost API host to the same host.
    if (currentHost && currentHost !== "localhost" && currentHost !== "127.0.0.1") {
      try {
        const parsedApiBase = new URL(config.apiBase);
        if (parsedApiBase.hostname === "localhost" || parsedApiBase.hostname === "127.0.0.1") {
          parsedApiBase.hostname = currentHost;
          resolvedApiBase = parsedApiBase.toString().replace(/\/$/, "");
        }
      } catch {
        // Keep original apiBase if parsing fails.
      }
    }

    window.apiBase = resolvedApiBase;
} catch (err) {
    console.error("Failed to load config.json", err);
  }
})();

window.SeasonContext = (function createSeasonContext() {
  let activeSeasonPromise = null;
  let participationPromise = null;
  let activeTeamsPromise = null;

  async function getActiveSeason() {
    if (!activeSeasonPromise) {
      activeSeasonPromise = (async () => {
        const response = await authFetch("/seasons", { cache: "no-store" });
        if (!response.ok) throw new Error("Failed to load active season");
        const seasons = await response.json();
        return Array.isArray(seasons)
          ? seasons.find((season) => season.isActive) || null
          : null;
      })();
    }
    return await activeSeasonPromise;
  }

  async function getParticipation() {
    if (!participationPromise) {
      participationPromise = (async () => {
        const season = await getActiveSeason();
        if (!season?.seasonId) return [];
        const response = await authFetch(
          `/seasons/${season.seasonId}/organizations`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error("Failed to load active-season organizations");
        const organizations = await response.json();
        return Array.isArray(organizations) ? organizations : [];
      })();
    }
    return await participationPromise;
  }

  async function getActiveTeams() {
    if (!activeTeamsPromise) {
      activeTeamsPromise = (async () => {
        const season = await getActiveSeason();
        if (!season?.seasonId) return [];
        const response = await authFetch(
          `/teams?seasonId=${encodeURIComponent(season.seasonId)}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error("Failed to load active-season teams");
        const teams = await response.json();
        return Array.isArray(teams) ? teams : [];
      })();
    }
    return await activeTeamsPromise;
  }

  async function filterOrganizations(organizations) {
    const participation = await getParticipation();
    const participatingIds = new Set(
      participation
        .filter((item) => item.participationType !== "NotParticipating")
        .map((item) => String(item.organizationId)),
    );
    return (Array.isArray(organizations) ? organizations : []).filter((organization) =>
      participatingIds.has(String(organization.organizationId)),
    );
  }

  async function filterTeams(teams) {
    const season = await getActiveSeason();
    if (!season?.seasonId) return [];
    return (Array.isArray(teams) ? teams : []).filter(
      (team) => String(team.seasonId || "") === String(season.seasonId),
    );
  }

  async function filterGames(games) {
    const teams = await getActiveTeams();
    const teamIds = new Set(teams.map((team) => String(team.teamId || team.id || "")));
    return (Array.isArray(games) ? games : []).filter((game) =>
      teamIds.has(String(game.homeTeamId || "")) ||
      teamIds.has(String(game.awayTeamId || "")),
    );
  }

  async function filterPlayers(players) {
    const teams = await getActiveTeams();
    const teamIds = new Set(teams.map((team) => String(team.teamId || team.id || "")));
    return (Array.isArray(players) ? players : []).flatMap((player) => {
      const activeAssignments = (Array.isArray(player.teams) ? player.teams : [])
        .filter((team) => teamIds.has(String(team.teamId || "")));
      return activeAssignments.length ? [{ ...player, teams: activeAssignments }] : [];
    });
  }

  function clear() {
    activeSeasonPromise = null;
    participationPromise = null;
    activeTeamsPromise = null;
  }

  return {
    getActiveSeason,
    getParticipation,
    getActiveTeams,
    filterOrganizations,
    filterTeams,
    filterGames,
    filterPlayers,
    clear,
  };
})();
