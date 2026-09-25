# TipIn Access Code Search Results

## Executive Summary

Access codes (GameManagerCode/ScorekeeperCode and StatManagerCode) are currently:

- ✅ Generated client-side with random 6-character strings
- ✅ Stored in the Teams table
- ✅ Displayed in admin portal
- ✅ Can be edited via admin interface
- ❌ **NOT validated** when accessing games
- ❌ **NO expiration tracking**
- ❌ **Missing backend endpoint** for code-specific updates

---

## 1. Code Generation

### Location

**Frontend**: [web/admin-portal/js/teams.js](web/admin-portal/js/teams.js#L757-L770)

### Code Snippet

```javascript
// Generate Access Codes (teams.js, line 757-770)
document.addEventListener("click", (e) => {
  if (e.target.id === "btnGenerateCodes") {
    const sk = Math.random().toString(36).substring(2, 8).toUpperCase();
    const sm = Math.random().toString(36).substring(2, 8).toUpperCase();

    document.getElementById("team-score-code").value = sk;
    document.getElementById("team-stat-code").value = sm;
  }
});
```

### Generation Method

- **Algorithm**: `Math.random().toString(36).substring(2, 8).toUpperCase()`
- **Format**: 6-character alphanumeric string
- **Example**: `A2K9ZX`, `B7L3MW`
- **Uniqueness**: NOT GUARANTEED (no database uniqueness constraint)
- **Complexity**: LOW - no special characters, predictable pattern

### Trigger

- "Generate Access Codes" button in team edit modal
- User manually clicks to generate new codes
- NO auto-generation on team creation

---

## 2. Code Storage

### Database Location

**Table**: `Teams`

### Columns

| Column          | Type       | Property Name (Backend) | Notes                            |
| --------------- | ---------- | ----------------------- | -------------------------------- |
| ScorekeeperCode | varchar(?) | GameManagerCode         | Displayed as "Scorekeeper Code"  |
| StatManagerCode | varchar(?) | StatManagerCode         | Displayed as "Stat Manager Code" |

### Model Definition

**File**: [api/
API/Models/Team.cs](api/TipInAPI/Models/Team.cs)

```csharp
public class Team
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid LevelId { get; set; }
    // ... other properties ...

    public string? GameManagerCode { get; set; }  // Maps to ScorekeeperCode
    public string? StatManagerCode { get; set; }
    public string? Notes { get; set; }

    public bool IsActive { get; set; }
    public bool IsExternal { get; set; }

    public int? SortOrder { get; set; }
    public DateTime UpdatedAt { get; set; }
}
```

### Key Issues

- No NOT NULL constraint
- No UNIQUE constraint (codes can be duplicated)
- No expiration/timestamp field
- No validation on length/format

---

## 3. Code Validation Logic

### ❌ NO VALIDATION FOUND

**Extensive search completed:**

- ✅ Searched all C# Functions files
- ✅ Searched all Services files
- ✅ Searched all Repositories files
- ✅ Searched game endpoints
- ✅ Searched frontend game-manager code
- ✅ Searched frontend game-view code

**Result**: No code validation endpoints or logic discovered.

### Codes Are NOT Used For:

- Game entry authentication
- Scorekeeper login
- Stat manager login
- Game access control
- Tablet app authentication

---

## 4. Code Management (Admin Portal)

### Display

**File**: [web/admin-portal/screens/access-codes.html](web/admin-portal/screens/access-codes.html)

**Features**:

- Table showing all teams
- Columns: Team Name, Organization, Scorekeeper Code, Stat Manager Code, Actions
- Edit button for each team

### Load Function

**File**: [web/admin-portal/js/access-codes.js](web/admin-portal/js/access-codes.js#L10-L32)

```javascript
async function loadCodes() {
  const res = await fetch("http://localhost:7071/api/teams");
  const teams = await res.json();

  tbody.innerHTML = "";

  teams.forEach((t) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
            <td>${t.name}</td>
            <td>${t.organizationName}</td>
            <td style="text-align:center;"><code style="color:#FFB300;">${t.gameManagerCode}</code></td>
            <td style="text-align:center;"><code style="color:#42a5f5;">${t.statManagerCode}</code></td>
            <td style="text-align:center;">
                <button class="btn-sm edit-btn" data-id="${t.id}">✏️ Edit</button>
            </td>
        `;

    tbody.appendChild(tr);
  });

  document
    .querySelectorAll(".edit-btn")
    .forEach((btn) =>
      btn.addEventListener("click", () => openEditModal(btn.dataset.id)),
    );
}
```

### Edit Modal

**File**: [web/admin-portal/js/access-codes.js](web/admin-portal/js/access-codes.js#L34-L49)

```javascript
async function openEditModal(id) {
  editingTeamId = id;

  const res = await fetch(`http://localhost:7071/api/teams/${id}`);
  const t = await res.json();

  modalTitle.textContent = `Edit Codes — ${t.name}`;

  scoreInput.value = t.gameManagerCode;
  statInput.value = t.statManagerCode;

  modal.classList.remove("hidden");
}
```

### Save Function

**File**: [web/admin-portal/js/access-codes.js](web/admin-portal/js/access-codes.js#L51-L62)

```javascript
async function saveCodes() {
  const payload = {
    gameManagerCode: scoreInput.value,
    statManagerCode: statInput.value,
  };

  await fetch(`http://localhost:7071/api/teams/${editingTeamId}/codes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  modal.classList.add("hidden");
  loadCodes();
}
```

### ⚠️ CRITICAL ISSUE

The save function calls: `PUT /api/teams/{id}/codes`

**This endpoint DOES NOT EXIST in TeamsFunctions.cs**

Only available endpoints are:

- `GET /api/teams`
- `GET /api/teams/{id}`
- `PUT /api/teams/{id}` (full team update)
- `POST /api/teams` (create)
- `DELETE /api/teams/{id}`

---

## 5. Backend API Endpoints

### TeamsFunctions.cs

**File**: [api/TipInAPI/Functions/TeamsFunctions.cs](api/TipInAPI/Functions/TeamsFunctions.cs)

#### GetTeams

```csharp
[Function("GetTeams")]
public async Task<HttpResponseData> GetTeams(
    [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "teams")] HttpRequestData req)
{
    var teams = await _service.GetAllAsync();
    var response = req.CreateResponse(HttpStatusCode.OK);
    await response.WriteAsJsonAsync(teams);
    return response;
}
```

**Returns**: All teams with GameManagerCode and StatManagerCode

#### GetTeamById

```csharp
[Function("GetTeamById")]
public async Task<HttpResponseData> GetTeamById(
    [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "teams/{id:guid}")] HttpRequestData req,
    Guid id)
{
    var team = await _service.GetByIdAsync(id);
    if (team == null)
        return req.CreateResponse(HttpStatusCode.NotFound);

    var response = req.CreateResponse(HttpStatusCode.OK);
    await response.WriteAsJsonAsync(team);
    return response;
}
```

**Returns**: Single team detail with codes

#### UpdateTeam

```csharp
[Function("UpdateTeam")]
public async Task<HttpResponseData> UpdateTeam(
    [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "teams/{id:guid}")] HttpRequestData req,
    Guid id)
{
    var dto = await req.ReadFromJsonAsync<TeamCreateUpdateDto>();
    await _service.UpdateAsync(id, dto);
    return req.CreateResponse(HttpStatusCode.NoContent);
}
```

**Use**: Requires full TeamCreateUpdateDto (includes all team properties)
**Codes**: Updated via `GameManagerCode` and `StatManagerCode` properties

---

## 6. Repository Layer

### TeamsRepository.cs

**File**: [api/TipInAPI/Repositories/TeamsRepository.cs](api/TipInAPI/Repositories/TeamsRepository.cs)

#### GetAllAsync - SQL Select

```sql
SELECT
    t.Id AS TeamId,
    t.OrganizationId,
    t.LevelId,
    t.SeasonId,
    t.Name,
    t.Abbreviation,
    o.Name AS OrganizationName,
    l.Name AS LevelName,
    s.SeasonName,
    (SELECT COUNT(*) FROM RosterEntries r WHERE r.TeamId = t.Id) AS RosterCount,
    t.HeadCoachName,
    t.ScorekeeperCode AS GameManagerCode,      -- ← Code mapping
    t.StatManagerCode,                          -- ← Code mapping
    t.IsActive,
    t.IsExternal,
    -- ... coach fields ...
FROM Teams t
LEFT JOIN Organizations o ON t.OrganizationId = o.OrganizationId
LEFT JOIN Levels l ON t.LevelId = l.Id
LEFT JOIN Seasons s ON t.SeasonId = s.SeasonId
ORDER BY t.SortOrder, t.Name
```

#### CreateAsync - INSERT

```sql
INSERT INTO Teams (
    Id,
    OrganizationId,
    LevelId,
    SeasonId,
    Name,
    Gender,
    Abbreviation,
    -- ... coach fields ...
    ScorekeeperCode,           -- ← Stored here
    StatManagerCode,            -- ← Stored here
    IsActive,
    IsExternal,
    Notes
)
VALUES (@Id, @OrganizationId, ..., @GameManagerCode, @StatManagerCode, ...)
```

#### UpdateAsync - UPDATE

```sql
UPDATE Teams
SET
    OrganizationId = @OrganizationId,
    LevelId = @LevelId,
    -- ... other fields ...
    ScorekeeperCode = @GameManagerCode,    -- ← Updates here
    StatManagerCode = @StatManagerCode,     -- ← Updates here
    IsActive = @IsActive,
    IsExternal = @IsExternal,
    Notes = @Notes
WHERE Id = @Id
```

---

## 7. DTO Definitions

### TeamCreateUpdateDto

**File**: [api/TipInAPI/DTOs/TeamCreateUpdateDto.cs](api/TipInAPI/DTOs/TeamCreateUpdateDto.cs)

```csharp
public class TeamCreateUpdateDto
{
    public Guid? OrganizationId { get; set; }
    public Guid LevelId { get; set; }
    public Guid SeasonId { get; set; }
    public string? Name { get; set; }
    public string? Gender { get; set; }
    public string? Abbreviation { get; set; }

    // Coach fields...
    public string? HeadCoachName { get; set; }
    public string? HeadCoachEmail { get; set; }
    // ... assistant coaches ...

    public bool AssistantCoach1HasLogin { get; set; }
    // ... more coach login flags ...

    public string? Notes { get; set; }
    public string? GameManagerCode { get; set; }      // ← Code property
    public string? StatManagerCode { get; set; }      // ← Code property

    public bool IsExternal { get; set; }
    public bool IsActive { get; set; }
}
```

### TeamDetailDto

**File**: [api/TipInAPI/DTOs/TeamDetailDto.cs](api/TipInAPI/DTOs/TeamDetailDto.cs)

```csharp
public class TeamDetailDto
{
    public Guid TeamId { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid LevelId { get; set; }
    public string LevelName { get; set; }
    public Guid SeasonId { get; set; }

    public string? Name { get; set; }
    public string? Gender { get; set; }
    public string? Abbreviation { get; set; }

    // Coach fields...
    public string? HeadCoachName { get; set; }
    public string? HeadCoachEmail { get; set; }
    // ...

    public string? Notes { get; set; }
    public string? GameManagerCode { get; set; }      // ← Code property
    public string? StatManagerCode { get; set; }      // ← Code property

    public bool IsExternal { get; set; }
    public bool IsActive { get; set; }
    public int RosterCount { get; set; }
}
```

### TeamsListItemDto

**File**: [api/TipInAPI/DTOs/TeamsListItemDto.cs](api/TipInAPI/DTOs/TeamsListItemDto.cs)

Contains:

- `GameManagerCode`
- `StatManagerCode`

---

## 8. Admin Portal UI Integration

### Teams Edit Modal

**File**: [web/admin-portal/js/page-content.js](web/admin-portal/js/page-content.js#L180-L208)

```html
<!-- ACCESS CODES SECTION -->
<div class="full-width-section">
  <h3 class="section-header">Access Codes</h3>

  <div class="two-col">
    <div>
      <label>Scorekeeper Code</label>
      <input id="team-score-code" type="text" class="nf-input" readonly />
    </div>

    <div>
      <label>Stat Manager Code</label>
      <input id="team-stat-code" type="text" class="nf-input" readonly />
    </div>

    <div class="full-width">
      <button id="btnGenerateCodes" class="nf-btn nf-btn-primary">
        Generate Access Codes
      </button>
    </div>
  </div>
</div>
```

**Behavior**:

- Displays codes as readonly fields
- "Generate Access Codes" button generates 6-char random strings
- Codes are saved with full team update

### Teams Display

**File**: [web/admin-portal/js/teams.js](web/admin-portal/js/teams.js#L300-L310)

Displays codes with badges:

```javascript
<div class="code-badge sm-code">SM-${team.statManagerCode ?? ""}</div>
```

---

## 9. Summary Table: Code Flow

| Operation              | Location          | Method                    | Status                 |
| ---------------------- | ----------------- | ------------------------- | ---------------------- |
| **Generate**           | teams.js          | Client-side random        | ✅ Working             |
| **Display**            | access-codes.html | GET /api/teams            | ✅ Working             |
| **Update Single Code** | access-codes.js   | PUT /api/teams/{id}/codes | ❌ **MISSING**         |
| **Update with Team**   | page-content.js   | PUT /api/teams/{id}       | ✅ Working             |
| **Store**              | TeamsRepository   | INSERT/UPDATE Teams       | ✅ Working             |
| **Retrieve**           | TeamsRepository   | SELECT Teams              | ✅ Working             |
| **Validate/Use**       | Game endpoints    | (not found)               | ❌ **NOT IMPLEMENTED** |
| **Expire**             | (none)            | -                         | ❌ **NOT IMPLEMENTED** |

---

## 10. Identified Issues & Gaps

### Critical Issues

1. **❌ Missing Backend Endpoint**
   - Frontend calls: `PUT /api/teams/{id}/codes`
   - Backend provides: `PUT /api/teams/{id}` (requires full DTO)
   - Likely returning 404 or hanging

2. **❌ No Code Validation**
   - Codes generated but never validated
   - No authentication/authorization using codes
   - No role-based access (scorekeeper vs stat manager)

3. **❌ No Expiration Tracking**
   - No timestamp fields
   - No expiration logic
   - Codes valid indefinitely

4. **❌ No Uniqueness Enforcement**
   - No unique constraint in database
   - Random generation doesn't check for duplicates
   - Codes could collide

5. **❌ No Code Lifecycle Management**
   - Can't invalidate old codes
   - Can't track code usage
   - No audit trail

### Security Issues

1. **Weak Generation Algorithm**
   - Only 36^6 possible combinations (~2.1 billion)
   - Predictable pattern
   - No cryptographic randomness

2. **No Validation Mechanism**
   - Currently no security purpose
   - Codes not checked anywhere

3. **Plaintext Storage**
   - Codes stored as plain strings (not hashed)
   - Readable in database and API responses

---

## 11. Files Summary

### Backend Files

| File                                                                            | Purpose          | Status                     |
| ------------------------------------------------------------------------------- | ---------------- | -------------------------- |
| [Models/Team.cs](api/TipInAPI/Models/Team.cs)                                   | Model definition | ✅ Has code properties     |
| [DTOs/TeamCreateUpdateDto.cs](api/TipInAPI/DTOs/TeamCreateUpdateDto.cs)         | Input DTO        | ✅ Has code properties     |
| [DTOs/TeamDetailDto.cs](api/TipInAPI/DTOs/TeamDetailDto.cs)                     | Output DTO       | ✅ Has code properties     |
| [DTOs/TeamsListItemDto.cs](api/TipInAPI/DTOs/TeamsListItemDto.cs)               | List DTO         | ✅ Has code properties     |
| [Functions/TeamsFunctions.cs](api/TipInAPI/Functions/TeamsFunctions.cs)         | API endpoints    | ⚠️ Missing /codes endpoint |
| [Services/TeamsService.cs](api/TipInAPI/Services/TeamsService.cs)               | Business logic   | ✅ Passes through DTO      |
| [Repositories/TeamsRepository.cs](api/TipInAPI/Repositories/TeamsRepository.cs) | Database access  | ✅ Stores/retrieves codes  |

### Frontend Files

| File                                                                                     | Purpose            | Status                         |
| ---------------------------------------------------------------------------------------- | ------------------ | ------------------------------ |
| [web/admin-portal/screens/access-codes.html](web/admin-portal/screens/access-codes.html) | Code management UI | ✅ Display page                |
| [web/admin-portal/js/access-codes.js](web/admin-portal/js/access-codes.js)               | Code logic         | ❌ Calls non-existent endpoint |
| [web/admin-portal/js/teams.js](web/admin-portal/js/teams.js)                             | Team management    | ✅ Code generation             |
| [web/admin-portal/js/page-content.js](web/admin-portal/js/page-content.js)               | Team modal         | ✅ Code display                |

### No Game-Manager/Game-View Usage

- No code validation in game entry
- No tablet app authentication with codes
- No scorekeeper/stat manager role enforcement via codes

---

## Recommendations

### Immediate Fixes Needed

1. Create missing endpoint: `PUT /api/teams/{id}/codes`
2. Add code validation to game endpoints
3. Add uniqueness constraint to database
4. Implement code validation service

### Future Enhancements

1. Add expiration timestamps
2. Implement cryptographically secure generation
3. Add audit logging
4. Hash codes before storage
5. Add role-based validation (scorekeeper vs stat manager)
6. Implement code invalidation mechanism
