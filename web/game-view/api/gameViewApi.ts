import type {
  ApiGameDetail,
  ApiGameListItem,
  ApiPublicCoachBundle,
  ApiPublicRosterBundle,
  ApiGameSummaryReport,
  ApiRosterPlayer,
  ApiGameSummary,
  ApiNextGame,
  ApiOrganization,
  ApiTeamCoach,
  ApiSeason,
  ApiTeam,
} from "../types/gameView";

type RequestOptions = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function pickString(obj: JsonObject, ...keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

function pickBoolean(obj: JsonObject, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return false;
}

function pickOptionalBoolean(
  obj: JsonObject,
  ...keys: string[]
): boolean | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function pickOptionalNumber(
  obj: JsonObject,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function pickNumber(obj: JsonObject, ...keys: string[]): number {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function extractListPayload(payload: unknown, label: string): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const obj = asObject(payload);
  if (!obj) {
    throw new Error(`${label} response was not a list.`);
  }

  const errorMessage = pickString(obj, "error", "Error", "message", "Message");
  if (errorMessage) {
    throw new Error(errorMessage);
  }

  for (const key of ["items", "Items", "data", "Data", "results", "Results"]) {
    const value = obj[key];
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function normalizeOrganization(row: unknown): ApiOrganization {
  const obj = asObject(row) || {};
  return {
    organizationId: pickString(obj, "organizationId", "OrganizationId"),
    leagueId: pickString(obj, "leagueId", "LeagueId") || null,
    leagueName: pickString(obj, "leagueName", "LeagueName") || null,
    name: pickString(obj, "name", "Name") || null,
    abbreviation: pickString(obj, "abbreviation", "Abbreviation") || null,
    mascot: pickString(obj, "mascot", "Mascot") || null,
    organizationType:
      pickString(obj, "organizationType", "OrganizationType") || null,
    isActive: pickBoolean(obj, "isActive", "IsActive"),
  };
}

function normalizeTeam(row: unknown): ApiTeam {
  const obj = asObject(row) || {};
  return {
    teamId: pickString(obj, "teamId", "TeamId", "id", "Id"),
    organizationId: pickString(obj, "organizationId", "OrganizationId") || null,
    leagueId: pickString(obj, "leagueId", "LeagueId") || null,
    organizationType:
      pickString(obj, "organizationType", "OrganizationType") || null,
    seasonId: pickString(obj, "seasonId", "SeasonId") || null,
    name: pickString(obj, "name", "Name") || null,
    teamType: pickString(obj, "teamType", "TeamType") || null,
    levelName: pickString(obj, "levelName", "LevelName") || null,
    teamMascot: pickString(obj, "teamMascot", "TeamMascot") || null,
    isActive: pickBoolean(obj, "isActive", "IsActive"),
  };
}

function normalizeSeason(row: unknown): ApiSeason {
  const obj = asObject(row) || {};
  return {
    seasonId: pickString(obj, "seasonId", "SeasonId"),
    seasonName: pickString(obj, "seasonName", "SeasonName") || null,
    startDate: pickString(obj, "startDate", "StartDate"),
    endDate: pickString(obj, "endDate", "EndDate"),
    isActive: pickBoolean(obj, "isActive", "IsActive"),
  };
}

function normalizeGameListItem(row: unknown): ApiGameListItem {
  const obj = asObject(row) || {};
  return {
    gameId: pickString(obj, "gameId", "GameId"),
    homeTeamId: pickString(obj, "homeTeamId", "HomeTeamId"),
    homeTeamName: pickString(obj, "homeTeamName", "HomeTeamName"),
    awayTeamId: pickString(obj, "awayTeamId", "AwayTeamId"),
    awayTeamName: pickString(obj, "awayTeamName", "AwayTeamName"),
    gameDateTime: pickString(obj, "gameDateTime", "GameDateTime"),
    status: pickString(obj, "status", "Status") || "SCHEDULED",
    homeScore: pickOptionalNumber(obj, "homeScore", "HomeScore"),
    awayScore: pickOptionalNumber(obj, "awayScore", "AwayScore"),
  };
}

function normalizeGameDetail(payload: unknown): ApiGameDetail {
  const obj = asObject(payload) || {};
  const errorMessage = pickString(obj, "error", "Error", "message", "Message");
  if (errorMessage) {
    throw new Error(errorMessage);
  }

  return {
    gameId: pickString(obj, "gameId", "GameId"),
    homeTeamId: pickString(obj, "homeTeamId", "HomeTeamId"),
    homeTeamName: pickString(obj, "homeTeamName", "HomeTeamName"),
    awayTeamId: pickString(obj, "awayTeamId", "AwayTeamId"),
    awayTeamName: pickString(obj, "awayTeamName", "AwayTeamName"),
    gameDateTime: pickString(obj, "gameDateTime", "GameDateTime"),
    status: pickString(obj, "status", "Status") || "SCHEDULED",
    periodLengthMinutes: pickNumber(
      obj,
      "periodLengthMinutes",
      "PeriodLengthMinutes",
    ),
  };
}

function normalizeNextGame(payload: unknown): ApiNextGame {
  const obj = asObject(payload) || {};
  return {
    gameId: pickString(obj, "gameId", "GameId"),
    homeTeamId: pickString(obj, "homeTeamId", "HomeTeamId"),
    homeTeamName: pickString(obj, "homeTeamName", "HomeTeamName"),
    awayTeamId: pickString(obj, "awayTeamId", "AwayTeamId"),
    awayTeamName: pickString(obj, "awayTeamName", "AwayTeamName"),
    opponentName: pickString(obj, "opponentName", "OpponentName"),
    startTime: pickString(obj, "startTime", "StartTime"),
    teamType: pickString(obj, "teamType", "TeamType") || null,
    levelName: pickString(obj, "levelName", "LevelName") || null,
    homeTeamMascot: pickString(obj, "homeTeamMascot", "HomeTeamMascot") || null,
    awayTeamMascot: pickString(obj, "awayTeamMascot", "AwayTeamMascot") || null,
  };
}

function normalizeGameSummary(payload: unknown): ApiGameSummary {
  const obj = asObject(payload) || {};
  const goalsRaw = extractListPayload(obj.goals ?? obj.Goals ?? [], "goals");
  const penaltiesRaw = extractListPayload(
    obj.penalties ?? obj.Penalties ?? [],
    "penalties",
  );
  const shotsRaw = extractListPayload(obj.shots ?? obj.Shots ?? [], "shots");

  return {
    gameId: pickString(obj, "gameId", "GameId"),
    goals: goalsRaw.map((row) => {
      const goal = asObject(row) || {};
      return {
        eventId: pickString(goal, "eventId", "EventId"),
        period: pickNumber(goal, "period", "Period") || undefined,
        timeInPeriod:
          pickString(goal, "timeInPeriod", "TimeInPeriod") || undefined,
        teamName: pickString(goal, "teamName", "TeamName"),
        scorerName: pickString(goal, "scorerName", "ScorerName") || undefined,
        assist1Name: pickString(goal, "assist1Name", "Assist1Name") || null,
        assist2Name: pickString(goal, "assist2Name", "Assist2Name") || null,
        strength: pickString(goal, "strength", "Strength") || null,
      };
    }),
    penalties: penaltiesRaw.map((row) => {
      const penalty = asObject(row) || {};
      return {
        eventId: pickString(penalty, "eventId", "EventId"),
        period: pickNumber(penalty, "period", "Period") || undefined,
        timeInPeriod:
          pickString(penalty, "timeInPeriod", "TimeInPeriod") || undefined,
        teamName: pickString(penalty, "teamName", "TeamName"),
        playerName: pickString(penalty, "playerName", "PlayerName"),
        infraction: pickString(penalty, "infraction", "Infraction"),
        durationMinutes: pickNumber(
          penalty,
          "durationMinutes",
          "DurationMinutes",
        ),
      };
    }),
    shots: shotsRaw.map((row) => {
      const shot = asObject(row) || {};
      return {
        eventId: pickString(shot, "eventId", "EventId"),
        period: pickNumber(shot, "period", "Period") || undefined,
        timeInPeriod:
          pickString(shot, "timeInPeriod", "TimeInPeriod") || undefined,
        teamName: pickString(shot, "teamName", "TeamName"),
      };
    }),
    homeShotsP1: pickOptionalNumber(obj, "homeShotsP1", "HomeShotsP1"),
    homeShotsP2: pickOptionalNumber(obj, "homeShotsP2", "HomeShotsP2"),
    homeShotsP3: pickOptionalNumber(obj, "homeShotsP3", "HomeShotsP3"),
    homeShotsOT: pickOptionalNumber(obj, "homeShotsOT", "HomeShotsOT"),
    homeShots: pickOptionalNumber(obj, "homeShots", "HomeShots"),
    awayShotsP1: pickOptionalNumber(obj, "awayShotsP1", "AwayShotsP1"),
    awayShotsP2: pickOptionalNumber(obj, "awayShotsP2", "AwayShotsP2"),
    awayShotsP3: pickOptionalNumber(obj, "awayShotsP3", "AwayShotsP3"),
    awayShotsOT: pickOptionalNumber(obj, "awayShotsOT", "AwayShotsOT"),
    awayShots: pickOptionalNumber(obj, "awayShots", "AwayShots"),
    currentPeriod: pickOptionalNumber(obj, "currentPeriod", "CurrentPeriod"),
    homeOnPowerPlay: pickOptionalBoolean(
      obj,
      "homeOnPowerPlay",
      "HomeOnPowerPlay",
      "isHomeOnPowerPlay",
      "IsHomeOnPowerPlay",
    ),
    awayOnPowerPlay: pickOptionalBoolean(
      obj,
      "awayOnPowerPlay",
      "AwayOnPowerPlay",
      "isAwayOnPowerPlay",
      "IsAwayOnPowerPlay",
    ),
    homeSkatersOnIce: pickOptionalNumber(
      obj,
      "homeSkatersOnIce",
      "HomeSkatersOnIce",
    ),
    awaySkatersOnIce: pickOptionalNumber(
      obj,
      "awaySkatersOnIce",
      "AwaySkatersOnIce",
    ),
    homeStarterIds: Array.isArray(obj.homeStarterIds ?? obj.HomeStarterIds)
      ? ([] as unknown[])
          .concat(obj.homeStarterIds ?? obj.HomeStarterIds)
          .map((id) => String(id))
      : undefined,
    awayStarterIds: Array.isArray(obj.awayStarterIds ?? obj.AwayStarterIds)
      ? ([] as unknown[])
          .concat(obj.awayStarterIds ?? obj.AwayStarterIds)
          .map((id) => String(id))
      : undefined,
  };
}

function normalizeGameSummaryReport(payload: unknown): ApiGameSummaryReport {
  const obj = asObject(payload) || {};
  const goalsRaw = extractListPayload(obj.goals ?? obj.Goals ?? [], "goals");
  const penaltiesRaw = extractListPayload(
    obj.penalties ?? obj.Penalties ?? [],
    "penalties",
  );
  const goaliesRaw = extractListPayload(
    obj.goalies ?? obj.Goalies ?? [],
    "goalies",
  );
  const officialsRaw = extractListPayload(
    obj.officials ?? obj.Officials ?? [],
    "officials",
  );
  const suspensionRaw = extractListPayload(
    obj.suspensionReviews ?? obj.SuspensionReviews ?? [],
    "suspension reviews",
  );

  const homeShotsObj = asObject(obj.homeShots ?? obj.HomeShots) || {};
  const awayShotsObj = asObject(obj.awayShots ?? obj.AwayShots) || {};

  return {
    gameId: pickString(obj, "gameId", "GameId"),
    leagueName: pickString(obj, "leagueName", "LeagueName"),
    homeLevelName: pickString(obj, "homeLevelName", "HomeLevelName"),
    awayLevelName: pickString(obj, "awayLevelName", "AwayLevelName"),
    seasonName: pickString(obj, "seasonName", "SeasonName"),
    gameDateTime: pickString(obj, "gameDateTime", "GameDateTime"),
    status: pickString(obj, "status", "Status"),
    homeTeamName: pickString(obj, "homeTeamName", "HomeTeamName"),
    awayTeamName: pickString(obj, "awayTeamName", "AwayTeamName"),
    teamType: pickString(obj, "teamType", "TeamType"),
    homeTeamMascot: pickString(obj, "homeTeamMascot", "HomeTeamMascot"),
    awayTeamMascot: pickString(obj, "awayTeamMascot", "AwayTeamMascot"),
    arenaName: pickString(obj, "arenaName", "ArenaName"),
    rinkName: pickString(obj, "rinkName", "RinkName"),
    homeHeadCoachName: pickString(
      obj,
      "homeHeadCoachName",
      "HomeHeadCoachName",
    ),
    homeAssistantCoach1Name: pickString(
      obj,
      "homeAssistantCoach1Name",
      "HomeAssistantCoach1Name",
    ),
    homeAssistantCoach2Name: pickString(
      obj,
      "homeAssistantCoach2Name",
      "HomeAssistantCoach2Name",
    ),
    homeAssistantCoach3Name: pickString(
      obj,
      "homeAssistantCoach3Name",
      "HomeAssistantCoach3Name",
    ),
    homeAssistantCoach4Name: pickString(
      obj,
      "homeAssistantCoach4Name",
      "HomeAssistantCoach4Name",
    ),
    awayHeadCoachName: pickString(
      obj,
      "awayHeadCoachName",
      "AwayHeadCoachName",
    ),
    awayAssistantCoach1Name: pickString(
      obj,
      "awayAssistantCoach1Name",
      "AwayAssistantCoach1Name",
    ),
    awayAssistantCoach2Name: pickString(
      obj,
      "awayAssistantCoach2Name",
      "AwayAssistantCoach2Name",
    ),
    awayAssistantCoach3Name: pickString(
      obj,
      "awayAssistantCoach3Name",
      "AwayAssistantCoach3Name",
    ),
    awayAssistantCoach4Name: pickString(
      obj,
      "awayAssistantCoach4Name",
      "AwayAssistantCoach4Name",
    ),
    homeGoals: pickNumber(obj, "homeGoals", "HomeGoals"),
    awayGoals: pickNumber(obj, "awayGoals", "AwayGoals"),
    homeShots: {
      p1: pickNumber(homeShotsObj, "p1", "P1"),
      p2: pickNumber(homeShotsObj, "p2", "P2"),
      p3: pickNumber(homeShotsObj, "p3", "P3"),
      ot: pickNumber(homeShotsObj, "ot", "OT"),
      total: pickNumber(homeShotsObj, "total", "Total"),
    },
    awayShots: {
      p1: pickNumber(awayShotsObj, "p1", "P1"),
      p2: pickNumber(awayShotsObj, "p2", "P2"),
      p3: pickNumber(awayShotsObj, "p3", "P3"),
      ot: pickNumber(awayShotsObj, "ot", "OT"),
      total: pickNumber(awayShotsObj, "total", "Total"),
    },
    goals: goalsRaw.map((row) => {
      const goal = asObject(row) || {};
      return {
        period: pickNumber(goal, "period", "Period"),
        timeInPeriod: pickString(goal, "timeInPeriod", "TimeInPeriod"),
        teamName: pickString(goal, "teamName", "TeamName"),
        scorerNumber:
          pickOptionalNumber(goal, "scorerNumber", "ScorerNumber") ?? null,
        scorer: pickString(goal, "scorer", "Scorer"),
        assist1Number:
          pickOptionalNumber(goal, "assist1Number", "Assist1Number") ?? null,
        assist1: pickString(goal, "assist1", "Assist1") || null,
        assist2Number:
          pickOptionalNumber(goal, "assist2Number", "Assist2Number") ?? null,
        assist2: pickString(goal, "assist2", "Assist2") || null,
        strength: pickString(goal, "strength", "Strength"),
      };
    }),
    penalties: penaltiesRaw.map((row) => {
      const penalty = asObject(row) || {};
      return {
        period: pickNumber(penalty, "period", "Period"),
        timeInPeriod: pickString(penalty, "timeInPeriod", "TimeInPeriod"),
        teamName: pickString(penalty, "teamName", "TeamName"),
        playerNumber:
          pickOptionalNumber(penalty, "playerNumber", "PlayerNumber") ?? null,
        playerName: pickString(penalty, "playerName", "PlayerName"),
        infraction: pickString(penalty, "infraction", "Infraction"),
        durationMinutes: pickNumber(
          penalty,
          "durationMinutes",
          "DurationMinutes",
        ),
        penaltyType: pickString(penalty, "penaltyType", "PenaltyType") || null,
        notes: pickString(penalty, "notes", "Notes") || null,
      };
    }),
    goalies: goaliesRaw.map((row) => {
      const goalie = asObject(row) || {};
      return {
        teamName: pickString(goalie, "teamName", "TeamName"),
        goalieName: pickString(goalie, "goalieName", "GoalieName"),
        p1: pickNumber(goalie, "p1", "P1"),
        p2: pickNumber(goalie, "p2", "P2"),
        p3: pickNumber(goalie, "p3", "P3"),
        ot: pickNumber(goalie, "ot", "OT"),
        total: pickNumber(goalie, "total", "Total"),
        timeInNetSeconds: pickNumber(
          goalie,
          "timeInNetSeconds",
          "TimeInNetSeconds",
        ),
        goalsAgainstEstimate: pickNumber(
          goalie,
          "goalsAgainstEstimate",
          "GoalsAgainstEstimate",
        ),
        savesEstimate: pickNumber(goalie, "savesEstimate", "SavesEstimate"),
        savePctEstimate: pickNumber(
          goalie,
          "savePctEstimate",
          "SavePctEstimate",
        ),
      };
    }),
    officials: officialsRaw.map((row) => {
      const official = asObject(row) || {};
      return {
        role: pickString(official, "role", "Role"),
        officialName: pickString(official, "officialName", "OfficialName"),
      };
    }),
    suspensionReviews: suspensionRaw.map((row) => {
      const item = asObject(row) || {};
      return {
        period: pickNumber(item, "period", "Period"),
        timeInPeriod: pickString(item, "timeInPeriod", "TimeInPeriod"),
        teamName: pickString(item, "teamName", "TeamName"),
        playerNumber:
          pickOptionalNumber(item, "playerNumber", "PlayerNumber") ?? null,
        playerName: pickString(item, "playerName", "PlayerName"),
        suspensionBehavior:
          pickString(item, "suspensionBehavior", "SuspensionBehavior") || null,
        requiresRefereeNotes: pickBoolean(
          item,
          "requiresRefereeNotes",
          "RequiresRefereeNotes",
        ),
        reviewRequired: pickBoolean(item, "reviewRequired", "ReviewRequired"),
        notes: pickString(item, "notes", "Notes") || null,
      };
    }),
  };
}

function normalizeRosterPlayers(payload: unknown): ApiRosterPlayer[] {
  return extractListPayload(payload, "roster").map((row) => {
    const obj = asObject(row) || {};
    const gradeNumber = pickOptionalNumber(obj, "grade", "Grade");
    const gradeText = pickString(obj, "grade", "Grade");
    return {
      playerId: pickString(obj, "playerId", "PlayerId"),
      fullName: pickString(obj, "fullName", "FullName"),
      jerseyNumber: pickNumber(obj, "jerseyNumber", "JerseyNumber") || null,
      position: pickString(obj, "position", "Position") || null,
      grade: typeof gradeNumber === "number" ? gradeNumber : gradeText || null,
      isGoalie: pickBoolean(obj, "isGoalie", "IsGoalie"),
      isActive: pickBoolean(obj, "isActive", "IsActive"),
    };
  });
}

function normalizeTeamCoaches(payload: unknown): ApiTeamCoach[] {
  return extractListPayload(payload, "coaches").map((row) => {
    const obj = asObject(row) || {};
    return {
      roleName: pickString(obj, "roleName", "RoleName") || "Coach",
      coachName: pickString(obj, "coachName", "CoachName") || "Unknown Coach",
      coachEmail: pickString(obj, "coachEmail", "CoachEmail") || null,
    };
  });
}

function normalizePublicRosterRow(row: unknown) {
  const obj = asObject(row) || {};
  return {
    playerId: pickString(obj, "playerId", "PlayerId"),
    playerName: pickString(obj, "playerName", "PlayerName"),
    jerseyNumber: pickString(obj, "jerseyNumber", "JerseyNumber"),
    position: pickString(obj, "position", "Position"),
    grade: pickString(obj, "grade", "Grade"),
    isGoalie: pickBoolean(obj, "isGoalie", "IsGoalie"),
    isStarter: pickBoolean(obj, "isStarter", "IsStarter"),
    goals: pickNumber(obj, "goals", "Goals"),
    assists: pickNumber(obj, "assists", "Assists"),
    penaltyMinutes: pickNumber(obj, "penaltyMinutes", "PenaltyMinutes"),
    shotsAgainst: pickNumber(obj, "shotsAgainst", "ShotsAgainst"),
    goalsAgainst: pickNumber(obj, "goalsAgainst", "GoalsAgainst"),
    goalsAgainstAverage: pickNumber(
      obj,
      "goalsAgainstAverage",
      "GoalsAgainstAverage",
    ),
    savePercentage: pickNumber(obj, "savePercentage", "SavePercentage"),
    minutesPlayed: pickNumber(obj, "minutesPlayed", "MinutesPlayed"),
  };
}

function normalizePublicRosterBundle(payload: unknown): ApiPublicRosterBundle {
  const obj = asObject(payload) || {};
  return {
    homeRoster: extractListPayload(
      obj.homeRoster ?? obj.HomeRoster ?? [],
      "home roster",
    ).map(normalizePublicRosterRow),
    awayRoster: extractListPayload(
      obj.awayRoster ?? obj.AwayRoster ?? [],
      "away roster",
    ).map(normalizePublicRosterRow),
    goalieStatsNotice:
      pickString(obj, "goalieStatsNotice", "GoalieStatsNotice") || null,
  };
}

function normalizePublicCoachBundle(payload: unknown): ApiPublicCoachBundle {
  const obj = asObject(payload) || {};
  return {
    homeCoaches: normalizeTeamCoaches(obj.homeCoaches ?? obj.HomeCoaches ?? []),
    awayCoaches: normalizeTeamCoaches(obj.awayCoaches ?? obj.AwayCoaches ?? []),
  };
}

function resolveApiBase() {
  const globalBase =
    typeof window !== "undefined" && typeof window.apiBase === "string"
      ? window.apiBase
      : "/api";
  return String(globalBase || "/api").replace(/\/$/, "");
}

function buildApiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${resolveApiBase()}${normalizedPath}`;
}

async function authFetch(path: string, options: RequestOptions = {}) {
  const headers: Record<string, string> = {
    ...(options.headers || {}),
  };

  const token =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("nf_gameview_token") ||
        localStorage.getItem("nf_token") ||
        localStorage.getItem("nf_admin_token")
      : null;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(buildApiUrl(path), {
    ...options,
    headers,
  });
}

async function getJson<T>(path: string): Promise<T> {
  const res = await authFetch(path);
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}) for ${path}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (!/application\/json/i.test(contentType)) {
    const preview = (await res.text()).slice(0, 120);
    throw new Error(
      `Expected JSON from ${path} but received ${contentType || "unknown content-type"}. Preview: ${preview}`,
    );
  }

  return (await res.json()) as T;
}

export interface GameManagerPilotInterest {
  organizationName: string;
  contactName: string;
  email: string;
  contactRole: string;
  teamCount: number | null;
  gatewayInterest: "interested" | "unsure" | "not-now";
  notes: string;
  website: string;
}

export async function submitGameManagerPilotInterest(
  payload: GameManagerPilotInterest,
): Promise<string> {
  const res = await authFetch("/public/game-manager/pilot-interest", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const response = (await res.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
  };
  if (!res.ok)
    throw new Error(response.error || "Unable to submit pilot interest.");
  return response.message || "Thanks. We received your pilot interest.";
}

export async function getOrganizations(): Promise<ApiOrganization[]> {
  const payload = await getJson<unknown>("/public/gameview/organizations");
  return extractListPayload(payload, "organizations").map(
    normalizeOrganization,
  );
}

export async function getTeams(seasonId?: string): Promise<ApiTeam[]> {
  const query = seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : "";
  const payload = await getJson<unknown>(`/public/gameview/teams${query}`);
  return extractListPayload(payload, "teams").map(normalizeTeam);
}

export async function getTeamsByOrganization(
  organizationId: string,
  seasonId?: string,
): Promise<ApiTeam[]> {
  const params = new URLSearchParams({ organizationId });
  if (seasonId) params.set("seasonId", seasonId);
  const payload = await getJson<unknown>(
    `/public/gameview/teams?${params.toString()}`,
  );
  return extractListPayload(payload, "teams").map(normalizeTeam);
}

export async function getSeasons(): Promise<ApiSeason[]> {
  const payload = await getJson<unknown>("/public/gameview/seasons");
  return extractListPayload(payload, "seasons").map(normalizeSeason);
}

export async function getGames(seasonId?: string): Promise<ApiGameListItem[]> {
  const query = seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : "";
  const payload = await getJson<unknown>(`/public/gameview/games${query}`);
  return extractListPayload(payload, "games").map(normalizeGameListItem);
}

export async function getGameById(gameId: string): Promise<ApiGameDetail> {
  const payload = await getJson<unknown>(`/public/gameview/games/${gameId}`);
  return normalizeGameDetail(payload);
}

export async function getTeamNextGame(
  teamId: string,
): Promise<ApiNextGame | null> {
  const res = await authFetch(`/teams/${teamId}/nextgame`);

  if (res.status === 404 || res.status === 410) {
    return null;
  }

  if (!res.ok) {
    throw new Error(
      `Request failed (${res.status}) for /teams/${teamId}/nextgame`,
    );
  }

  return normalizeNextGame(await res.json());
}

export async function getGameSummaryMobile(
  gameId: string,
): Promise<ApiGameSummary | null> {
  const res = await authFetch(`/public/gameview/games/${gameId}/summary`);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(
      `Request failed (${res.status}) for /public/gameview/games/${gameId}/summary`,
    );
  }
  return normalizeGameSummary(await res.json());
}

export async function getGameSummaryReport(
  gameId: string,
): Promise<ApiGameSummaryReport | null> {
  const res = await authFetch(
    `/public/gameview/games/${gameId}/summary-report`,
  );
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(
      `Request failed (${res.status}) for /public/gameview/games/${gameId}/summary-report`,
    );
  }
  return normalizeGameSummaryReport(await res.json());
}

export async function getPublicGameRosters(
  gameId: string,
): Promise<ApiPublicRosterBundle> {
  const payload = await getJson<unknown>(
    `/public/gameview/games/${gameId}/rosters`,
  );
  return normalizePublicRosterBundle(payload);
}

export async function getPublicGameCoaches(
  gameId: string,
): Promise<ApiPublicCoachBundle> {
  const payload = await getJson<unknown>(
    `/public/gameview/games/${gameId}/coaches`,
  );
  return normalizePublicCoachBundle(payload);
}

export async function getGameShotTotalsFromStats(
  gameId: string,
): Promise<{ homeShots: number; awayShots: number } | null> {
  const payload = await getJson<unknown>(
    `/stats/game?gameId=${encodeURIComponent(gameId)}`,
  );
  const rows = extractListPayload(payload, "game stats");
  const first = asObject(rows[0]);
  if (!first) return null;

  return {
    homeShots: pickNumber(first, "homeShots", "HomeShots"),
    awayShots: pickNumber(first, "awayShots", "AwayShots"),
  };
}

export async function getTeamRosterMobile(
  teamId: string,
): Promise<ApiRosterPlayer[]> {
  const res = await authFetch(`/teams/${teamId}/roster-mobile`);
  if (res.status === 404) {
    return [];
  }
  if (!res.ok) {
    throw new Error(
      `Request failed (${res.status}) for /teams/${teamId}/roster-mobile`,
    );
  }
  return normalizeRosterPlayers(await res.json());
}

export async function getTeamCoachesMobile(
  teamId: string,
): Promise<ApiTeamCoach[]> {
  const res = await authFetch(`/teams/${teamId}/coaches-mobile`);
  if (res.status === 404) {
    return [];
  }
  if (!res.ok) {
    throw new Error(
      `Request failed (${res.status}) for /teams/${teamId}/coaches-mobile`,
    );
  }
  return normalizeTeamCoaches(await res.json());
}

declare global {
  interface Window {
    apiBase?: string;
  }
}
