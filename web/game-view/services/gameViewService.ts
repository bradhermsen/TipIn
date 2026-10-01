import type {
  ApiGameListItem,
  ApiGameSummary,
  ApiOrganization,
  ApiSeason,
  ApiTeam,
  GameViewFilterData,
  GameViewFilters,
  LastFinalGameItemModel,
  NextGameCardModel,
  UpcomingScheduleItemModel,
} from "../types/gameView";
import {
  getGameById,
  getGameSummaryMobile,
  getGames,
  getOrganizations,
  getSeasons,
  getTeamNextGame,
  getTeams,
  getTeamsByOrganization,
} from "../api/gameViewApi";

const CLOSED_STATUSES = new Set([
  "FINAL",
  "COMPLETED",
  "CLOSED",
  "CANCELLED",
  "CANCELED",
  "POSTPONED",
  "PPD",
]);

const FINAL_STATUSES = new Set(["FINAL", "COMPLETED", "CLOSED"]);

const LIVE_STATUS_KEYS = new Set(["LIVE", "INPROGRESS"]);

const LEGACY_EXTERNAL_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000000";

function toStatusKey(status?: string | null): string {
  return String(status || "")
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, "");
}

function normalizeTeamType(teamType?: string | null): string {
  const value = String(teamType || "")
    .trim()
    .toLowerCase();
  if (value === "girls") return "Girls";
  if (value === "boys") return "Boys";
  return String(teamType || "").trim();
}

function isUpcomingStatus(status?: string | null): boolean {
  return !CLOSED_STATUSES.has(
    String(status || "SCHEDULED")
      .trim()
      .toUpperCase(),
  );
}

function isLiveStatus(status?: string | null): boolean {
  return LIVE_STATUS_KEYS.has(toStatusKey(status));
}

function displayTeamName(team?: ApiTeam) {
  return String(team?.name || "Team").trim() || "Team";
}

function displayTeamNameWithMascot(
  teamName: string,
  mascot?: string | null,
): string {
  const base = String(teamName || "").trim() || "Team";
  const mascotText = String(mascot || "").trim();
  if (!mascotText) return base;
  if (base.toLowerCase().includes(mascotText.toLowerCase())) return base;
  return `${base} ${mascotText}`;
}

function buildTeamContextLabel(team?: ApiTeam): string {
  if (!team) return "";
  const parts = [
    normalizeTeamType(team.teamType),
    String(team.levelName || "").trim(),
  ].filter((value) => Boolean(value));
  return parts.join(" ").trim();
}

function buildMatchupLabel(
  awayTeamName: string,
  homeTeamName: string,
  teamContextLabel?: string,
) {
  const base = `${awayTeamName} at ${homeTeamName}`;
  return teamContextLabel ? `${base} - ${teamContextLabel}` : base;
}

function pickCurrentSeasonId(seasons: Awaited<ReturnType<typeof getSeasons>>) {
  if (!Array.isArray(seasons) || seasons.length === 0) return "";

  const now = new Date();

  const activeInRange = seasons.find((season) => {
    if (!season?.isActive) return false;
    const start = new Date(season.startDate);
    const end = new Date(season.endDate);
    return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())
      ? start <= now && now <= end
      : false;
  });
  if (activeInRange?.seasonId) return activeInRange.seasonId;

  const anyActive = seasons.find(
    (season) => season?.isActive && season?.seasonId,
  );
  if (anyActive?.seasonId) return anyActive.seasonId;

  const sortedByEnd = [...seasons].sort((a, b) => {
    const aEnd = new Date(a.endDate).getTime();
    const bEnd = new Date(b.endDate).getTime();
    return bEnd - aEnd;
  });
  return sortedByEnd[0]?.seasonId || "";
}

export interface GameViewSnapshot {
  organizations: ApiOrganization[];
  seasons: ApiSeason[];
  teams: ApiTeam[];
  games: ApiGameListItem[];
  seasonId: string;
}

function resolveSeasonId(seasons: ApiSeason[], requestedSeasonId: string) {
  return seasons.some((season) => String(season.seasonId) === requestedSeasonId)
    ? requestedSeasonId
    : pickCurrentSeasonId(seasons);
}

export async function fetchGameViewSnapshot(
  filters: GameViewFilters,
): Promise<GameViewSnapshot> {
  const [organizations, seasons] = await Promise.all([
    getOrganizations(),
    getSeasons(),
  ]);
  const seasonId = resolveSeasonId(seasons, String(filters.seasonId || ""));
  const [teams, games] = await Promise.all([
    filters.organizationId
      ? getTeamsByOrganization(filters.organizationId, seasonId)
      : getTeams(seasonId),
    getGames(seasonId),
  ]);

  return { organizations, seasons, teams, games, seasonId };
}

async function loadScopedTeams(
  filters: GameViewFilters,
  snapshot?: GameViewSnapshot,
): Promise<{ seasonId: string; teams: ApiTeam[] }> {
  const seasons = snapshot?.seasons ?? await getSeasons();

  const requestedSeasonId = String(filters.seasonId || "");
  const seasonId = snapshot?.seasonId ?? resolveSeasonId(seasons, requestedSeasonId);

  const teamsRaw = snapshot?.teams ?? await (filters.organizationId
    ? getTeamsByOrganization(filters.organizationId, seasonId)
    : getTeams(seasonId));
  let teams = Array.isArray(teamsRaw) ? teamsRaw : [];

  if (seasonId) {
    teams = teams.filter((team) => String(team.seasonId || "") === seasonId);
  }

  if (filters.teamType) {
    teams = teams.filter(
      (team) => normalizeTeamType(team.teamType) === filters.teamType,
    );
  }

  if (filters.leagueId) {
    teams = teams.filter(
      (team) => String(team.leagueId || "") === filters.leagueId,
    );
  }

  if (filters.teamLevel) {
    teams = teams.filter(
      (team) => String(team.levelName || "").trim() === filters.teamLevel,
    );
  }

  return { seasonId, teams };
}

function buildScorePreviewFromSummary(
  summary: ApiGameSummary | null,
  homeTeamName: string,
  awayTeamName: string,
): { homeScore?: number; awayScore?: number } {
  if (!summary) return {};

  const homeKey = homeTeamName.trim().toLowerCase();
  const awayKey = awayTeamName.trim().toLowerCase();
  let homeScore = 0;
  let awayScore = 0;

  for (const goal of summary.goals || []) {
    const teamKey = String(goal.teamName || "")
      .trim()
      .toLowerCase();
    if (teamKey === homeKey) homeScore += 1;
    if (teamKey === awayKey) awayScore += 1;
  }

  return { homeScore, awayScore };
}

export async function fetchFilterData(
  filters?: Partial<GameViewFilters>,
  snapshot?: GameViewSnapshot,
): Promise<GameViewFilterData> {
  const [organizations, seasons] = snapshot
    ? [snapshot.organizations, snapshot.seasons]
    : await Promise.all([getOrganizations(), getSeasons()]);
  const scoped = await loadScopedTeams({
      seasonId: filters?.seasonId || "",
      organizationId: filters?.organizationId || "",
      leagueId: filters?.leagueId || "",
      teamLevel: "",
      teamType: filters?.teamType || "",
    }, snapshot);

  const seasonOptions = (seasons || [])
    .map((season) => ({
      id: String(season.seasonId),
      label: String(season.seasonName || "Season"),
    }))
    .sort((a, b) => b.label.localeCompare(a.label));

  const organizationOptions = (organizations || [])
    .filter(
      (organization) =>
        organization?.isActive &&
        String(organization.organizationId).toLowerCase() !==
          LEGACY_EXTERNAL_ORGANIZATION_ID,
    )
    .map((organization) => ({
      id: String(organization.organizationId),
      label:
        String(organization.name || "").trim() ||
        String(organization.abbreviation || "Organization"),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const leagueOptions = Array.from(
    new Map(
      (organizations || [])
        .filter(
          (organization) => organization.leagueId && organization.leagueName,
        )
        .map((organization) => [
          String(organization.leagueId),
          {
            id: String(organization.leagueId),
            label: String(organization.leagueName),
          },
        ]),
    ).values(),
  ).sort((a, b) => a.label.localeCompare(b.label));

  const teamLevelOptions = Array.from(
    new Set(
      scoped.teams
        .map((team) => String(team.levelName || "").trim())
        .filter(Boolean),
    ),
  )
    .map((level) => ({ id: level, label: level }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    seasons: seasonOptions,
    currentSeasonId: pickCurrentSeasonId(seasons),
    organizations: organizationOptions,
    leagues: leagueOptions,
    teamLevels: teamLevelOptions,
  };
}

export async function fetchNextGamesByTeam(
  filters: GameViewFilters,
  snapshot?: GameViewSnapshot,
): Promise<NextGameCardModel[]> {
  const scoped = await loadScopedTeams(filters, snapshot);
  const teamMap = new Map(
    scoped.teams.map((team) => [String(team.teamId), team]),
  );
  const filteredTeamIds = new Set(
    scoped.teams.map((team) => String(team.teamId)),
  );
  const games = snapshot?.games ?? await getGames(scoped.seasonId);

  const gameCandidates = (games || [])
    .filter((game) => {
      const homeId = String(game.homeTeamId || "");
      const awayId = String(game.awayTeamId || "");
      if (!filteredTeamIds.has(homeId) && !filteredTeamIds.has(awayId))
        return false;

      return isLiveStatus(game.status);
    })
    .sort((a, b) => {
      const aLive = isLiveStatus(a.status) ? 0 : 1;
      const bLive = isLiveStatus(b.status) ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      return (
        new Date(a.gameDateTime).getTime() - new Date(b.gameDateTime).getTime()
      );
    });

  const cardCandidates: Array<NextGameCardModel | null> = await Promise.all(
    gameCandidates.map(async (game) => {
      const gameId = String(game.gameId);
      const status = String(game.status || "SCHEDULED");
      const homeTeam = teamMap.get(String(game.homeTeamId || ""));
      const awayTeam = teamMap.get(String(game.awayTeamId || ""));
      const homeDisplay = displayTeamNameWithMascot(
        String(game.homeTeamName || "Home"),
        homeTeam?.teamMascot || null,
      );
      const awayDisplay = displayTeamNameWithMascot(
        String(game.awayTeamName || "Away"),
        awayTeam?.teamMascot || null,
      );

      let homeScore: number | undefined;
      let awayScore: number | undefined;
      if (isLiveStatus(status)) {
        try {
          const summary = await getGameSummaryMobile(gameId);
          const preview = buildScorePreviewFromSummary(
            summary,
            String(game.homeTeamName || "Home"),
            String(game.awayTeamName || "Away"),
          );
          homeScore = preview.homeScore;
          awayScore = preview.awayScore;
        } catch {
          // Score preview remains optional when summary endpoint fails.
        }
      }

      return {
        gameId,
        teamId: String(game.homeTeamId || ""),
        teamName: homeDisplay,
        opponentName: awayDisplay,
        matchupLabel: buildMatchupLabel(
          awayDisplay,
          homeDisplay,
          buildTeamContextLabel(homeTeam || awayTeam),
        ),
        teamContextLabel: buildTeamContextLabel(homeTeam || awayTeam),
        startTimeIso: new Date(game.gameDateTime).toISOString(),
        status,
        isLive: isLiveStatus(status),
        homeScore,
        awayScore,
      } satisfies NextGameCardModel;
    }),
  );

  const cards = cardCandidates.filter(
    (card): card is NextGameCardModel => card !== null,
  );

  return cards.sort((a, b) => a.startTimeIso.localeCompare(b.startTimeIso));
}

export async function fetchUpcomingSchedule(
  filters: GameViewFilters,
  snapshot?: GameViewSnapshot,
): Promise<UpcomingScheduleItemModel[]> {
  const scoped = await loadScopedTeams(filters, snapshot);
  const teamMap = new Map(
    scoped.teams.map((team) => [String(team.teamId), team]),
  );
  const filteredTeamIds = new Set(
    scoped.teams.map((team) => String(team.teamId)),
  );

  const games = snapshot?.games ?? await getGames(scoped.seasonId);
  return (games || [])
    .filter((game) => {
      const homeId = String(game.homeTeamId || "");
      const awayId = String(game.awayTeamId || "");
      if (!filteredTeamIds.has(homeId) && !filteredTeamIds.has(awayId))
        return false;

      const status = String(game.status || "")
        .trim()
        .toUpperCase();
      if (status !== "SCHEDULED") return false;

      const startMs = new Date(game.gameDateTime).getTime();
      if (Number.isNaN(startMs)) return false;

      return true;
    })
    .sort(
      (a, b) =>
        new Date(a.gameDateTime).getTime() - new Date(b.gameDateTime).getTime(),
    )
    .map((game) => ({
      homeTeamName: displayTeamNameWithMascot(
        String(game.homeTeamName || "Home"),
        teamMap.get(String(game.homeTeamId || ""))?.teamMascot || null,
      ),
      awayTeamName: displayTeamNameWithMascot(
        String(game.awayTeamName || "Away"),
        teamMap.get(String(game.awayTeamId || ""))?.teamMascot || null,
      ),
      gameId: String(game.gameId),
      startTimeIso: new Date(game.gameDateTime).toISOString(),
      matchupLabel: buildMatchupLabel(
        displayTeamNameWithMascot(
          String(game.awayTeamName || "Away"),
          teamMap.get(String(game.awayTeamId || ""))?.teamMascot || null,
        ),
        displayTeamNameWithMascot(
          String(game.homeTeamName || "Home"),
          teamMap.get(String(game.homeTeamId || ""))?.teamMascot || null,
        ),
        buildTeamContextLabel(
          teamMap.get(String(game.homeTeamId || "")) ||
            teamMap.get(String(game.awayTeamId || "")),
        ),
      ),
      teamContextLabel: buildTeamContextLabel(
        teamMap.get(String(game.homeTeamId || "")) ||
          teamMap.get(String(game.awayTeamId || "")),
      ),
      status: String(game.status || "SCHEDULED"),
    }));
}

export async function fetchLastFinalGamesByTeam(
  filters: GameViewFilters,
  snapshot?: GameViewSnapshot,
): Promise<LastFinalGameItemModel[]> {
  const scoped = await loadScopedTeams(filters, snapshot);
  const teamMap = new Map(
    scoped.teams.map((team) => [String(team.teamId), team]),
  );
  const filteredTeamIds = new Set(
    scoped.teams.map((team) => String(team.teamId)),
  );
  const games = snapshot?.games ?? await getGames(scoped.seasonId);

  const finalGames = (games || [])
    .filter((game) => {
      const homeId = String(game.homeTeamId || "");
      const awayId = String(game.awayTeamId || "");
      if (!filteredTeamIds.has(homeId) && !filteredTeamIds.has(awayId))
        return false;
      return FINAL_STATUSES.has(
        String(game.status || "")
          .trim()
          .toUpperCase(),
      );
    })
    .sort(
      (a, b) =>
        new Date(b.gameDateTime).getTime() - new Date(a.gameDateTime).getTime(),
    );

  const rows = await Promise.all(
    finalGames.map(async (game) => {
      const homeDisplay = displayTeamNameWithMascot(
        String(game.homeTeamName || "Home"),
        teamMap.get(String(game.homeTeamId || ""))?.teamMascot || null,
      );
      const awayDisplay = displayTeamNameWithMascot(
        String(game.awayTeamName || "Away"),
        teamMap.get(String(game.awayTeamId || ""))?.teamMascot || null,
      );
      let scoreText = "Final score unavailable";
      if (
        typeof game.homeScore === "number" &&
        typeof game.awayScore === "number"
      ) {
        scoreText = `${awayDisplay} ${game.awayScore} - ${game.homeScore} ${homeDisplay}`;
      } else {
        try {
          const summary = await getGameSummaryMobile(String(game.gameId));
          const score = buildScorePreviewFromSummary(
            summary,
            String(game.homeTeamName || "Home"),
            String(game.awayTeamName || "Away"),
          );
          if (
            typeof score.homeScore === "number" &&
            typeof score.awayScore === "number"
          ) {
            scoreText = `${awayDisplay} ${score.awayScore} - ${score.homeScore} ${homeDisplay}`;
          }
        } catch {
          // Keep fallback score text when summary is unavailable.
        }
      }

      return {
        gameId: String(game.gameId),
        homeTeamName: homeDisplay,
        awayTeamName: awayDisplay,
        matchupLabel: buildMatchupLabel(
          awayDisplay,
          homeDisplay,
          buildTeamContextLabel(
            teamMap.get(String(game.homeTeamId || "")) ||
              teamMap.get(String(game.awayTeamId || "")),
          ),
        ),
        teamContextLabel: buildTeamContextLabel(
          teamMap.get(String(game.homeTeamId || "")) ||
            teamMap.get(String(game.awayTeamId || "")),
        ),
        gameDateIso: new Date(game.gameDateTime).toISOString(),
        status: String(game.status || "FINAL"),
        scoreText,
      } satisfies LastFinalGameItemModel;
    }),
  );

  return rows.sort(
    (a, b) =>
      new Date(b.gameDateIso).getTime() - new Date(a.gameDateIso).getTime(),
  );
}
