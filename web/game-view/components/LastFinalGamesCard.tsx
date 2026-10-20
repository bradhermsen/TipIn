import React from "react";
import type { LastFinalGameItemModel } from "../types/gameView";
import { ManagedBadge } from "./ManagedBadge";

interface Props {
  games: LastFinalGameItemModel[];
  onClick: (gameId: string) => void;
}

export function LastFinalGamesCard({ games, onClick }: Props) {
  return (
    <section className="game-view-section" aria-label="Game Finals">
      <h2 className="game-view-section-title">Game Finals</h2>

      {games.length === 0 ? (
        <p className="game-view-empty-text">No final games found.</p>
      ) : (
        <div className="game-view-card-grid">
          {games.map((game) => {
            const at = new Date(game.gameDateIso);
            const dateText = Number.isNaN(at.getTime())
              ? "TBD"
              : at.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                });

            return (
              <button
                key={game.gameId}
                type="button"
                className="game-view-schedule-card game-view-schedule-card-button"
                onClick={() => onClick(game.gameId)}
              >
                {game.isTipInManaged ? <ManagedBadge /> : null}
                <p className="game-view-schedule-matchup">
                  {game.matchupLabel ||
                    `${game.awayTeamName} at ${game.homeTeamName}`}
                </p>
                <p className="game-view-schedule-meta">
                  {dateText} • {game.status}
                </p>
                <p className="game-view-schedule-meta">{game.scoreText}</p>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
