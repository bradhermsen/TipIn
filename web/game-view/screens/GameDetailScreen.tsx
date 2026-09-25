import React, { useEffect, useMemo, useRef, useState } from "react";
import { EventFeed } from "../components/EventFeed";
import { GameViewBrand } from "../components/GameViewBrand";
import { GameViewFooter } from "../components/GameViewFooter";
import { GameManagerPromoLink } from "../components/GameManagerPromoLink";
import { MiniScoreboard } from "../components/MiniScoreboard";
import { RosterTabs, type RosterPlayerRow } from "../components/RosterTabs";
import type { GameEventRow } from "../components/EventFeed";
import {
  getGameById,
  getPublicGameCoaches,
  getPublicGameRosters,
  getGameSummaryReport,
  getGameSummaryMobile,
  getTeams,
} from "../api/gameViewApi";
import type {
  ApiGameSummary,
  ApiGameSummaryReport,
  ApiTeamCoach,
} from "../types/gameView";
import "../styles/game-view.css";

const FINAL_STATUS_KEYS = new Set(["final", "completed", "closed"]);

type GameDetailStaticData = {
  teams: Awaited<ReturnType<typeof getTeams>>;
  rosterBundle: Awaited<ReturnType<typeof getPublicGameRosters>>;
  coachesBundle: Awaited<ReturnType<typeof getPublicGameCoaches>>;
};

function readGameIdFromLocation() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("gameId") || "";
}

function readSelectedTeamIdFromLocation() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("teamId") || "";
}

function formatEventTime(period?: number, timeInPeriod?: string) {
  if (period && timeInPeriod) {
    return `P${period} ${timeInPeriod}`;
  }
  if (period) return `P${period}`;
  if (timeInPeriod) return timeInPeriod;
  return "Time N/A";
}

function parseClockToSeconds(timeInPeriod?: string): number {
  const raw = String(timeInPeriod || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return -1;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return -1;
  return minutes * 60 + seconds;
}

function normalizeTeamType(raw?: string | null): string {
  const value = String(raw || "")
    .trim()
    .toLowerCase();
  if (value.startsWith("girl")) return "Girls";
  if (value.startsWith("boy")) return "Boys";
  return "";
}

function withMascot(teamName: string, mascot?: string | null): string {
  const base = String(teamName || "").trim() || "Team";
  const mascotText = String(mascot || "").trim();
  if (!mascotText) return base;
  if (base.toLowerCase().includes(mascotText.toLowerCase())) return base;
  return `${base} ${mascotText}`;
}

function toPeriodToken(period?: number): string {
  if (!period || period <= 0) return "";
  if (period >= 4) return "OT";
  if (period === 1) return "1ST";
  if (period === 2) return "2ND";
  if (period === 3) return "3RD";
  return `${period}TH`;
}

function inferCurrentPeriodFromStatus(statusRaw: string): number | undefined {
  const value = String(statusRaw || "").toLowerCase();
  if (!value) return undefined;

  if (value.includes("ot") || value.includes("overtime")) {
    return 4;
  }

  const periodTokenMatch = value.match(/\b(?:p|period)\s*([1-3])\b/i);
  if (periodTokenMatch) {
    const period = Number(periodTokenMatch[1]);
    if (period >= 1 && period <= 3) return period;
  }

  const ordinalMatch = value.match(/\b([1-3])(st|nd|rd)\b/i);
  if (ordinalMatch) {
    const period = Number(ordinalMatch[1]);
    if (period >= 1 && period <= 3) return period;
  }

  return undefined;
}

function buildScoreFromSummary(
  summary: ApiGameSummary | null,
  homeTeamName: string,
  awayTeamName: string,
) {
  const homeKey = homeTeamName.trim().toLowerCase();
  const awayKey = awayTeamName.trim().toLowerCase();
  let homeScore = 0;
  let awayScore = 0;

  for (const goal of summary?.goals || []) {
    const teamKey = String(goal.teamName || "")
      .trim()
      .toLowerCase();
    if (teamKey === homeKey) homeScore += 1;
    if (teamKey === awayKey) awayScore += 1;
  }

  return { homeScore, awayScore };
}

function isFinalStatus(status?: string): boolean {
  const key = String(status || "")
    .trim()
    .toLowerCase();
  return FINAL_STATUS_KEYS.has(key);
}

function formatNumberAndName(
  numberValue: number | null | undefined,
  name: string,
): string {
  const player = String(name || "").trim() || "Unknown";
  if (typeof numberValue === "number" && Number.isFinite(numberValue)) {
    return `#${numberValue} ${player}`;
  }
  return player;
}

function formatVenue(arenaName: string, rinkName: string): string {
  const arena = String(arenaName || "").trim();
  const rink = String(rinkName || "").trim();
  if (arena && rink) return `${arena} - ${rink}`;
  return arena || rink || "Venue not recorded";
}

export function GameDetailScreen() {
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [gameTitle, setGameTitle] = useState("");
  const [periodLabel, setPeriodLabel] = useState("Period -");
  const [statusLabel, setStatusLabel] = useState("Scheduled");
  const [isInProgress, setIsInProgress] = useState(false);
  const [homeTeamName, setHomeTeamName] = useState("Home");
  const [awayTeamName, setAwayTeamName] = useState("Away");
  const [homeTeamDisplayName, setHomeTeamDisplayName] = useState("Home");
  const [awayTeamDisplayName, setAwayTeamDisplayName] = useState("Away");
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [homeShots, setHomeShots] = useState(0);
  const [awayShots, setAwayShots] = useState(0);
  const [homeShotsP1, setHomeShotsP1] = useState<number | undefined>(undefined);
  const [homeShotsP2, setHomeShotsP2] = useState<number | undefined>(undefined);
  const [homeShotsP3, setHomeShotsP3] = useState<number | undefined>(undefined);
  const [awayShotsP1, setAwayShotsP1] = useState<number | undefined>(undefined);
  const [awayShotsP2, setAwayShotsP2] = useState<number | undefined>(undefined);
  const [awayShotsP3, setAwayShotsP3] = useState<number | undefined>(undefined);
  const [currentPeriodNumber, setCurrentPeriodNumber] = useState<
    number | undefined
  >(undefined);
  const [activeRosterTab, setActiveRosterTab] = useState<"home" | "away">(
    "home",
  );
  const [homeRoster, setHomeRoster] = useState<RosterPlayerRow[]>([]);
  const [awayRoster, setAwayRoster] = useState<RosterPlayerRow[]>([]);
  const [homeCoaches, setHomeCoaches] = useState<ApiTeamCoach[]>([]);
  const [awayCoaches, setAwayCoaches] = useState<ApiTeamCoach[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [events, setEvents] = useState<GameEventRow[]>([]);
  const [summaryReport, setSummaryReport] =
    useState<ApiGameSummaryReport | null>(null);
  const [goalieStatsNotice, setGoalieStatsNotice] = useState("");
  const rosterTabInitializedRef = useRef(false);
  const staticDataRef = useRef<GameDetailStaticData | null>(null);

  const gameId = useMemo(() => readGameIdFromLocation(), []);
  const selectedTeamId = useMemo(() => readSelectedTeamIdFromLocation(), []);

  function handleBackToMain() {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.delete("gameId");
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.location.assign(nextUrl);
  }

  useEffect(() => {
    let cancelled = false;
    const isBackgroundRefresh = refreshNonce > 0;

    async function load() {
      if (!gameId) {
        setErrorMessage("Missing gameId in URL.");
        setIsLoading(false);
        return;
      }

      if (!isBackgroundRefresh) {
        setIsLoading(true);
        setErrorMessage("");
      }

      try {
        const staticDataPromise = staticDataRef.current
          ? Promise.resolve(staticDataRef.current)
          : Promise.all([
              getTeams(),
              getPublicGameRosters(gameId),
              getPublicGameCoaches(gameId).catch(() => ({
                homeCoaches: [],
                awayCoaches: [],
              })),
            ]).then(([teams, rosterBundle, coachesBundle]) => ({
              teams,
              rosterBundle,
              coachesBundle,
            }));

        const [game, summary, staticData] = await Promise.all([
          getGameById(gameId),
          getGameSummaryMobile(gameId),
          staticDataPromise,
        ]);
        staticDataRef.current = staticData;
        const { teams, rosterBundle, coachesBundle } = staticData;
        const shouldLoadReport =
          !isBackgroundRefresh || isFinalStatus(String(game.status || ""));
        const reportResult = shouldLoadReport
          ? await getGameSummaryReport(gameId)
              .then((report) => ({ ok: true as const, report }))
              .catch(() => ({ ok: false as const, report: null }))
          : null;

        if (cancelled) return;

        const nextHomeName = String(game.homeTeamName || "Home");
        const nextAwayName = String(game.awayTeamName || "Away");
        setHomeTeamName(nextHomeName);
        setAwayTeamName(nextAwayName);

        const homeTeamMeta = teams.find(
          (team) => String(team.teamId) === String(game.homeTeamId),
        );
        const awayTeamMeta = teams.find(
          (team) => String(team.teamId) === String(game.awayTeamId),
        );
        const nextHomeDisplay = withMascot(
          nextHomeName,
          homeTeamMeta?.teamMascot || null,
        );
        const nextAwayDisplay = withMascot(
          nextAwayName,
          awayTeamMeta?.teamMascot || null,
        );
        setHomeTeamDisplayName(nextHomeDisplay);
        setAwayTeamDisplayName(nextAwayDisplay);
        const typeLabel =
          normalizeTeamType(homeTeamMeta?.teamType) ||
          normalizeTeamType(awayTeamMeta?.teamType);
        const levelLabel = String(
          homeTeamMeta?.levelName || awayTeamMeta?.levelName || "",
        ).trim();
        const detailSuffix = [typeLabel, levelLabel]
          .filter(Boolean)
          .join(" ")
          .trim();

        setGameTitle(
          detailSuffix
            ? `${nextAwayDisplay} at ${nextHomeDisplay} - ${detailSuffix}`
            : `${nextAwayDisplay} at ${nextHomeDisplay}`,
        );

        const periodCandidates = [
          ...(summary?.goals?.map((goal) => Number(goal.period)) || []),
          ...(summary?.penalties?.map((penalty) => Number(penalty.period)) ||
            []),
        ].filter((period) => Number.isFinite(period) && period > 0);
        const maxPeriodFromEvents = periodCandidates.length
          ? Math.max(...periodCandidates)
          : undefined;
        const maxPeriodFromShots = [
          summary?.homeShotsP1,
          summary?.awayShotsP1,
          summary?.homeShotsP2,
          summary?.awayShotsP2,
          summary?.homeShotsP3,
          summary?.awayShotsP3,
        ].some((value) => typeof value === "number")
          ? [
              typeof summary?.homeShotsP3 === "number" ||
              typeof summary?.awayShotsP3 === "number"
                ? 3
                : 0,
              typeof summary?.homeShotsP2 === "number" ||
              typeof summary?.awayShotsP2 === "number"
                ? 2
                : 0,
              typeof summary?.homeShotsP1 === "number" ||
              typeof summary?.awayShotsP1 === "number"
                ? 1
                : 0,
            ].find((period) => period > 0)
          : undefined;

        const statusRaw = String(game.status || "SCHEDULED");
        const statusKey = statusRaw.toLowerCase();
        const isIntermission = statusKey.includes("intermission");
        const isInProgress =
          statusKey.includes("in progress") ||
          statusKey.includes("in_progress") ||
          statusKey.includes("live") ||
          statusKey.includes("ongoing");
        setIsInProgress(isInProgress);
        setStatusLabel(
          isIntermission
            ? "Intermission"
            : isInProgress
              ? "In Progress"
              : statusRaw,
        );

        const currentFromStatus = inferCurrentPeriodFromStatus(statusRaw);
        const resolvedCurrentPeriod =
          summary?.currentPeriod ||
          currentFromStatus ||
          maxPeriodFromShots ||
          maxPeriodFromEvents ||
          (isInProgress ? 1 : undefined);
        setCurrentPeriodNumber(resolvedCurrentPeriod);
        setPeriodLabel(toPeriodToken(resolvedCurrentPeriod));

        const score = buildScoreFromSummary(
          summary,
          nextHomeName,
          nextAwayName,
        );
        setHomeScore(score.homeScore);
        setAwayScore(score.awayScore);

        setHomeShots(
          typeof summary?.homeShots === "number"
            ? summary.homeShots
            : score.homeScore,
        );
        setAwayShots(
          typeof summary?.awayShots === "number"
            ? summary.awayShots
            : score.awayScore,
        );
        setHomeShotsP1(summary?.homeShotsP1);
        setHomeShotsP2(summary?.homeShotsP2);
        setHomeShotsP3(summary?.homeShotsP3);
        setAwayShotsP1(summary?.awayShotsP1);
        setAwayShotsP2(summary?.awayShotsP2);
        setAwayShotsP3(summary?.awayShotsP3);

        if (!rosterTabInitializedRef.current) {
          const selected = selectedTeamId.trim().toLowerCase();
          const homeId = String(game.homeTeamId || "")
            .trim()
            .toLowerCase();
          const awayId = String(game.awayTeamId || "")
            .trim()
            .toLowerCase();
          if (selected === awayId) {
            setActiveRosterTab("away");
          } else if (selected === homeId) {
            setActiveRosterTab("home");
          } else {
            setActiveRosterTab("home");
          }
          rosterTabInitializedRef.current = true;
        }

        const report = reportResult?.report ?? null;
        setHomeRoster(rosterBundle.homeRoster);
        setAwayRoster(rosterBundle.awayRoster);
        setHomeCoaches(coachesBundle.homeCoaches);
        setAwayCoaches(coachesBundle.awayCoaches);
        if (reportResult) setSummaryReport(report);
        setGoalieStatsNotice(rosterBundle.goalieStatsNotice || "");

        const mappedEvents = [
          ...(summary?.goals || []).map((goal) => ({
            eventId: `goal-${goal.eventId}`,
            eventType: "goal" as const,
            title: `${goal.teamName} GOAL - ${goal.scorerName || "Goal"}`,
            subtitle: (() => {
              const details = [goal.strength || "EV"];
              if (goal.assist1Name) {
                details.push(`A1: ${goal.assist1Name}`);
              }
              if (goal.assist2Name) {
                details.push(`A2: ${goal.assist2Name}`);
              }
              return details.join(" • ");
            })(),
            createdAtIso: formatEventTime(goal.period, goal.timeInPeriod),
            sortPeriod: Number(goal.period) || 0,
            sortTimeSeconds: parseClockToSeconds(goal.timeInPeriod),
          })),
          ...(summary?.penalties || []).map((penalty) => ({
            eventId: `penalty-${penalty.eventId}`,
            eventType: "penalty" as const,
            title: `${penalty.teamName} PENALTY - ${penalty.playerName}`,
            subtitle: `${penalty.durationMinutes} min • ${penalty.infraction}`,
            createdAtIso: formatEventTime(penalty.period, penalty.timeInPeriod),
            sortPeriod: Number(penalty.period) || 0,
            sortTimeSeconds: parseClockToSeconds(penalty.timeInPeriod),
          })),
          ...(summary?.shots || []).map((shot) => ({
            eventId: `shot-${shot.eventId}`,
            eventType: "shot" as const,
            title: `${shot.teamName} SHOT`,
            subtitle: "Shot on goal",
            createdAtIso: formatEventTime(shot.period, shot.timeInPeriod),
            sortPeriod: Number(shot.period) || 0,
            sortTimeSeconds: parseClockToSeconds(shot.timeInPeriod),
          })),
        ]
          .sort((a, b) => {
            const periodDiff = b.sortPeriod - a.sortPeriod;
            if (periodDiff !== 0) return periodDiff;
            return b.sortTimeSeconds - a.sortTimeSeconds;
          })
          .map(
            ({
              sortPeriod: _sortPeriod,
              sortTimeSeconds: _sortTimeSeconds,
              ...event
            }) => event,
          );

        setEvents(mappedEvents);
      } catch (error) {
        if (cancelled) return;
        if (!isBackgroundRefresh) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Unable to load game detail.",
          );
        }
      } finally {
        if (!cancelled && !isBackgroundRefresh) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [gameId, selectedTeamId, refreshNonce]);

  useEffect(() => {
    if (!gameId || !isInProgress) {
      return;
    }

    const timer = setInterval(() => {
      setRefreshNonce((prev) => prev + 1);
    }, 5000);

    return () => clearInterval(timer);
  }, [gameId, isInProgress]);

  return (
    <main className="game-view-root">
      <header className="game-view-header">
        <button
          type="button"
          className="game-view-menu-button game-view-back-button"
          onClick={handleBackToMain}
          aria-label="Back to GameView"
        >
          Back to GameView
        </button>

        <GameViewBrand />
        <GameManagerPromoLink />

        <p className="game-view-subtitle">
          {gameTitle || "Loading matchup..."}
        </p>
      </header>

      <div className="game-view-header-separator" aria-hidden="true" />

      {errorMessage ? <p className="game-view-error">{errorMessage}</p> : null}

      {isLoading ? (
        <p className="game-view-loading">Loading game detail...</p>
      ) : (
        <>
          <section className="game-view-section">
            <MiniScoreboard
              awayTeam={awayTeamDisplayName}
              homeTeam={homeTeamDisplayName}
              awayScore={awayScore}
              homeScore={homeScore}
              awayShots={awayShots}
              homeShots={homeShots}
              awayShotsP1={awayShotsP1}
              awayShotsP2={awayShotsP2}
              awayShotsP3={awayShotsP3}
              homeShotsP1={homeShotsP1}
              homeShotsP2={homeShotsP2}
              homeShotsP3={homeShotsP3}
              currentPeriodNumber={currentPeriodNumber}
              periodLabel={periodLabel}
              statusLabel={statusLabel}
              isInProgress={isInProgress}
            />
          </section>

          <section className="game-view-section">
            <EventFeed events={events} collapsible={isInProgress} />
          </section>

          {summaryReport && isFinalStatus(summaryReport.status) ? (
            <section className="game-view-section">
              <article className="game-view-summary-report-card">
                <h2 className="game-view-section-title">
                  Official Game Summary
                </h2>

                <div className="game-view-summary-meta-grid">
                  <p>
                    <strong>Final Score:</strong> {summaryReport.awayTeamName}{" "}
                    {summaryReport.awayGoals} - {summaryReport.homeGoals}{" "}
                    {summaryReport.homeTeamName}
                  </p>
                  <p>
                    <strong>Date:</strong>{" "}
                    {new Date(summaryReport.gameDateTime).toLocaleString()}
                  </p>
                  <p>
                    <strong>League:</strong> {summaryReport.leagueName || "N/A"}
                  </p>
                  <p>
                    <strong>Team Type:</strong>{" "}
                    {summaryReport.teamType || "N/A"}
                  </p>
                  <p>
                    <strong>Level:</strong>{" "}
                    {summaryReport.homeLevelName ||
                      summaryReport.awayLevelName ||
                      "N/A"}
                  </p>
                  <p>
                    <strong>Venue:</strong>{" "}
                    {formatVenue(
                      summaryReport.arenaName,
                      summaryReport.rinkName,
                    )}
                  </p>
                  <p>
                    <strong>Season:</strong> {summaryReport.seasonName || "N/A"}
                  </p>
                </div>

                <div className="game-view-summary-subsection">
                  <h3 className="game-view-summary-subtitle">Goals</h3>
                  {summaryReport.goals.length === 0 ? (
                    <p className="game-view-empty-text">No goals recorded.</p>
                  ) : (
                    <ul className="game-view-summary-list">
                      {summaryReport.goals.map((goal, idx) => (
                        <li
                          key={`${goal.period}-${goal.timeInPeriod}-${goal.teamName}-${idx}`}
                        >
                          P{goal.period} {goal.timeInPeriod} - {goal.teamName}:{" "}
                          {formatNumberAndName(goal.scorerNumber, goal.scorer)}
                          {goal.assist1
                            ? ` (A: ${formatNumberAndName(goal.assist1Number, goal.assist1)}${goal.assist2 ? `, ${formatNumberAndName(goal.assist2Number, goal.assist2)}` : ""})`
                            : ""}
                          {goal.strength ? ` - ${goal.strength}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="game-view-summary-subsection">
                  <h3 className="game-view-summary-subtitle">Penalties</h3>
                  {summaryReport.penalties.length === 0 ? (
                    <p className="game-view-empty-text">
                      No penalties recorded.
                    </p>
                  ) : (
                    <ul className="game-view-summary-list">
                      {summaryReport.penalties.map((penalty, idx) => (
                        <li
                          key={`${penalty.period}-${penalty.timeInPeriod}-${penalty.playerName}-${idx}`}
                        >
                          P{penalty.period} {penalty.timeInPeriod} -{" "}
                          {penalty.teamName}:{" "}
                          {formatNumberAndName(
                            penalty.playerNumber,
                            penalty.playerName,
                          )}
                          {` (${penalty.infraction}, ${penalty.durationMinutes} min${penalty.penaltyType ? `, ${penalty.penaltyType}` : ""})`}
                          {penalty.notes ? ` - Notes: ${penalty.notes}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="game-view-summary-subsection">
                  <h3 className="game-view-summary-subtitle">
                    Goalie Shots By Period
                  </h3>
                  {summaryReport.goalies.length === 0 ? (
                    <p className="game-view-empty-text">
                      No goalie shot breakdown recorded.
                    </p>
                  ) : (
                    <ul className="game-view-summary-list">
                      {summaryReport.goalies.map((goalie, idx) => (
                        <li
                          key={`${goalie.teamName}-${goalie.goalieName}-${idx}`}
                        >
                          {goalie.teamName}: {goalie.goalieName} (P1 {goalie.p1}
                          , P2 {goalie.p2}, P3 {goalie.p3}, OT {goalie.ot},
                          Total {goalie.total})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="game-view-summary-subsection">
                  <h3 className="game-view-summary-subtitle">Officials</h3>
                  {summaryReport.officials.length === 0 ? (
                    <p className="game-view-empty-text">
                      No officials recorded.
                    </p>
                  ) : (
                    <ul className="game-view-summary-list">
                      {summaryReport.officials.map((official, idx) => (
                        <li
                          key={`${official.role}-${official.officialName}-${idx}`}
                        >
                          {official.role}:{" "}
                          {official.officialName || "Unassigned"}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="game-view-summary-subsection">
                  <h3 className="game-view-summary-subtitle">
                    Suspension Reviews
                  </h3>
                  {summaryReport.suspensionReviews.length === 0 ? (
                    <p className="game-view-empty-text">
                      No suspension review items.
                    </p>
                  ) : (
                    <ul className="game-view-summary-list">
                      {summaryReport.suspensionReviews.map((item, idx) => (
                        <li
                          key={`${item.period}-${item.timeInPeriod}-${item.playerName}-${idx}`}
                        >
                          P{item.period} {item.timeInPeriod} - {item.teamName}:{" "}
                          {formatNumberAndName(
                            item.playerNumber,
                            item.playerName,
                          )}
                          {item.suspensionBehavior
                            ? ` (${item.suspensionBehavior})`
                            : ""}
                          {item.reviewRequired ? " - Review Required" : ""}
                          {item.requiresRefereeNotes
                            ? " - Ref Notes Required"
                            : ""}
                          {item.notes ? ` - Notes: ${item.notes}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            </section>
          ) : null}

          <section className="game-view-section">
            <RosterTabs
              homeTeamName={homeTeamDisplayName}
              awayTeamName={awayTeamDisplayName}
              homeRoster={homeRoster}
              awayRoster={awayRoster}
              homeCoaches={homeCoaches}
              awayCoaches={awayCoaches}
              activeTab={activeRosterTab}
              onTabChange={setActiveRosterTab}
              goalieStatsNotice={goalieStatsNotice}
              collapsible={isInProgress}
            />
          </section>
        </>
      )}
      <GameViewFooter />
    </main>
  );
}
