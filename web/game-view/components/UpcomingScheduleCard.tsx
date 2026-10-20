import React from "react";
import type { UpcomingScheduleItemModel } from "../types/gameView";
import { ManagedBadge } from "./ManagedBadge";

interface Props {
  games: UpcomingScheduleItemModel[];
}

export function UpcomingScheduleCard({ games }: Props) {
  return (
    <section className="game-view-schedule-card" aria-label="Upcoming Schedule">
      <h2 className="game-view-schedule-title">Upcoming Schedule</h2>

      {games.length === 0 ? (
        <p className="game-view-empty-text">No scheduled games found.</p>
      ) : (
        <ul className="game-view-schedule-list">
          {games.map((game) => {
            const start = new Date(game.startTimeIso);
            const dateText = Number.isNaN(start.getTime())
              ? "TBD"
              : start.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                });
            const timeText = Number.isNaN(start.getTime())
              ? ""
              : start.toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                });

            return (
              <li key={game.gameId} className="game-view-schedule-row">
                {game.isTipInManaged ? <ManagedBadge /> : null}
                <p className="game-view-schedule-matchup">
                  {game.matchupLabel ||
                    `${game.awayTeamName} at ${game.homeTeamName}`}
                </p>
                <p className="game-view-schedule-meta">
                  {dateText}
                  {timeText ? ` • ${timeText}` : ""}
                  {game.status ? ` • ${game.status}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
