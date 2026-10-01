import React, { useEffect, useMemo, useState } from "react";
import { GameViewBrand } from "../components/GameViewBrand";
import { GameViewFooter } from "../components/GameViewFooter";
import { GameManagerPromoLink } from "../components/GameManagerPromoLink";
import { LastFinalGamesCard } from "../components/LastFinalGamesCard";
import { NextGameCard } from "../components/NextGameCard";
import { UpcomingScheduleCard } from "../components/UpcomingScheduleCard";
import {
  fetchGameViewSnapshot,
  fetchFilterData,
  fetchLastFinalGamesByTeam,
  fetchNextGamesByTeam,
  fetchUpcomingSchedule,
} from "../services/gameViewService";
import type {
  GameViewFilterData,
  GameViewFilters,
  LastFinalGameItemModel,
  NextGameCardModel,
  UpcomingScheduleItemModel,
} from "../types/gameView";
import "../styles/game-view.css";

const PAGE_SIZE = 5;

function readFiltersFromLocation(): GameViewFilters {
  if (typeof window === "undefined") {
    return {
      seasonId: "",
      organizationId: "",
      leagueId: "",
      teamLevel: "",
      teamType: "",
    };
  }

  const params = new URLSearchParams(window.location.search);
  const teamTypeRaw = params.get("teamType") || "";
  const teamType =
    teamTypeRaw === "Girls" || teamTypeRaw === "Boys" ? teamTypeRaw : "";

  return {
    seasonId: params.get("seasonId") || "",
    organizationId: params.get("organizationId") || "",
    leagueId: params.get("leagueId") || "",
    teamLevel: params.get("teamLevel") || "",
    teamType,
  };
}

function syncFiltersToLocation(filters: GameViewFilters) {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  if (filters.seasonId) params.set("seasonId", filters.seasonId);
  else params.delete("seasonId");

  if (filters.organizationId)
    params.set("organizationId", filters.organizationId);
  else params.delete("organizationId");

  params.delete("teamId");

  if (filters.leagueId) params.set("leagueId", filters.leagueId);
  else params.delete("leagueId");

  if (filters.teamLevel) params.set("teamLevel", filters.teamLevel);
  else params.delete("teamLevel");

  if (filters.teamType) params.set("teamType", filters.teamType);
  else params.delete("teamType");

  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
  window.history.replaceState(null, "", nextUrl);
}

function mapUiErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message || "Unable to load GameView data.";
}

export function GameViewMainScreen() {
  const [filters, setFilters] = useState<GameViewFilters>(() =>
    readFiltersFromLocation(),
  );
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterData, setFilterData] = useState<GameViewFilterData>({
    seasons: [],
    currentSeasonId: "",
    organizations: [],
    leagues: [],
    teamLevels: [],
  });
  const [nextGames, setNextGames] = useState<NextGameCardModel[]>([]);
  const [upcomingGames, setUpcomingGames] = useState<
    UpcomingScheduleItemModel[]
  >([]);
  const [lastFinalGames, setLastFinalGames] = useState<
    LastFinalGameItemModel[]
  >([]);
  const [nextGamesPage, setNextGamesPage] = useState(1);
  const [upcomingPage, setUpcomingPage] = useState(1);
  const [finalsPage, setFinalsPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    syncFiltersToLocation(filters);
  }, [filters]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setErrorMessage("");

      try {
        const snapshot = await fetchGameViewSnapshot(filters);
        const scopedFilterData = await fetchFilterData({
          seasonId: filters.seasonId,
          organizationId: filters.organizationId,
          leagueId: filters.leagueId,
          teamType: filters.teamType,
        }, snapshot);

        if (cancelled) return;

        const seasonExists = scopedFilterData.seasons.some(
          (season) => season.id === filters.seasonId,
        );
        if (!seasonExists && scopedFilterData.currentSeasonId) {
          setFilters((prev) => ({
            ...prev,
            seasonId: scopedFilterData.currentSeasonId,
            teamLevel: "",
          }));
          return;
        }

        const levelExists = scopedFilterData.teamLevels.some(
          (level) => level.id === filters.teamLevel,
        );
        if (filters.teamLevel && !levelExists) {
          setFilters((prev) => ({ ...prev, teamLevel: "" }));
          return;
        }

        setFilterData(scopedFilterData);

        const [cards, schedule, finals] = await Promise.all([
          fetchNextGamesByTeam(filters, snapshot),
          fetchUpcomingSchedule(filters, snapshot),
          fetchLastFinalGamesByTeam(filters, snapshot),
        ]);

        if (cancelled) return;

        setNextGames(cards);
        setUpcomingGames(schedule);
        setLastFinalGames(finals);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(mapUiErrorMessage(error));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [filters]);

  const visibleNextGames = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return nextGames;

    return nextGames.filter((game) => {
      const haystack = [game.teamName, game.opponentName, game.status]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [nextGames, searchQuery]);

  const visibleUpcomingGames = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return upcomingGames;

    return upcomingGames.filter((game) => {
      const haystack = [game.homeTeamName, game.awayTeamName, game.status]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [upcomingGames, searchQuery]);

  const visibleLastFinalGames = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return lastFinalGames;

    return lastFinalGames.filter((game) => {
      const haystack = [
        game.homeTeamName,
        game.awayTeamName,
        game.status,
        game.scoreText,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [lastFinalGames, searchQuery]);

  useEffect(() => {
    setNextGamesPage(1);
    setUpcomingPage(1);
    setFinalsPage(1);
  }, [filters, searchQuery]);

  const nextGamesTotalPages = Math.max(
    1,
    Math.ceil(visibleNextGames.length / PAGE_SIZE),
  );
  const upcomingTotalPages = Math.max(
    1,
    Math.ceil(visibleUpcomingGames.length / PAGE_SIZE),
  );
  const finalsTotalPages = Math.max(
    1,
    Math.ceil(visibleLastFinalGames.length / PAGE_SIZE),
  );

  const pagedNextGames = useMemo(() => {
    const start =
      (Math.min(nextGamesPage, nextGamesTotalPages) - 1) * PAGE_SIZE;
    return visibleNextGames.slice(start, start + PAGE_SIZE);
  }, [visibleNextGames, nextGamesPage, nextGamesTotalPages]);

  const pagedUpcomingGames = useMemo(() => {
    const start = (Math.min(upcomingPage, upcomingTotalPages) - 1) * PAGE_SIZE;
    return visibleUpcomingGames.slice(start, start + PAGE_SIZE);
  }, [visibleUpcomingGames, upcomingPage, upcomingTotalPages]);

  const pagedFinalGames = useMemo(() => {
    const start = (Math.min(finalsPage, finalsTotalPages) - 1) * PAGE_SIZE;
    return visibleLastFinalGames.slice(start, start + PAGE_SIZE);
  }, [visibleLastFinalGames, finalsPage, finalsTotalPages]);

  function handleGameCardClick(gameId: string) {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("gameId", gameId);
    const nextUrl = `${window.location.pathname}?${params.toString()}`;
    window.location.assign(nextUrl);
  }

  return (
    <main className="game-view-root">
      <header className="game-view-header">
        <button
          type="button"
          className="game-view-menu-button"
          onClick={() => setIsFilterMenuOpen(true)}
          aria-label="Open filters"
        >
          ☰
        </button>

        <GameViewBrand />
        <GameManagerPromoLink />
      </header>

      <div className="game-view-header-separator" aria-hidden="true" />

      {isFilterMenuOpen ? (
        <div
          className="game-view-drawer-overlay"
          onClick={() => setIsFilterMenuOpen(false)}
        >
          <aside
            className="game-view-filter-drawer"
            aria-label="Game filters"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="game-view-drawer-header">
              <h2 className="game-view-section-title">Filters</h2>
              <button
                type="button"
                className="game-view-drawer-close"
                onClick={() => setIsFilterMenuOpen(false)}
                aria-label="Close filters"
              >
                ✕
              </button>
            </div>

            <section className="game-view-filter-panel">
              <label className="game-view-filter-field">
                <span>Season</span>
                <select
                  value={filters.seasonId}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      seasonId: event.target.value,
                      teamLevel: "",
                    }))
                  }
                >
                  {filterData.seasons.map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="game-view-filter-field">
                <span>Organization</span>
                <select
                  value={filters.organizationId}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      organizationId: event.target.value,
                      teamLevel: "",
                    }))
                  }
                >
                  <option value="">All Organizations</option>
                  {filterData.organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="game-view-filter-field">
                <span>Team Type</span>
                <select
                  value={filters.teamType}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      teamType:
                        event.target.value === "Girls" ||
                        event.target.value === "Boys"
                          ? event.target.value
                          : "",
                      teamLevel: "",
                    }))
                  }
                >
                  <option value="">All</option>
                  <option value="Girls">Girls</option>
                  <option value="Boys">Boys</option>
                </select>
              </label>

              <label className="game-view-filter-field">
                <span>Team Level</span>
                <select
                  value={filters.teamLevel}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      teamLevel: event.target.value,
                    }))
                  }
                >
                  <option value="">All Levels</option>
                  {filterData.teamLevels.map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="game-view-filter-field">
                <span>League</span>
                <select
                  value={filters.leagueId}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      leagueId: event.target.value,
                      teamLevel: "",
                    }))
                  }
                >
                  <option value="">All Leagues</option>
                  {filterData.leagues.map((league) => (
                    <option key={league.id} value={league.id}>
                      {league.label}
                    </option>
                  ))}
                </select>
              </label>
            </section>
          </aside>
        </div>
      ) : null}

      {errorMessage ? <p className="game-view-error">{errorMessage}</p> : null}

      {isLoading ? (
        <p className="game-view-loading">Loading games...</p>
      ) : (
        <>
          <section className="game-view-section">
            <label className="game-view-search-pill" aria-label="Search games">
              <span className="game-view-search-icon" aria-hidden="true">
                ⌕
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search team, opponent, or status"
                className="game-view-search-input"
              />
            </label>
          </section>

          <section className="game-view-section">
            <h2 className="game-view-section-title">Games In Progress</h2>
            {pagedNextGames.length === 0 ? (
              <p className="game-view-empty-text">
                No games in progress found for current filters.
              </p>
            ) : (
              <div className="game-view-card-grid">
                {pagedNextGames.map((game) => (
                  <NextGameCard
                    key={`${game.teamId}-${game.gameId}`}
                    game={game}
                    onClick={handleGameCardClick}
                  />
                ))}
              </div>
            )}

            <div className="game-view-pagination">
              <button
                type="button"
                className="game-view-tab"
                onClick={() =>
                  setNextGamesPage((prev) => Math.max(1, prev - 1))
                }
                disabled={nextGamesPage <= 1}
              >
                Prev
              </button>
              <span className="game-view-pagination-text">
                Page {Math.min(nextGamesPage, nextGamesTotalPages)} of{" "}
                {nextGamesTotalPages}
              </span>
              <button
                type="button"
                className="game-view-tab"
                onClick={() =>
                  setNextGamesPage((prev) =>
                    Math.min(nextGamesTotalPages, prev + 1),
                  )
                }
                disabled={nextGamesPage >= nextGamesTotalPages}
              >
                Next
              </button>
            </div>
          </section>

          <section className="game-view-section">
            <UpcomingScheduleCard games={pagedUpcomingGames} />

            <div className="game-view-pagination">
              <button
                type="button"
                className="game-view-tab"
                onClick={() => setUpcomingPage((prev) => Math.max(1, prev - 1))}
                disabled={upcomingPage <= 1}
              >
                Prev
              </button>
              <span className="game-view-pagination-text">
                Page {Math.min(upcomingPage, upcomingTotalPages)} of{" "}
                {upcomingTotalPages}
              </span>
              <button
                type="button"
                className="game-view-tab"
                onClick={() =>
                  setUpcomingPage((prev) =>
                    Math.min(upcomingTotalPages, prev + 1),
                  )
                }
                disabled={upcomingPage >= upcomingTotalPages}
              >
                Next
              </button>
            </div>
          </section>

          <section className="game-view-section">
            <LastFinalGamesCard
              games={pagedFinalGames}
              onClick={handleGameCardClick}
            />

            <div className="game-view-pagination">
              <button
                type="button"
                className="game-view-tab"
                onClick={() => setFinalsPage((prev) => Math.max(1, prev - 1))}
                disabled={finalsPage <= 1}
              >
                Prev
              </button>
              <span className="game-view-pagination-text">
                Page {Math.min(finalsPage, finalsTotalPages)} of{" "}
                {finalsTotalPages}
              </span>
              <button
                type="button"
                className="game-view-tab"
                onClick={() =>
                  setFinalsPage((prev) => Math.min(finalsTotalPages, prev + 1))
                }
                disabled={finalsPage >= finalsTotalPages}
              >
                Next
              </button>
            </div>
          </section>
        </>
      )}
      <GameViewFooter />
    </main>
  );
}
