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
| Automated email log | Settings / Email shows a read-only SuperAdmin-only log below the Email Server card. Defaults to today in Central Time; date selection, refresh, and 100-entry paging are available. Includes automated invitations and roster/lineup reminder tracking only, not manual invitations, scoresheets, or test emails. Sent means SMTP handoff, not inbox delivery. Invitation sends can also mark a reminder stage as sent, so entries are not a physical email count. NeedsReview and Sending are unconfirmed outcomes and are not automatically retried from this screen. |
| Team labels | Invitation email subjects/bodies and coach-site team lists, headers, and opponents use `Team Level - Type` (for example, `Riverbend JV - Boys`). Missing level/type values are omitted. Raw API team names are preserved; display labels are additive. |
| Concurrent edits | Version check. Stale save rejected and the app reloads. No merge logic. |
| Coach email | Automated verification email. |
| External team contacts | Admin team saves retain head/assistant coach names and emails without directly creating or assigning portal users. Assistant direct-login switches are disabled for External organizations. External head coaches remain eligible for automated roster-site invitations; accepting an invitation grants coach access through the separate invitation flow. |
| Jersey numbers | Per team. `Players.jerseyNumber` is only a default copied when a player is first added to a team. Two-way sync removed. |
| Coach roster edits | Add players (with duplicate check), edit first/last name, position, grade, jersey number, soft-remove from own team. No birthdate. |
| Coach roster views | Your Teams and team Roster pages link to View all players, grouped across the signed-in coach's assigned teams with name/team/jersey search. Each team retains its own jersey, position, and active/inactive status. Print roster opens a branded print/PDF preview for the selected team, including inactive and soft-removed memberships, using a separate white-background-compatible logo (`tipin-print-logo.svg`); the site header logo is unchanged. Inactive means a removed roster membership or inactive player record, not a legacy game-day participation toggle. These views use the same authorized roster endpoint with `includeInactive=true`; the default roster response still excludes removed entries. Deploy the API change before the coach site. |
| TipIn-managed lineups | A team needs lineup entry only when its organization is Managed and its team is not marked external. External-team games are non-interactive in the lineup list and show “No lineup required”; direct lineup reads/edits/signatures are rejected server-side and old signed external starters are ignored. Automated roster/lineup reminders are limited to managed teams; automatic access invitations to external head coaches remain available and their email copy is unchanged. |
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
- Coach invitation emails use the team's next scheduled, unfinished game, including today's games by Central calendar date. Finished/cancelled/postponed/in-progress games are excluded. Subjects show Away vs. Home, type, and level; the body includes the scheduled wall-clock time labeled Central, arena/rink, setup steps, one-use expiry, support email, and GameView link/QR. If no eligible game exists, the email uses team-only wording. Invitations still grant team access, not game-specific access. HTML and plain-text alternatives are sent; the GameView QR is generated locally and embedded as a CID image (no external QR service or invitation token in the QR). Existing text-only emails and attachments retain their behavior.
- Lineup reminders on Your Teams and the Games tab cover today through the end of the day 10 days ahead, using the coach's local calendar date. The Games tab still lists games up to 60 days ahead; games beyond the reminder window do not show Needs lineup.
- The coach site uses the GameView legal footer and contact links on all pages. Your Teams includes fan-sharing copy and a locally hosted GameView QR code; single-team accounts now remain on Your Teams instead of skipping the dashboard. Signed lineup notices direct unlock requests to info@tipinscoring.com.
- Import roster from image is labeled Beta and intended to speed up roster entry; corrections and verification against the original roster are required. It uses self-hosted Tesseract.js OCR in the browser (JPEG/PNG/WebP, 10 MB/25 MP maximum). Images never leave the device; only confirmed player fields go to the roster API. Coaches correct OCR text, set Column 1-4 using cascading dropdowns for Jersey #, Name, Position, and Grade (each field exactly once), review editable rows, and acknowledge review. All 24 field orders are supported. Changing the column order clears the preview and requires a fresh review; order changes are disabled after any player is added. Non-player/unclear lines can be excluded. Existing-player matches and jersey conflicts pause import for a choice; already-added rows are preserved and not replayed. Each confirmed add uses existing validation, authorization, duplicate warnings, and roster auditing. This is a reviewed transcription aid, not unattended extraction.
- Coach site build: `npm ci`, `npm test`, `npm run build` in `web/coach-site`. Deploy `dist`, not the source folder. The build copies the pinned OCR runtime, WASM, English trained data, and licenses locally; no external OCR/CDN requests are needed. First use downloads these assets and can be slow on mobile.
- Your Teams has a Hockey subtitle and shows the count and next opponent/date for unsigned games needing lineups. The API reports unsigned/unfinished eligibility; both the team cards and Games list apply the coach's browser-local date, matching displayed game times. Reminders include today and future games within the game-list window; signed, past, final/completed/closed, cancelled, and postponed games are excluded. UTC midnight does not hide games still dated today locally.
- New-player Grade, Jersey, and Position fields share one row. Active lineup buttons are orange; selected starters are green.
- Lineup and roster validation/conflict responses preserve their HTTP error status. Missing goalie selection prompts the coach to select a goalie as a starter; other validation failures retain their specific messages.
- Coach-site regression tests: `node --test web/coach-site/tests/*.test.mjs` from the repository root.

## Automated coach emails
- Delivery is **disabled by default**. Admin > Settings > Email has three global SuperAdmin-only controls: automatic head-coach invitations, three-day roster reminders, and game-day lineup reminders. Each persists independently; all start off. Manual invitations are unaffected. The existing Email Enabled switch still gates all SMTP delivery. `CoachReminders__Enabled=false` is an additional deployment kill switch; unset/true permits the saved switches to govern delivery. The UTC timer scans every 15 minutes, with no special startup-only invocation (Azure may run a missed scheduled tick after restart). It uses `America/Chicago` calendar dates (including DST), not the host timezone or a 72-hour subtraction.
- Roster review is due at 9 AM Central three calendar days before the game. Games added later receive one catch-up. The final lineup reminder is due at 8 AM Central on game day; games starting before 10 AM get it at 6 PM the previous evening. Late catch-up sends only the currently due stage, never both at once. No emails are sent at or after scheduled puck drop.
- Recipients are the Admin-listed Head Coach and active accounts with existing team access. Assistant contact fields alone never generate invitations, even if an assistant has a pending invite. Assigned assistants with authorized accounts are included normally. Existing authorized accounts get the specific game's lineup URL; signing in preserves that destination. Head coaches with active accounts but missing team access must accept an invitation using their existing account.
- Valid pending head-coach invitations are not regenerated: reminders refer to the original invitation email. Expired pending invitations can be replaced. Disabled/unsupported accounts, revoked invitations, locked-out invitations, and previously accepted invitations with removed team access are excluded; an administrator must deliberately reissue access. Automated invitations have `CreatedByUserId = NULL`, rather than impersonating an administrator.
- Signed/locked lineups, inactive teams, terminal/cancelled/postponed/in-progress games and past puck drops are excluded. Contact/account eligibility, latest signature, scheduled time, and invitation validity are rechecked just before delivery. A rescheduled game does not automatically reset an already-delivered stage; an administrator must deliberately approve any repeat notice.
- On the coach game lineup page, a compact View Game Manager Access Code link opens a small dialog containing the existing team's `GM-XXXXXX` code and Copy button only for the active Admin-listed Head Coach of the home team when the home organization is Managed. Close, Escape, or clicking outside dismisses the dialog. API authorization checks the live account, email match, team assignment (or scoped administrator access), home game and Managed organization. Other coaches, assistants, visitors and away teams never receive the code; the response is `no-store`. No new code is generated, and existing Game Manager login/day rules are unchanged.
- Both invitations and reminders share the TipIn navy/orange layout, standard embedded logo, system font stack, HTML/plain-text alternatives, support address, and embedded GameView QR. Images are CID resources, not remotely hosted tracking requests. No invitation token is included in the QR.

### Rollout and operations
1. Apply `api/TipInAPI/Infrastructure/Database/CreateCoachReminderDeliveries.sql` after the existing coach invitation/lineup migrations. The idempotent migration adds durable delivery tracking and permits a NULL automated invitation creator. The integration tests apply this migration only to their configured non-production database and delete their own records.
2. Deploy API/site changes **with automatic delivery disabled**. Set `CoachApp__BaseUrl` to the environment's HTTPS coach URL. `CoachReminderService.PreviewAsync(utcNow)` lists currently due, eligible, unclaimed candidates without creating invitations or sending emails; treat its email addresses as private operational data.
3. Verify SMTP settings and inspect the preview (which respects saved switches). Obtain explicit approval **before enabling automatic emails in dev**. No production activation is implied. A SuperAdmin can enable each automation separately in Settings > Email; if the deployment kill switch is false, remove that pause only in the approved environment. An invalid/missing coach URL fails explicitly before any claim.
4. The delivery key is game/team/normalized recipient/type (Invitation, RosterReview, LineupReminder). An automatic invitation also satisfies the currently due reminder stage, preventing an immediate duplicate. Invitations can be enabled while both reminders are off. Reminders can refer to valid pending invitations when automatic invitations are off, but cannot create or replace an invitation in that mode. Switches are rechecked before delivery. A SQL application lock serializes scans across workers; a durable `Sending` claim precedes invitation creation and SMTP. `Sent` is recorded only after SMTP succeeds. SMTP cannot guarantee exactly-once delivery: errors become `NeedsReview`, and a crash can leave `Sending`. These states pause that team/contact across all games and stages, rather than blindly retrying or referring to an invitation that may never have arrived. They are logged (without email addresses, tokens, or message bodies); stale `Sending` and `NeedsReview` counts are reported on subsequent runs.
5. To disable, set `CoachReminders__Enabled=false`. An in-flight SMTP attempt may still complete. Inspect `dbo.CoachReminderDeliveries` for `NeedsReview` and `Sending` older than 30 minutes. Confirm no dispatcher is active before intervening. Check SMTP/provider logs: if delivered, mark that exact key `Sent`; if delivery is uncertain, leave it paused. Never bulk-clear the ledger. Only after confirming non-delivery may an operator delete that exact claim for a deliberate retry. If its `InvitationId` identifies a newly generated automatic pending invitation that was never delivered, remove that exact unused invitation as well (never an accepted or previously delivered invitation), or issue a fresh invitation through Admin; hash-only tokens cannot be recovered. Resolve all uncertain rows for that contact before resuming.
6. Tests use an in-memory email sender or SMTP pickup directory, never real recipients. Run `dotnet test api/TipInAPI.Tests/TipInAPI.Tests.csproj --filter "FullyQualifiedName~CoachReminderTests|FullyQualifiedName~CoachInvitationEmailTests|FullyQualifiedName~SessionAndInviteTests"` and the coach-site tests/build.
7. Additional regression coverage: `CoachEmailAutomationSettingsTests`, `CoachGameManagerAccessTests`, and `CoachHttpResponseTests` verify persistence/rollback, head-coach code eligibility, SuperAdmin-only settings and no-store responses. Run `node --test web/admin-portal/tests/email-automation.test.cjs` for Admin toggle loading, saving, permissions and explicit failure states.

## Release checklist
1. Run on TipInProd, in order: `CreateCoachInvitations.sql`, `CreateRefreshAndResetTokens.sql`, `AddRosterSoftDeleteAndAudit.sql`, `CreateGameLineups.sql`, `CreateCoachReminderDeliveries.sql`. Use an authorized SQL administrator through the private network; never enable public SQL access for deployment.
2. Deploy the API; set `CoachApp:BaseUrl` to the coach site URL (invite and reset emails use it).
3. Deploy the admin portal.
4. Deploy `swa-tipin-coach-prod` with the manually confirmed `Deploy Coach Site Production` workflow on `main`. The workflow builds local OCR assets and sets `config.json` to the production API. The `coach.tipinscoring.com` CNAME points to `blue-rock-01c71a810.6.azurestaticapps.net`. Include the production Admin, GameView, and coach origins in the Function App's Azure CORS allowlist.
5. Smoke test: invite, accept, roster edit, lineup save and sign, admin unlock.

## Open items
- Keep all three saved email automation switches off and `CoachReminders__Enabled=false` until automatic production delivery is explicitly approved. `CoachApp__BaseUrl` must be `https://coach.tipinscoring.com`.
