# Copilot Instructions for GitHub Copilot and Copilot Chat

## Architecture Standards

### Repository & Service Layers

- Follow existing repository pattern.
- Follow existing service pattern.
- Follow existing API structure.
- Reuse existing functions before creating new ones.
- Preserve current folder structure.
- Maintain separation of concerns (API → Service → Repository → SQL).
- Do not introduce new architectural patterns (CQRS, ORMs, event sourcing, etc.).

### DTO & API Contracts

- Match existing DTO shapes exactly.
- Do not rename fields without updating SQL → Repo → API → UI.
- Do not remove fields without verifying usage across the entire app.
- Always return camelCase from API responses.
- Validate DTOs before using them in UI.
- Never break existing API endpoints.
- Never introduce new endpoints unless explicitly instructed.

### Caching

Preserve existing caches:

- allPlayers
- allTeams
- rosterCache

Do not introduce new global caches unless absolutely necessary.

---

## Database Standards

### General SQL Rules

- Never drop columns without verifying UI and API usage.
- Never rename columns without updating repositories and DTOs.
- Always run SELECT before UPDATE or DELETE.
- Avoid destructive migrations during active development hours.
- Preserve referential integrity: Players → PlayerTeams → RosterEntries.

### Roster & Team Assignment Rules

- PlayerTeams = source of truth for team assignment.
- RosterEntries = source of truth for team‑specific roster data.
- Players.jerseyNumber = global jersey number.
- RosterEntries.jerseyNumber must mirror Players.jerseyNumber.
- Players.status = system status (Active/Inactive).
- RosterEntries.gamedayStatus = team‑specific (Active/Scratched).
- Never mix system status with roster status.
- Never mix player position with roster position.

### SQL Safety Rules

- Never modify table names.
- Never modify primary keys.
- Never modify foreign keys.
- Never modify constraints.
- Never modify indexes.
- Never modify triggers.
- Never modify stored procedures.
- Never modify views.
- Never modify relationships.
- Never modify column types unless explicitly instructed.

---

## CSS Standards

### General

- This project does not use Tailwind.
- Reuse classes from:
  - global.css
  - admin.css
  - modal.css
- Only create page‑specific CSS when necessary.
- Avoid duplicate style definitions.
- Follow existing spacing, padding, and layout conventions.
- Do not introduce new color schemes or UI themes.

---

## UI Standards

### Modals

- Follow existing modal patterns (overlay + modal + close buttons).
- Use existing modal classes (nf-modal, nf-modal-overlay, etc.).
- Do not introduce new modal frameworks.
- Maintain consistent modal sizing and spacing.

### Tables

- Follow existing table layout patterns.
- Use string template rendering (.map().join()).
- Preserve sortable column patterns.
- Maintain consistent column naming and ordering.

### Forms

- Follow existing form validation patterns.
- Match current naming conventions.
- Reuse existing input styles (nf-input, nf-select, etc.).
- Do not introduce new form frameworks.

### UI/UX Consistency Rules

- Do not introduce new UI components unless instructed.
- Do not introduce new icons.
- Do not introduce new button styles.
- Do not introduce new animations.
- Maintain consistent spacing, typography, and layout.

---

## JavaScript Standards

### General

- Modify only the impacted functions.
- Do not refactor unrelated code.
- Preserve naming conventions:
  - rmFilters
  - rmSort
  - globalFilters
- Preserve existing event wiring patterns.
- Preserve existing modal open/close patterns.
- Reuse existing API modules (RosterApi, PlayerApi).
- Do not introduce new global variables.

### Rendering

- Follow existing table rendering patterns.
- Follow existing modal rendering patterns.
- Do not introduce new rendering frameworks (React, Vue, etc.).

### State Management

- Do not introduce new state libraries (Redux, Zustand, etc.).
- Preserve existing caching strategy.

### JavaScript Behavior Rules

- Do not introduce new Promise patterns unless needed.
- Do not introduce async/await where callbacks are used (and vice versa).
- Do not introduce new utility functions unless absolutely necessary.
- Do not introduce new fetch wrappers.

---

## Development Workflow Standards

### Before Implementing

- Identify impacted files.
- Identify impacted DTOs.
- Identify impacted SQL tables.
- Identify impacted UI components.

### During Implementation

- Minimize code changes.
- Do not refactor unrelated code.
- Keep explanations concise.
- Show files changed and why.
- Maintain backward compatibility.

### After Implementation

- Test API responses.
- Test DTO mapping.
- Test UI rendering.
- Test filters.
- Test modals.
- Test team assignment logic.
- Test roster logic.

---

## GitHub Copilot Usage Standards (VS Code)

### General Rules

- Copilot assists, not architects.
- Copilot should complete code you already started.
- Copilot should not rewrite entire files.
- Copilot should not invent new patterns.
- Copilot should not modify SQL unless explicitly instructed.
- Copilot should not rename fields or variables.
- Copilot should not create new folder structures.
- Copilot should not introduce new dependencies.

### File & Folder Structure Rules

- Do not create new folders unless explicitly instructed.
- Do not reorganize existing folders.
- Do not merge files.
- Do not split files.
- Do not rename files.
- Do not move files between folders.

### Consistency Rules

- Maintain consistent indentation.
- Maintain consistent spacing.
- Maintain consistent comment style.
- Maintain consistent error handling patterns.
- Maintain consistent return types.
- Maintain consistent API response shapes.

---

## Prompting Rules

### Always Include

- File name
- Function name
- Exact change needed
- Instruction to avoid touching unrelated code
- Instruction to preserve naming conventions
- Instruction to show only the updated block

### Example Prompt

Modify only the updateRosterEntry() function in rosters.js.
Do not change any other functions.
Preserve naming conventions.
Show only the updated function.
Do not refactor unrelated code.

---

## Debugging Standards

### Always Check in Order

1. API response
2. DTO mapping
3. PlayerTeams rows
4. RosterEntries rows
5. UI filters
6. UI rendering
7. Modal logic

### Never Assume

- SQL broke the UI.
- UI broke SQL.
- Filters are correct.
- DTOs are correct.
- Team assignment is correct.

### Always Verify

- PlayerTeams integrity.
- RosterEntries integrity.
- DTO shape.
- Modal behavior.
- Table rendering.

---

## Safety Standards

- Never deploy without checking PlayerTeams and RosterEntries.
- Never deploy without checking DTO shape.
- Never deploy without checking modal behavior.
- Never deploy without checking filters.
- Never deploy without checking team assignment logic.

---

## TipIn‑Specific Rules

### Dual Rostering

- Varsity/JV assignments must be consistent.
- Jersey sync must update both Players and RosterEntries.
- gamedayStatus must be used instead of roster status.
- Player status must remain system‑wide.

### Team Assignment

- Team toggles must update PlayerTeams.
- Players screen must show players belonging to the organization.
- Players screen must show players assigned to at least one team in that organization.

### Roster Modal

- Player fields = read‑only.
- Roster fields = editable.
- Never mix player and roster fields.
