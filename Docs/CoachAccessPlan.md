# Coach Access & Mobile Roster Management Plan (Final)

## Goal
Admins invite coaches to specific teams. Coaches get a mobile-first area where they see only their teams, manage rosters, and confirm game-day participants and starters. Once the coach signs on the Game Manager tablet, the lineup is locked everywhere.

## Decisions

| Area | Decision |
|---|---|
| Tablet login | GM codes (`GM-` / `SM-`) only. No coach accounts on the tablet. |
| Tablet edits | Allowed until the coach signs. Saved to the server lineup. |
| Lock | Per game and team. Applies everywhere once signed, including the legacy anonymous `live-status` route. |
| Unlock | Admins only (SuperAdmin, OrgAdmin, OrgOwner), admin portal only. Reason required, logged. Coach must re-sign. |
| Coach app hosting | Separate site on its own subdomain (e.g. coach.tipinscoring.com), not part of the admin portal. |
| Email | Existing SMTP email service and admin email settings are reused. |
| Team labels | Invitation email subjects/bodies and coach-site team lists, headers, and opponents use `Team Level - Type` (for example, `Riverbend JV - Boys`). Missing level/type values are omitted. Raw API team names are preserved; display labels are additive. |
| Concurrent edits | Version check. Stale save rejected and the app reloads. No merge logic. |
| Coach email | Automated verification email. |
| Jersey numbers | Per team. `Players.jerseyNumber` is only a default copied when a player is first added to a team. Two-way sync removed. |
| Coach roster edits | Add players (with duplicate check), edit first/last name, position, grade, jersey number, soft-remove from own team. No birthdate. |
| Name / grade | Person-level, apply to all teams, audited. |
| Duplicates | Warn only. Merge tool deferred. |
| Same player on two teams, same date | Allowed with a warning. |
| Keep me signed in | 30-day sliding, 90-day cap, revocable, never on tablets. |
| Signed lineups | Snapshot of name, jersey, position at signing. Later roster edits do not change them. |

## Findings from the code inspection that drive the plan
- Tablet endpoints are anonymous (access-code login only), so lock enforcement must cover legacy routes.
- Starters live in `GameLiveStatus.HomeStartersJson/AwayStartersJson`, written by anonymous `PUT games/{id}/live-status`. No participants table, no lock.
- Tablet active/inactive toggles and the coach signature (typed name) are local app state only.
- Head coach comes from `Teams.HeadCoachName`, not from `CoachTeams` accounts.
- JWT is 12h with no refresh endpoint, revocation, or per-request active check. No registration or password reset exists. "External" organizations are blocked from login.
- OrgAdmin has no organization scoping in `TeamAuthorizationService`.
- Unscoped endpoints: `GET roster/{id}`, `GET teams/{id}/available-players`, `GET players/dto`, `GET players/{id}`, `PUT players/{id}` (any Coach), `GetCoachesForTeam`. `RemoveCoachFromTeam` parses a `dynamic` body.
- Jersey number syncs both ways between `Players` and `RosterEntries`. Removing a `PlayerTeams` row hard-deletes the roster entry.
- Game-day fields (`gamedayStatus`, `lineNumber`, `isActive`, `isGoalie`) sit on the standing roster entry.

## 1. Hardening (prerequisite)
- Enforce team assignment and organization on the endpoints listed above. Coaches see minimal data only.
- Add organization scoping for OrgAdmin on invites, coach assignment, and team access.
- Check user active state and team assignment on each request (or shorten token life).
- Replace the `dynamic` body in `RemoveCoachFromTeam`.
- Decide the organization type for coach accounts so login is not blocked.

## 2. Accounts, invites, sessions
- Invite action on a team in the admin portal. Each invite is tied to one team and one email, single-use, expiring (7 days).
- Token: high entropy, only the hash stored, consumed atomically, rate-limited, generic errors, never logged.
- Automated invite email. Acceptance confirms email ownership.
- Acceptance creates or links the account and adds the `CoachTeams` row. It never changes an existing role and does not reveal whether an account exists.
- Admins can view, revoke, regenerate invites, and remove coach access separately from invites.
- One coach account can hold many team assignments (Varsity and JV).
- Password reset by email. Refresh tokens with rotation and server-side revocation, cleared on password change or coach removal.
- Keep-me-signed-in: 30-day sliding, 90-day cap. Home-screen install and password autofill supported. Never on tablets.

## 3. Roster model
- Jersey number and position are per team on `RosterEntries`. Remove the two-way jersey sync (default copy on first add only). Update `RosterSyncRules.md`.
- Replace hard delete with soft delete (inactive) on the roster entry. Never touch other teams' entries.
- Move per-game state (participation, starters) out of the standing roster into the lineup.
- Audit log for every coach change (who, when, old and new values).

### Coach roster abilities
| Action | Rule |
|---|---|
| Add new player | Allowed, in the coach's organization, assigned to the coach's team only. Duplicate check first. |
| Add existing player | Same organization only. Search returns name, grade, jersey. Rate-limited. |
| Edit first/last name, grade | Immediate, person-level, audited. |
| Edit position, jersey | Immediate, team-level. |
| Remove player | Soft remove from own team. |
| Birthdate | Not collected or edited. |
| Permanent delete | Admin only. |

Duplicate check: same organization with normalized first and last name (grade and jersey as tie-breakers). Warn and let the coach choose "use existing" or "different player." The choice is audited. Show only the team name of the match.

## 4. Game-day lineup
- New per-game lineup table: game, team, participating roster-entry IDs, starters, version. Starters are a subset of participants.
- Server enforces rules: Varsity exactly 6 starters with at least 1 goalie. Other levels at least 1 goalie.
- Coach and tablet both edit until signed. Saves send the version; a stale save is rejected.
- `GameLiveStatus` starters become a compatibility copy fed from the lineup. One source of truth. The public game view keeps working.
- A games list step in the coach flow handles reschedules and cancellations.
- Auto-lock when a game starts or ends.

## 5. Signature, lock, unlock
- Signing is one server call that saves the signature and locks that game and team.
- The signature binds to a lineup version. Stale versions are rejected.
- Record: immutable lineup snapshot, typed signer name, device, server timestamp. Signer is whoever holds the GM code. Mark as unverified if not linked to a coach account.
- Lock history is append-only (sign, unlock, re-sign).
- Every route that changes participants or starters checks the lock: coach endpoints, tablet lineup save, legacy `live-status`.
- Unlock: admin portal only, admins only, reason required, logged, coach re-signs. Scope OrgAdmin to their own organization.

## 6. Coach mobile pages
- Separate mobile-first app on its own origin. Same accounts and backend.
- Flow: My Teams, Roster, Upcoming Games, Lineup.
- Large tap targets, no horizontal scroll, clear save confirmations, Signed / Locked indicator.
- Coaches see only assigned teams. Server enforces this on every call.

## 7. Game Manager changes
Login, stages, and flow are unchanged.
- Load saved participants and starters instead of resetting to empty (`loadRosterAndCoaches`).
- Save active/inactive and starter changes to the server.
- Re-fetch the lineup before signing and re-confirm if it changed.
- Send signature and lock in one call. Show Signed / Locked only after server confirmation.
- Offline: save a Pending signature tied to the lineup version. On reconnect the server accepts it only if the version is still current, otherwise the coach re-signs.
- Fallback: if no coach lineup exists, the current manual flow still works and writes to the same lineup table, so games are never blocked.

## Build order
1. Hardening and scoping.
2. Accounts: invites, email, acceptance, password reset, refresh tokens.
3. Roster model: per-team jersey, soft delete, audit log, duplicate check.
4. Lineup tables, versions, lock history, server-side rules.
5. Admin UI: Invite Coach, revoke/regenerate, remove access, unlock.
6. Coach app.
7. Game Manager changes.
8. Testing and polish.

## Testing
- Invites: expired, used, revoked, wrong email, regenerate, concurrent acceptance, existing account keeps its role, no account enumeration.
- Scoping: direct API calls to other teams' rosters, players, coaches, and lineups (read and write), including OrgAdmin across organizations.
- Sessions: removed coach loses access immediately; refresh rotation and revocation.
- Roster: per-team jersey independence, soft delete preserves signed lineups, name/grade audit, duplicate warning, same player on two teams.
- Lineups: starters within participants within roster; level rules; stale save rejected; sign versus edit race; edits rejected after lock from phone, tablet, and legacy route; unlock and re-sign history.
- Tablet: offline pending signature, resume after restart, fallback with no coach lineup.
- Mobile layouts on common phone sizes.

## Visiting coaches
- An OrgAdmin can invite coaches to teams in their own organization, plus External-organization teams that have a non-cancelled game against one of their teams within 30 days either side.
- The same rule lets that OrgAdmin list and remove those coaches and read or unlock those teams' lineups.
- Coaches see only their own team rosters; access stays active after the game.

## Coach site (`web/coach-site`)
Static vanilla-JS mobile site: sign in (optional "keep me signed in"), forgot/reset password, accept invitation (`/accept#token=`), roster add/edit/remove with jersey and duplicate warnings, game list, lineup build and sign. `config.json` holds `apiBase`. `staticwebapp.config.json` rewrites all paths to `index.html`.

- Team pages open Games by default; Roster has an explicit `/teams/{id}/roster` route.
- The Coaches tab lists assigned accounts. Only SuperAdmin and OrgAdmin see invitations and Invite Coach; invitation endpoints enforce existing organization/visiting-team scope. Coaches and team managers cannot grant or remove account access. Invites use the existing email acceptance flow; email-delivery failure explicitly offers the generated link. Removing account access remains in the admin portal.
- Staff listings are separate from account access: the Head Coach is always read from the admin team record and is read-only on the coach site. Anyone authorized to edit the roster can add/edit/remove the four existing assistant slots, always titled Assistant Coach, with optional email. Slot updates detect concurrent changes; they never change `CoachTeams`, login flags, or user accounts. No schema migration is required.
- Import roster from image uses self-hosted Tesseract.js OCR in the browser (JPEG/PNG/WebP, 10 MB/25 MP maximum). Images never leave the device; only confirmed player fields go to the roster API. Coaches correct OCR text, choose jersey-first/name-first layout, review editable rows, and acknowledge review. Non-player/unclear lines can be excluded. Existing-player matches and jersey conflicts pause import for a choice; already-added rows are preserved and not replayed. Each confirmed add uses existing validation, authorization, duplicate warnings, and roster auditing. This is a reviewed transcription aid, not unattended extraction.
- Coach site build: `npm ci`, `npm test`, `npm run build` in `web/coach-site`. Deploy `dist`, not the source folder. The build copies the pinned OCR runtime, WASM, English trained data, and licenses locally; no external OCR/CDN requests are needed. First use downloads these assets and can be slow on mobile.
- Your Teams has a Hockey subtitle and shows the count and next opponent/date for unsigned games needing lineups. The API reports unsigned/unfinished eligibility; both the team cards and Games list apply the coach's browser-local date, matching displayed game times. Reminders include today and future games within the game-list window; signed, past, final/completed/closed, cancelled, and postponed games are excluded. UTC midnight does not hide games still dated today locally.
- New-player Grade, Jersey, and Position fields share one row. Active lineup buttons are orange; selected starters are green.
- Lineup and roster validation/conflict responses preserve their HTTP error status. Missing goalie selection prompts the coach to select a goalie as a starter; other validation failures retain their specific messages.
- Coach-site regression tests: `node --test web/coach-site/tests/*.test.mjs` from the repository root.

## Release checklist
1. Run on TipInProd, in order: `CreateCoachInvitations.sql`, `CreateRefreshAndResetTokens.sql`, `AddRosterSoftDeleteAndAudit.sql`, `CreateGameLineups.sql`.
2. Deploy the API; set `CoachApp:BaseUrl` to the coach site URL (invite and reset emails use it).
3. Deploy the admin portal.
4. Create the coach Static Web App, add a deploy workflow, point `config.json` at the prod API, add the `coach` CNAME. The API currently allows all origins (`host.json`), so no CORS change is needed.
5. Smoke test: invite, accept, roster edit, lineup save and sign, admin unlock.

## Open items
- Add the coach site's DNS CNAME once the Azure hostname exists.
