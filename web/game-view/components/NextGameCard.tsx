import React from "react";
import type { NextGameCardModel } from "../types/gameView";
import { ManagedBadge } from "./ManagedBadge";

interface Props {
  game: NextGameCardModel;
  onClick: (gameId: string) => void;
}

export function NextGameCard({ game, onClick }: Props) {
  const start = new Date(game.startTimeIso);
  const centralOptions = !game.isLive && /(?:Z|[+-]\d{2}:\d{2})$/i.test(game.startTimeIso)
    ? { timeZone: "America/Chicago" } : {};
  const dateText = Number.isNaN(start.getTime())
    ? "TBD"
    : start.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        ...centralOptions,
      });
  const timeText = Number.isNaN(start.getTime())
    ? ""
    : start.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        ...centralOptions,
      });

  const showScore =
    typeof game.homeScore === "number" && typeof game.awayScore === "number";

  const matchupLabel =
    game.matchupLabel || `${game.opponentName} at ${game.teamName}`;

  return (
    <button
      type="button"
      className="game-view-next-card"
      onClick={() => onClick(game.gameId)}
    >
      <div className="game-view-next-card-top">
        <p className="game-view-card-eyebrow">{game.isLive ? "In Progress" : "Today"}</p>
        {game.isTipInManaged ? <ManagedBadge /> : null}
        {game.isLive ? <span className="game-view-live-pill">LIVE</span> : null}
      </div>

      <h3 className="game-view-next-card-title">{matchupLabel}</h3>

      <p className="game-view-next-card-meta">
        {dateText}
        {timeText ? ` • ${timeText}` : ""}
        {!game.isLive && timeText ? " Central" : ""}
      </p>
      <p className="game-view-next-card-status">Status: {game.status}</p>

      {showScore ? (
        <p className="game-view-next-card-score">
          Score: {game.awayScore} - {game.homeScore}
        </p>
      ) : null}
    </button>
  );
}
