# GameView API Compatibility

Date: 2026-08-03

This module is wired to currently available TipIn API routes.

## Implemented Route Mapping

- `GET /organizations`
- `GET /teams`
- `GET /teams/by-organization/{organizationId}`
- `GET /seasons`
- `GET /games`
- `GET /games/{id}`
- `GET /teams/{teamId}/nextgame`
- `GET /games/{gameId}/summary-mobile`

## Requested Prompt Routes vs Current Backend

Requested in prompt:

- `GET /games/{id}/roster`
- `GET /games/{id}/events`
- `GET /games/{id}/scoreboard`
- `GET /schedule/upcoming?limit=3`

Current backend:

- `GET /games/{id}/roster` is not present. Current available route is team-based roster: `GET /teams/{teamId}/roster` and mobile route `GET /teams/{teamId}/roster-mobile`.
- `GET /games/{id}/events` is not present as a single endpoint. Current available game summary/events route is `GET /games/{gameId}/summary-mobile` (goals and penalties).
- `GET /games/{id}/scoreboard` is not present.
- `GET /schedule/upcoming?limit=3` is not present.

## Current Service Fallback Behavior

- Upcoming schedule is derived from `GET /games` and filtered/sorted client-side.
- Current season is resolved from `GET /seasons` (`isActive` + date range, fallback to latest season end date).
- Main page filters are applied using team metadata from `GET /teams`/`GET /teams/by-organization/{organizationId}`.
- Quick score preview for live/final cards is derived from `GET /games/{gameId}/summary-mobile` goal counts.

## Recommendation

For full feature parity, add these backend routes:

1. `GET /schedule/upcoming?limit=3&seasonId=&organizationId=&teamId=&teamType=`
2. `GET /games/{id}/events` with normalized event schema (goals, penalties, shots, goalie events).
3. `GET /games/{id}/scoreboard` with period, clock, and score snapshot.
