import React, { useId, useState } from "react";
import type { ApiTeamCoach } from "../types/gameView";

export interface RosterPlayerRow {
  playerId: string;
  playerName: string;
  jerseyNumber: string;
  position: string;
  grade: string;
  isGoalie: boolean;
  isStarter: boolean;
  goals: number;
  assists: number;
  penaltyMinutes: number;
  shotsAgainst: number;
  goalsAgainst: number;
  goalsAgainstAverage: number;
  savePercentage: number;
  minutesPlayed: number;
}

interface Props {
  homeTeamName: string;
  awayTeamName: string;
  homeRoster: RosterPlayerRow[];
  awayRoster: RosterPlayerRow[];
  homeCoaches: ApiTeamCoach[];
  awayCoaches: ApiTeamCoach[];
  activeTab: "home" | "away";
  onTabChange: (tab: "home" | "away") => void;
  goalieStatsNotice?: string;
  collapsible?: boolean;
}

export function RosterTabs({
  homeTeamName,
  awayTeamName,
  homeRoster,
  awayRoster,
  homeCoaches,
  awayCoaches,
  activeTab,
  onTabChange,
  goalieStatsNotice = "",
  collapsible = false,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(true);
  const contentId = useId();
  const showContent = !collapsible || isExpanded;
  const rows = activeTab === "home" ? homeRoster : awayRoster;
  const coaches = activeTab === "home" ? homeCoaches : awayCoaches;
  const skaterRows = rows.filter((row) => !row.isGoalie);
  const goalieRows = rows.filter((row) => row.isGoalie);

  return (
    <section className="game-view-roster-card">
      <div className="game-view-card-title-row">
        <h2 className="game-view-section-title">Rosters</h2>
        {collapsible ? (
          <button
            type="button"
            className="game-view-collapse-button"
            aria-expanded={isExpanded}
            aria-controls={contentId}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} Rosters`}
            onClick={() => setIsExpanded((current) => !current)}
          >
            <span className="game-view-collapse-icon" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div id={contentId} hidden={!showContent}>
        <div
          className="game-view-tab-row"
          role="tablist"
          aria-label="Roster tabs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "home"}
            className={`game-view-tab ${activeTab === "home" ? "is-active" : ""}`}
            onClick={() => onTabChange("home")}
          >
            <span>{homeTeamName}</span>
            {activeTab === "home" ? (
              <span className="game-view-selected-tag">Selected</span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "away"}
            className={`game-view-tab ${activeTab === "away" ? "is-active" : ""}`}
            onClick={() => onTabChange("away")}
          >
            <span>{awayTeamName}</span>
            {activeTab === "away" ? (
              <span className="game-view-selected-tag">Selected</span>
            ) : null}
          </button>
        </div>

        {goalieStatsNotice ? (
          <p
            className="game-view-roster-notice"
            role="status"
            aria-live="polite"
          >
            {goalieStatsNotice}
          </p>
        ) : null}

        {rows.length === 0 ? (
          <p className="game-view-empty-text">No roster data available.</p>
        ) : (
          <div className="game-view-roster-grid-wrap">
            {!rows.some((row) => row.isStarter) ? (
              <p className="game-view-roster-notice">Starting lineup not yet available.</p>
            ) : null}
            <div className="game-view-roster-section">
              <h3 className="game-view-roster-subtitle">
                Forward / Defenseman
              </h3>
              <div className="game-view-roster-grid game-view-roster-grid-header game-view-roster-grid--skaters">
                <span>#</span>
                <span>POS</span>
                <span>PLAYER</span>
                <span>Grade</span>
                <span>Goals</span>
                <span>Assists</span>
                <span>PIM</span>
              </div>

              {skaterRows.length === 0 ? (
                <p className="game-view-empty-text">No skaters available.</p>
              ) : (
                skaterRows.map((row) => (
                  <div
                    key={row.playerId}
                    className="game-view-roster-grid game-view-roster-grid-row game-view-roster-grid--skaters"
                  >
                    <span>{row.jerseyNumber || "-"}</span>
                    <span>{row.position || "-"}</span>
                    <span>
                      {row.playerName}
                      {row.isStarter ? (
                        <span className="game-view-starter-badge">S</span>
                      ) : null}
                    </span>
                    <span>{row.grade || "-"}</span>
                    <span>{row.goals}</span>
                    <span>{row.assists}</span>
                    <span>{row.penaltyMinutes}</span>
                  </div>
                ))
              )}
            </div>

            {goalieRows.length > 0 ? (
              <div className="game-view-roster-section game-view-roster-section--goalies">
                <div
                  className="game-view-roster-separator"
                  aria-hidden="true"
                />
                <h3 className="game-view-roster-subtitle">Goalies</h3>
                <div className="game-view-roster-grid game-view-roster-grid-header game-view-roster-grid--goalies">
                  <span>#</span>
                  <span>POS</span>
                  <span>PLAYER</span>
                  <span>Shot total</span>
                  <span>GA</span>
                  <span>GAA</span>
                  <span>SVG</span>
                  <span>MIN</span>
                </div>

                {goalieRows.map((row) => (
                  <div
                    key={row.playerId}
                    className="game-view-roster-grid game-view-roster-grid-row game-view-roster-grid--goalies"
                  >
                    <span>{row.jerseyNumber || "-"}</span>
                    <span>{row.position || "G"}</span>
                    <span>
                      {row.playerName}
                      {row.isStarter ? (
                        <span className="game-view-starter-badge">S</span>
                      ) : null}
                    </span>
                    <span>{row.shotsAgainst || "-"}</span>
                    <span>
                      {row.minutesPlayed > 0
                        ? (Math.round(row.goalsAgainst * 10) / 10).toFixed(1)
                        : "-"}
                    </span>
                    <span>
                      {row.minutesPlayed > 0
                        ? row.goalsAgainstAverage.toFixed(2)
                        : "-"}
                    </span>
                    <span>
                      {row.minutesPlayed > 0 && row.shotsAgainst > 0
                        ? `${row.savePercentage.toFixed(1)}%`
                        : "-"}
                    </span>
                    <span>
                      {row.minutesPlayed > 0
                        ? row.minutesPlayed.toFixed(1)
                        : "-"}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}

        <section className="game-view-coach-data" aria-label="Team coach data">
          <h3 className="game-view-coach-data-title">Coaches</h3>
          {coaches.length === 0 ? (
            <p className="game-view-coach-data-empty">
              No coach data available.
            </p>
          ) : (
            <ul className="game-view-coach-data-list">
              {coaches.map((coach, index) => (
                <li
                  key={`${coach.roleName}-${coach.coachName}-${index}`}
                  className="game-view-coach-data-item"
                >
                  <span className="game-view-coach-role">{coach.roleName}</span>
                  <span className="game-view-coach-name">
                    {coach.coachName}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
