# TipIn GameView (Web)

This module hosts the mobile-optimized web implementation for GameView.

## Scope

- Current season only.
- Main page filters: Organization, Team, Team Type (Girls/Boys).
- Games In Progress, Today's Games, Upcoming Schedule, and Recent Finals.
- Game Detail mini scoreboard, roster tabs, and event feed.

## Today's Games

- Scheduled games dated today in America/Chicago appear as clickable matchup cards, once per game, ordered by start time. Filters, search, pagination, and the TipIn Managed badge match the live cards. Cancelled, postponed, completed, and live games are excluded.
- The homepage refreshes every 15 seconds without replacing visible cards with a loading screen. A game's status, not its scheduled start time, moves it into Games In Progress. Upcoming Schedule excludes today's games and past dates to avoid duplicate listings.
- Opening a scheduled game uses the existing detail page. Rosters, coaches, and starters refresh with the existing five-second detail polling, rather than remaining cached from the first visit. Missing starters are labeled "Starting lineup not yet available."
- API times without an offset are Central scheduled wall-clock values; timezone-bearing timestamps are converted to Central when deciding which calendar date they belong to. Today's card times are labeled Central.
- Run `npm test` and `npm run build` in this directory. Tests use Node's test runner and the existing TypeScript compiler; no API writes or real emails are required.

## Structure

- screens/
- components/
- services/
- hooks/
- types/
- styles/
- state/
- api/
- assets/

## API Notes

- Current endpoint mapping and fallback behaviors are documented in API-Compatibility.md.
