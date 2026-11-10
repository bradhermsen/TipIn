using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.DTOs;
using TipInAPI.Infrastructure.Database;

namespace TipInAPI.Services
{
    public sealed class CoachRosterPlayer
    {
        public Guid RosterEntryId { get; set; }
        public Guid PlayerId { get; set; }
        public string FirstName { get; set; } = "";
        public string LastName { get; set; } = "";
        public int? Grade { get; set; }
        public int? JerseyNumber { get; set; }
        public string? Position { get; set; }
        public bool IsGoalie { get; set; }
    }

    public sealed class PlayerSearchMatch
    {
        public Guid PlayerId { get; set; }
        public string FirstName { get; set; } = "";
        public string LastName { get; set; } = "";
        public int? Grade { get; set; }
        public int? JerseyNumber { get; set; }
        public bool OnThisTeam { get; set; }
    }

    public sealed class AddRosterPlayerRequest
    {
        public Guid? ExistingPlayerId { get; set; }
        public string? FirstName { get; set; }
        public string? LastName { get; set; }
        public int? Grade { get; set; }
        public int? JerseyNumber { get; set; }
        public string? Position { get; set; }
        // Coach confirmed the warnings (possible duplicate player, jersey already used) and wants to proceed
        public bool Confirm { get; set; }
    }

    public sealed class UpdateRosterPlayerRequest
    {
        public string? FirstName { get; set; }
        public string? LastName { get; set; }
        public int? Grade { get; set; }
        public int? JerseyNumber { get; set; }
        public string? Position { get; set; }
        public bool Confirm { get; set; }
    }

    public enum CoachRosterOutcome { Ok, NotFound, Invalid, Warning }

    public sealed class CoachRosterResult
    {
        public CoachRosterOutcome Outcome { get; set; }
        public string? Message { get; set; }
        public object? Data { get; set; }

        public static CoachRosterResult Ok(object? data = null) => new() { Outcome = CoachRosterOutcome.Ok, Data = data };
        public static CoachRosterResult NotFound(string message) => new() { Outcome = CoachRosterOutcome.NotFound, Message = message };
        public static CoachRosterResult Invalid(string message) => new() { Outcome = CoachRosterOutcome.Invalid, Message = message };
        public static CoachRosterResult Warning(string message, object data) => new() { Outcome = CoachRosterOutcome.Warning, Message = message, Data = data };
    }

    public interface ICoachRosterService
    {
        Task<CoachRosterResult> GetStaffAsync(Guid teamId);
        Task<CoachRosterResult> UpdateAssistantAsync(Guid teamId, int slot, UpdateAssistantRequest request);
        Task<IEnumerable<CoachRosterPlayer>> GetRosterAsync(Guid teamId);
        Task<CoachRosterResult> SearchPlayersAsync(Guid teamId, string query);
        Task<CoachRosterResult> AddPlayerAsync(Guid actorId, Guid teamId, AddRosterPlayerRequest request);
        Task<CoachRosterResult> UpdatePlayerAsync(Guid actorId, Guid teamId, Guid rosterEntryId, UpdateRosterPlayerRequest request);
        Task<CoachRosterResult> RemovePlayerAsync(Guid actorId, Guid teamId, Guid rosterEntryId);
    }

    public class CoachRosterService : ICoachRosterService
    {
        private readonly ISqlConnectionFactory _db;

        public CoachRosterService(ISqlConnectionFactory db)
        {
            _db = db;
        }

        private static string Clean(string? value) => (value ?? "").Trim();

        public async Task<CoachRosterResult> GetStaffAsync(Guid teamId)
        {
            using var conn = _db.CreateConnection();
            var exists = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Teams WHERE Id = @teamId", new { teamId });
            if (exists == 0) return CoachRosterResult.NotFound("Team not found.");
            var staff = await conn.QueryAsync<CoachStaffDto>(@"
                SELECT 0 AS Slot, 'Head Coach' AS Title, HeadCoachName AS Name, HeadCoachEmail AS Email FROM Teams WHERE Id = @teamId
                UNION ALL SELECT 1, 'Assistant Coach', AssistantCoach1Name, AssistantCoach1Email FROM Teams WHERE Id = @teamId
                UNION ALL SELECT 2, 'Assistant Coach', AssistantCoach2Name, AssistantCoach2Email FROM Teams WHERE Id = @teamId
                UNION ALL SELECT 3, 'Assistant Coach', AssistantCoach3Name, AssistantCoach3Email FROM Teams WHERE Id = @teamId
                UNION ALL SELECT 4, 'Assistant Coach', AssistantCoach4Name, AssistantCoach4Email FROM Teams WHERE Id = @teamId
                ORDER BY Slot;", new { teamId });
            return CoachRosterResult.Ok(staff.ToList());
        }

        public async Task<CoachRosterResult> UpdateAssistantAsync(Guid teamId, int slot, UpdateAssistantRequest request)
        {
            if (slot < 1 || slot > 4) return CoachRosterResult.Invalid("Assistant slot must be between 1 and 4. The head coach is managed by an administrator.");
            var name = Clean(request.Name);
            var email = Clean(request.Email);
            if (name.Length > 100) return CoachRosterResult.Invalid("Name must be 100 characters or fewer.");
            if (email.Length > 254 || (email.Length > 0 && !System.Net.Mail.MailAddress.TryCreate(email, out _)))
                return CoachRosterResult.Invalid("Enter a valid email address or leave it blank.");
            if (name.Length == 0 && email.Length > 0) return CoachRosterResult.Invalid("An assistant name is required when an email is provided.");

            using var conn = _db.CreateConnection();
            // Only a validated numeric slot is interpolated; all user input is parameterized.
            var updated = await conn.ExecuteAsync($@"
                UPDATE Teams SET AssistantCoach{slot}Name = NULLIF(@name, ''),
                    AssistantCoach{slot}Email = NULLIF(@email, ''), UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @teamId
                  AND ISNULL(AssistantCoach{slot}Name, '') = ISNULL(@expectedName, '')
                  AND ISNULL(AssistantCoach{slot}Email, '') = ISNULL(@expectedEmail, '');",
                new { teamId, name, email, expectedName = request.ExpectedName, expectedEmail = request.ExpectedEmail });
            if (updated == 1) return CoachRosterResult.Ok();
            var exists = await conn.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM Teams WHERE Id = @teamId", new { teamId });
            return exists == 0 ? CoachRosterResult.NotFound("Team not found.")
                : CoachRosterResult.Warning("This staff listing changed. Reload the Coaches tab before editing it again.", new { code = "STAFF_CHANGED" });
        }

        private sealed class ExistingPlayerRow
        {
            public string FirstName { get; set; } = "";
            public string LastName { get; set; } = "";
            public int? Grade { get; set; }
            public int? JerseyNumber { get; set; }
            public string? Position { get; set; }
        }

        private sealed class ExistingEntryRow
        {
            public Guid Id { get; set; }
            public DateTime? RemovedAtUtc { get; set; }
        }

        private static string? Validate(string first, string last, int? grade, int? jersey, string? position)
        {
            if (first.Length == 0 || last.Length == 0) return "First and last name are required";
            if (first.Length > 100 || last.Length > 100) return "Names must be 100 characters or fewer";
            if (grade.HasValue && (grade < 1 || grade > 12)) return "Grade must be between 1 and 12";
            if (jersey.HasValue && (jersey < 0 || jersey > 99)) return "Jersey number must be between 0 and 99";
            if (position != null && position.Length > 40) return "Position must be 40 characters or fewer";
            return null;
        }

        public async Task<IEnumerable<CoachRosterPlayer>> GetRosterAsync(Guid teamId)
        {
            using var conn = _db.CreateConnection();
            return await conn.QueryAsync<CoachRosterPlayer>(@"
                SELECT r.Id AS RosterEntryId, p.PlayerId, p.FirstName, p.LastName, p.Grade,
                       r.JerseyNumber, r.Position, ISNULL(r.IsGoalie, 0) AS IsGoalie
                FROM RosterEntries r
                JOIN Players p ON p.PlayerId = r.PlayerId
                WHERE r.TeamId = @TeamId AND r.RemovedAtUtc IS NULL
                ORDER BY r.JerseyNumber, p.LastName, p.FirstName",
                new { TeamId = teamId });
        }

        // Search is limited to the team's own organization and returns minimal fields
        public async Task<CoachRosterResult> SearchPlayersAsync(Guid teamId, string query)
        {
            query = Clean(query);
            if (query.Length < 2) return CoachRosterResult.Invalid("Enter at least 2 characters");

            using var conn = _db.CreateConnection();
            var orgId = await conn.ExecuteScalarAsync<Guid?>("SELECT OrganizationId FROM Teams WHERE Id = @TeamId", new { TeamId = teamId });
            if (orgId == null) return CoachRosterResult.NotFound("Team not found");

            var escaped = query.Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]");
            var matches = await conn.QueryAsync<PlayerSearchMatch>(@"
                SELECT TOP 25 p.PlayerId, p.FirstName, p.LastName, p.Grade, p.JerseyNumber,
                       CASE WHEN EXISTS (SELECT 1 FROM RosterEntries r
                                         WHERE r.TeamId = @TeamId AND r.PlayerId = p.PlayerId AND r.RemovedAtUtc IS NULL)
                            THEN 1 ELSE 0 END AS OnThisTeam
                FROM Players p
                WHERE p.OrganizationId = @OrgId AND p.IsActive = 1
                  AND p.FullName LIKE @Like
                ORDER BY p.LastName, p.FirstName",
                new { TeamId = teamId, OrgId = orgId, Like = "%" + escaped + "%" });
            return CoachRosterResult.Ok(matches);
        }

        public async Task<CoachRosterResult> AddPlayerAsync(Guid actorId, Guid teamId, AddRosterPlayerRequest request)
        {
            using var conn = _db.CreateConnection();

            var orgId = await conn.ExecuteScalarAsync<Guid?>("SELECT OrganizationId FROM Teams WHERE Id = @TeamId", new { TeamId = teamId });
            if (orgId == null) return CoachRosterResult.NotFound("Team not found");

            using var tx = conn.BeginTransaction();
            Guid playerId;
            var action = "AddExistingPlayer";

            if (request.ExistingPlayerId.HasValue)
            {
                playerId = request.ExistingPlayerId.Value;
                var existing = await conn.QuerySingleOrDefaultAsync<ExistingPlayerRow>(
                    @"SELECT FirstName, LastName, Grade, JerseyNumber, Position
                      FROM Players WHERE PlayerId = @PlayerId AND OrganizationId = @OrgId AND IsActive = 1",
                    new { PlayerId = playerId, OrgId = orgId }, tx);
                if (existing == null) return CoachRosterResult.NotFound("Player not found");

                var jersey = request.JerseyNumber ?? existing.JerseyNumber;
                var position = string.IsNullOrWhiteSpace(request.Position) ? existing.Position : Clean(request.Position);
                var invalid = Validate(existing.FirstName, existing.LastName, null, jersey, position);
                if (invalid != null) return CoachRosterResult.Invalid(invalid);

                var entry = await conn.QuerySingleOrDefaultAsync<ExistingEntryRow>(
                    "SELECT Id, RemovedAtUtc FROM RosterEntries WHERE TeamId = @TeamId AND PlayerId = @PlayerId",
                    new { TeamId = teamId, PlayerId = playerId }, tx);

                if (entry != null && entry.RemovedAtUtc == null)
                    return CoachRosterResult.Invalid("That player is already on this roster");

                if (!request.Confirm && await JerseyInUseAsync(conn, tx, teamId, jersey, null))
                    return CoachRosterResult.Warning("That jersey number is already used on this team", new { code = "JERSEY_IN_USE" });

                if (entry != null)
                {
                    action = "RestorePlayer";
                    await conn.ExecuteAsync(@"
                        UPDATE RosterEntries
                        SET RemovedAtUtc = NULL, RemovedByUserId = NULL, JerseyNumber = @Jersey,
                            Position = @Position, UpdatedAt = SYSUTCDATETIME()
                        WHERE Id = @Id",
                        new { Id = entry.Id, Jersey = jersey, Position = position }, tx);
                }
                else
                {
                    await AddToTeamAsync(conn, tx, teamId, playerId, jersey, position);
                }
            }
            else
            {
                action = "AddPlayer";
                var first = Clean(request.FirstName);
                var last = Clean(request.LastName);
                var position = string.IsNullOrWhiteSpace(request.Position) ? null : Clean(request.Position);
                var invalid = Validate(first, last, request.Grade, request.JerseyNumber, position);
                if (invalid != null) return CoachRosterResult.Invalid(invalid);

                if (!request.Confirm)
                {
                    var duplicates = (await conn.QueryAsync<PlayerSearchMatch>(@"
                        SELECT p.PlayerId, p.FirstName, p.LastName, p.Grade, p.JerseyNumber,
                               CASE WHEN EXISTS (SELECT 1 FROM RosterEntries r
                                                 WHERE r.TeamId = @TeamId AND r.PlayerId = p.PlayerId AND r.RemovedAtUtc IS NULL)
                                    THEN 1 ELSE 0 END AS OnThisTeam
                        FROM Players p
                        WHERE p.OrganizationId = @OrgId AND p.IsActive = 1
                          AND LOWER(LTRIM(RTRIM(p.FirstName))) = LOWER(@First)
                          AND LOWER(LTRIM(RTRIM(p.LastName))) = LOWER(@Last)",
                        new { TeamId = teamId, OrgId = orgId, First = first, Last = last }, tx)).ToList();

                    if (duplicates.Count > 0)
                        return CoachRosterResult.Warning("A player with this name already exists", new { code = "POSSIBLE_DUPLICATE", matches = duplicates });

                    if (await JerseyInUseAsync(conn, tx, teamId, request.JerseyNumber, null))
                        return CoachRosterResult.Warning("That jersey number is already used on this team", new { code = "JERSEY_IN_USE" });
                }

                playerId = Guid.NewGuid();
                await conn.ExecuteAsync(@"
                    INSERT INTO Players (PlayerId, FirstName, LastName, Grade, Position, JerseyNumber,
                                         OrganizationId, IsActive, CreatedAt, UpdatedAt)
                    VALUES (@PlayerId, @First, @Last, @Grade, @Position, @Jersey,
                            @OrgId, 1, SYSUTCDATETIME(), SYSUTCDATETIME())",
                    new { PlayerId = playerId, First = first, Last = last, Grade = request.Grade, Position = position, Jersey = request.JerseyNumber, OrgId = orgId }, tx);
                await AddToTeamAsync(conn, tx, teamId, playerId, request.JerseyNumber, position);
            }

            var entryId = await conn.ExecuteScalarAsync<Guid>(
                "SELECT Id FROM RosterEntries WHERE TeamId = @TeamId AND PlayerId = @PlayerId",
                new { TeamId = teamId, PlayerId = playerId }, tx);

            await AuditAsync(conn, tx, actorId, teamId, playerId, entryId, action, null, null);
            if (request.Confirm)
                await AuditAsync(conn, tx, actorId, teamId, playerId, entryId, "ConfirmedWarning", null, null);

            tx.Commit();
            return CoachRosterResult.Ok(new { rosterEntryId = entryId, playerId });
        }

        public async Task<CoachRosterResult> UpdatePlayerAsync(Guid actorId, Guid teamId, Guid rosterEntryId, UpdateRosterPlayerRequest request)
        {
            using var conn = _db.CreateConnection();
            using var tx = conn.BeginTransaction();

            var current = await conn.QuerySingleOrDefaultAsync<CoachRosterPlayer>(@"
                SELECT r.Id AS RosterEntryId, p.PlayerId, p.FirstName, p.LastName, p.Grade,
                       r.JerseyNumber, r.Position
                FROM RosterEntries r
                JOIN Players p ON p.PlayerId = r.PlayerId
                WHERE r.Id = @Id AND r.TeamId = @TeamId AND r.RemovedAtUtc IS NULL",
                new { Id = rosterEntryId, TeamId = teamId }, tx);
            if (current == null) return CoachRosterResult.NotFound("Roster entry not found");

            var first = request.FirstName == null ? current.FirstName : Clean(request.FirstName);
            var last = request.LastName == null ? current.LastName : Clean(request.LastName);
            var position = request.Position == null ? current.Position : (string.IsNullOrWhiteSpace(request.Position) ? null : Clean(request.Position));
            var invalid = Validate(first, last, request.Grade ?? current.Grade, request.JerseyNumber ?? current.JerseyNumber, position);
            if (invalid != null) return CoachRosterResult.Invalid(invalid);

            var newJersey = request.JerseyNumber ?? current.JerseyNumber;
            var newGrade = request.Grade ?? current.Grade;

            if (newJersey != current.JerseyNumber && !request.Confirm
                && await JerseyInUseAsync(conn, tx, teamId, newJersey, rosterEntryId))
                return CoachRosterResult.Warning("That jersey number is already used on this team", new { code = "JERSEY_IN_USE" });

            var nameChanged = first != current.FirstName || last != current.LastName;
            if (nameChanged || newGrade != current.Grade)
            {
                // Name and grade belong to the person, so they apply to every team the player is on
                await conn.ExecuteAsync(@"
                    UPDATE Players SET FirstName = @First, LastName = @Last, Grade = @Grade, UpdatedAt = SYSUTCDATETIME()
                    WHERE PlayerId = @PlayerId",
                    new { First = first, Last = last, Grade = newGrade, PlayerId = current.PlayerId }, tx);
            }

            if (newJersey != current.JerseyNumber || position != current.Position)
            {
                // Jersey and position are per team and never written back to Players
                await conn.ExecuteAsync(@"
                    UPDATE RosterEntries SET JerseyNumber = @Jersey, Position = @Position, UpdatedAt = SYSUTCDATETIME()
                    WHERE Id = @Id",
                    new { Jersey = newJersey, Position = position, Id = rosterEntryId }, tx);
            }

            if (nameChanged)
                await AuditAsync(conn, tx, actorId, teamId, current.PlayerId, rosterEntryId, "UpdateName",
                    $"{current.FirstName} {current.LastName}", $"{first} {last}");
            if (newGrade != current.Grade)
                await AuditAsync(conn, tx, actorId, teamId, current.PlayerId, rosterEntryId, "UpdateGrade",
                    current.Grade?.ToString(), newGrade?.ToString());
            if (newJersey != current.JerseyNumber)
                await AuditAsync(conn, tx, actorId, teamId, current.PlayerId, rosterEntryId, "UpdateJersey",
                    current.JerseyNumber?.ToString(), newJersey?.ToString());
            if (position != current.Position)
                await AuditAsync(conn, tx, actorId, teamId, current.PlayerId, rosterEntryId, "UpdatePosition",
                    current.Position, position);

            tx.Commit();
            return CoachRosterResult.Ok(new { rosterEntryId });
        }

        public async Task<CoachRosterResult> RemovePlayerAsync(Guid actorId, Guid teamId, Guid rosterEntryId)
        {
            using var conn = _db.CreateConnection();
            using var tx = conn.BeginTransaction();

            var playerId = await conn.ExecuteScalarAsync<Guid?>(@"
                UPDATE RosterEntries
                SET RemovedAtUtc = SYSUTCDATETIME(), RemovedByUserId = @ActorId, UpdatedAt = SYSUTCDATETIME()
                OUTPUT inserted.PlayerId
                WHERE Id = @Id AND TeamId = @TeamId AND RemovedAtUtc IS NULL",
                new { ActorId = actorId, Id = rosterEntryId, TeamId = teamId }, tx);
            if (playerId == null) return CoachRosterResult.NotFound("Roster entry not found");

            await AuditAsync(conn, tx, actorId, teamId, playerId, rosterEntryId, "RemovePlayer", null, null);
            tx.Commit();
            return CoachRosterResult.Ok();
        }

        private static async Task AddToTeamAsync(IDbConnection conn, IDbTransaction tx, Guid teamId, Guid playerId, int? jersey, string? position)
        {
            await conn.ExecuteAsync(@"
                IF NOT EXISTS (SELECT 1 FROM PlayerTeams WHERE PlayerId = @PlayerId AND TeamId = @TeamId)
                    INSERT INTO PlayerTeams (PlayerId, TeamId) VALUES (@PlayerId, @TeamId);",
                new { PlayerId = playerId, TeamId = teamId }, tx);

            // The PlayerTeams insert trigger normally creates the roster entry; create it here if it did not
            await conn.ExecuteAsync(@"
                IF NOT EXISTS (SELECT 1 FROM RosterEntries WHERE TeamId = @TeamId AND PlayerId = @PlayerId)
                    INSERT INTO RosterEntries (Id, TeamId, PlayerId, Position, JerseyNumber, IsActive, CreatedAt, UpdatedAt)
                    VALUES (NEWID(), @TeamId, @PlayerId, @Position, @Jersey, 1, SYSUTCDATETIME(), SYSUTCDATETIME());
                ELSE
                    UPDATE RosterEntries SET JerseyNumber = @Jersey, Position = @Position, UpdatedAt = SYSUTCDATETIME()
                    WHERE TeamId = @TeamId AND PlayerId = @PlayerId;",
                new { PlayerId = playerId, TeamId = teamId, Jersey = jersey, Position = position }, tx);
        }

        private static async Task<bool> JerseyInUseAsync(IDbConnection conn, IDbTransaction tx, Guid teamId, int? jersey, Guid? exceptEntryId)
        {
            if (jersey == null) return false;
            return await conn.ExecuteScalarAsync<bool>(@"
                SELECT CASE WHEN EXISTS (
                    SELECT 1 FROM RosterEntries
                    WHERE TeamId = @TeamId AND JerseyNumber = @Jersey AND RemovedAtUtc IS NULL
                      AND (@Except IS NULL OR Id <> @Except)
                ) THEN 1 ELSE 0 END",
                new { TeamId = teamId, Jersey = jersey, Except = exceptEntryId }, tx);
        }

        private static Task AuditAsync(IDbConnection conn, IDbTransaction tx, Guid actorId, Guid teamId, Guid? playerId,
            Guid? rosterEntryId, string action, string? oldValue, string? newValue)
        {
            return conn.ExecuteAsync(@"
                INSERT INTO RosterAuditLog (RosterAuditLogId, ActorUserId, TeamId, PlayerId, RosterEntryId, Action, OldValue, NewValue)
                VALUES (NEWID(), @ActorId, @TeamId, @PlayerId, @RosterEntryId, @Action, @OldValue, @NewValue)",
                new { ActorId = actorId, TeamId = teamId, PlayerId = playerId, RosterEntryId = rosterEntryId, Action = action, OldValue = oldValue, NewValue = newValue }, tx);
        }
    }
}
