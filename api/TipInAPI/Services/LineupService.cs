using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.Infrastructure.Database;

namespace TipInAPI.Services
{
    public sealed class LineupState
    {
        public Guid GameId { get; set; }
        public Guid TeamId { get; set; }
        public string? LevelName { get; set; }
        public bool IsVarsity { get; set; }
        public int Version { get; set; }
        public List<Guid> ParticipantIds { get; set; } = new();
        public List<Guid> StarterIds { get; set; } = new();
        public bool Locked { get; set; }
        public string? SignedBy { get; set; }
        public DateTime? SignedAtUtc { get; set; }
        public bool? SignedVerified { get; set; }
    }

    public sealed class SaveLineupRequest
    {
        // Version the caller last saw; 0 when no lineup exists yet
        public int ExpectedVersion { get; set; }
        public List<Guid>? ParticipantIds { get; set; }
        public List<Guid>? StarterIds { get; set; }
    }

    public sealed class SignLineupRequest
    {
        public int ExpectedVersion { get; set; }
        public string? SignerName { get; set; }
        public string? Device { get; set; }
    }

    public sealed class LineupActor
    {
        public Guid? UserId { get; set; }
        public string Label { get; set; } = "tablet";
        public bool Verified { get; set; }
    }

    public interface ILineupService
    {
        Task<CoachRosterResult> GetAsync(Guid gameId, Guid teamId);
        Task<CoachRosterResult> SaveAsync(Guid gameId, Guid teamId, LineupActor actor, SaveLineupRequest request);
        Task<CoachRosterResult> SignAsync(Guid gameId, Guid teamId, LineupActor actor, SignLineupRequest request);
        Task<CoachRosterResult> UnlockAsync(Guid gameId, Guid teamId, Guid actorUserId, string? reason);
        // Starters for each locked team in the game, keyed by team id
        Task<Dictionary<Guid, List<Guid>>> GetLockedStartersAsync(Guid gameId);
        Task<(Guid HomeTeamId, Guid AwayTeamId)?> GetGameTeamsAsync(Guid gameId);
        Task<IEnumerable<CoachGameItem>> ListGamesForTeamAsync(Guid teamId);
    }

    public class CoachGameItem
    {
        public Guid GameId { get; set; }
        public DateTime GameDateTime { get; set; }
        public string? Status { get; set; }
        public bool IsHome { get; set; }
        public string? OpponentName { get; set; }
        public string? OpponentLevelName { get; set; }
        public string? OpponentTeamType { get; set; }
        public string OpponentDisplayName => Infrastructure.TeamNameFormatter.Format(OpponentName, OpponentLevelName, OpponentTeamType);
        public bool Locked { get; set; }
        // The coach site applies its browser-local date cutoff to eligible games.
        public bool NeedsLineup => !Locked
            && !new[] { "final", "completed", "closed", "cancelled", "canceled", "postponed" }
                .Contains((Status ?? "").Trim().ToLowerInvariant());
    }

    public class LineupService : ILineupService
    {
        private readonly ISqlConnectionFactory _db;

        public LineupService(ISqlConnectionFactory db)
        {
            _db = db;
        }

        private sealed class GameRow
        {
            public Guid HomeTeamId { get; set; }
            public Guid AwayTeamId { get; set; }
            public string? Status { get; set; }
            public string? LevelName { get; set; }
        }

        private sealed class LineupRow
        {
            public string ParticipantIdsJson { get; set; } = "[]";
            public string StarterIdsJson { get; set; } = "[]";
            public int Version { get; set; }
        }

        private sealed class EventRow
        {
            public string EventType { get; set; } = "";
            public int LineupVersion { get; set; }
            public string? SignerName { get; set; }
            public bool IsVerified { get; set; }
            public DateTime CreatedAtUtc { get; set; }
        }

        private sealed class RosterRow
        {
            public Guid PlayerId { get; set; }
            public string FirstName { get; set; } = "";
            public string LastName { get; set; } = "";
            public int? JerseyNumber { get; set; }
            public string? Position { get; set; }
            public bool IsGoalie { get; set; }
        }

        private static bool IsVarsity(string? level) =>
            (level ?? "").Trim().ToLowerInvariant().Contains("varsity");

        private static bool IsGoalie(RosterRow r) =>
            r.IsGoalie || string.Equals(r.Position?.Trim(), "G", StringComparison.OrdinalIgnoreCase)
                       || string.Equals(r.Position?.Trim(), "Goalie", StringComparison.OrdinalIgnoreCase);

        private static List<Guid> ParseIds(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return new List<Guid>();
            try { return JsonSerializer.Deserialize<List<Guid>>(json) ?? new List<Guid>(); }
            catch { return new List<Guid>(); }
        }

        private static async Task<GameRow?> LoadGameAsync(IDbConnection conn, IDbTransaction? tx, Guid gameId, Guid teamId)
        {
            return await conn.QueryFirstOrDefaultAsync<GameRow>(@"
                SELECT g.HomeTeamId, g.AwayTeamId, g.Status, l.Name AS LevelName
                FROM dbo.Games g
                INNER JOIN dbo.Teams t ON t.Id = @TeamId
                LEFT JOIN dbo.Levels l ON l.Id = t.LevelId
                WHERE g.GameId = @GameId AND @TeamId IN (g.HomeTeamId, g.AwayTeamId);",
                new { GameId = gameId, TeamId = teamId }, tx);
        }

        private static async Task<EventRow?> LatestEventAsync(IDbConnection conn, IDbTransaction? tx, Guid gameId, Guid teamId)
        {
            return await conn.QueryFirstOrDefaultAsync<EventRow>(@"
                SELECT TOP 1 EventType, LineupVersion, SignerName, IsVerified, CreatedAtUtc
                FROM dbo.GameLineupEvents
                WHERE GameId = @GameId AND TeamId = @TeamId
                ORDER BY CreatedAtUtc DESC, EventId DESC;",
                new { GameId = gameId, TeamId = teamId }, tx);
        }

        private static async Task<List<RosterRow>> LoadRosterAsync(IDbConnection conn, IDbTransaction? tx, Guid teamId)
        {
            var rows = await conn.QueryAsync<RosterRow>(@"
                SELECT p.PlayerId, p.FirstName, p.LastName, re.JerseyNumber, re.Position, ISNULL(re.IsGoalie, 0) AS IsGoalie
                FROM dbo.RosterEntries re
                INNER JOIN dbo.Players p ON p.PlayerId = re.PlayerId
                WHERE re.TeamId = @TeamId AND re.RemovedAtUtc IS NULL;",
                new { TeamId = teamId }, tx);
            return rows.ToList();
        }

        private static string? Validate(string? levelName, List<Guid> participants, List<Guid> starters, List<RosterRow> roster)
        {
            if (participants.Count != participants.Distinct().Count()) return "Participants contain duplicates.";
            if (starters.Count != starters.Distinct().Count()) return "Starters contain duplicates.";

            var rosterIds = roster.Select(r => r.PlayerId).ToHashSet();
            if (participants.Any(p => !rosterIds.Contains(p))) return "Every participant must be on the team's active roster.";
            if (starters.Any(s => !participants.Contains(s))) return "Every starter must be a participant.";

            if (IsVarsity(levelName) && starters.Count != 6) return "Varsity lineups need exactly 6 starters.";
            if (starters.Count == 0) return "Select at least one starter.";
            if (!starters.Any(s => IsGoalie(roster.First(r => r.PlayerId == s)))) return "Goalie selection required. Select a goalie as a starter.";
            return null;
        }

        private static LineupState BuildState(Guid gameId, Guid teamId, string? level, LineupRow? row, EventRow? last)
        {
            var state = new LineupState
            {
                GameId = gameId,
                TeamId = teamId,
                LevelName = level,
                IsVarsity = IsVarsity(level),
                Version = row?.Version ?? 0,
                ParticipantIds = ParseIds(row?.ParticipantIdsJson),
                StarterIds = ParseIds(row?.StarterIdsJson),
            };
            if (last != null && last.EventType == "Sign")
            {
                state.Locked = true;
                state.SignedBy = last.SignerName;
                state.SignedAtUtc = last.CreatedAtUtc;
                state.SignedVerified = last.IsVerified;
            }
            return state;
        }

        public async Task<CoachRosterResult> GetAsync(Guid gameId, Guid teamId)
        {
            using var conn = _db.CreateConnection();
            var game = await LoadGameAsync(conn, null, gameId, teamId);
            if (game == null) return CoachRosterResult.NotFound("Game or team not found.");

            var row = await conn.QueryFirstOrDefaultAsync<LineupRow>(
                "SELECT ParticipantIdsJson, StarterIdsJson, Version FROM dbo.GameLineups WHERE GameId = @GameId AND TeamId = @TeamId;",
                new { GameId = gameId, TeamId = teamId });
            var last = await LatestEventAsync(conn, null, gameId, teamId);
            return CoachRosterResult.Ok(BuildState(gameId, teamId, game.LevelName, row, last));
        }

        public async Task<CoachRosterResult> SaveAsync(Guid gameId, Guid teamId, LineupActor actor, SaveLineupRequest request)
        {
            var participants = request.ParticipantIds ?? new List<Guid>();
            var starters = request.StarterIds ?? new List<Guid>();

            using var conn = _db.CreateConnection();
            using var tx = conn.BeginTransaction(IsolationLevel.Serializable);

            var game = await LoadGameAsync(conn, tx, gameId, teamId);
            if (game == null) return CoachRosterResult.NotFound("Game or team not found.");

            var error = Validate(game.LevelName, participants, starters, await LoadRosterAsync(conn, tx, teamId));
            if (error != null) return CoachRosterResult.Invalid(error);

            var current = await conn.QueryFirstOrDefaultAsync<LineupRow>(
                "SELECT ParticipantIdsJson, StarterIdsJson, Version FROM dbo.GameLineups WITH (UPDLOCK, HOLDLOCK) WHERE GameId = @GameId AND TeamId = @TeamId;",
                new { GameId = gameId, TeamId = teamId }, tx);
            var last = await LatestEventAsync(conn, tx, gameId, teamId);

            if (last?.EventType == "Sign")
                return CoachRosterResult.Warning("The lineup is signed and locked.", new { code = "LINEUP_LOCKED" });

            var currentVersion = current?.Version ?? 0;
            if (request.ExpectedVersion != currentVersion)
                return CoachRosterResult.Warning("The lineup was changed by someone else.",
                    new { code = "STALE_VERSION", currentVersion, current = BuildState(gameId, teamId, game.LevelName, current, last) });

            var newVersion = currentVersion + 1;
            var args = new
            {
                GameId = gameId,
                TeamId = teamId,
                Participants = JsonSerializer.Serialize(participants),
                Starters = JsonSerializer.Serialize(starters),
                Version = newVersion,
                UserId = actor.UserId,
                By = actor.Label,
            };

            if (current == null)
            {
                await conn.ExecuteAsync(@"
                    INSERT INTO dbo.GameLineups (GameId, TeamId, ParticipantIdsJson, StarterIdsJson, Version, UpdatedByUserId, UpdatedBy)
                    VALUES (@GameId, @TeamId, @Participants, @Starters, @Version, @UserId, @By);", args, tx);
            }
            else
            {
                await conn.ExecuteAsync(@"
                    UPDATE dbo.GameLineups
                    SET ParticipantIdsJson = @Participants, StarterIdsJson = @Starters, Version = @Version,
                        UpdatedAtUtc = SYSUTCDATETIME(), UpdatedByUserId = @UserId, UpdatedBy = @By
                    WHERE GameId = @GameId AND TeamId = @TeamId;", args, tx);
            }

            await CopyToLiveStatusAsync(conn, tx, gameId, game, teamId, starters);
            tx.Commit();

            return CoachRosterResult.Ok(new LineupState
            {
                GameId = gameId, TeamId = teamId, LevelName = game.LevelName, IsVarsity = IsVarsity(game.LevelName),
                Version = newVersion, ParticipantIds = participants, StarterIds = starters,
            });
        }

        // GameLiveStatus.*StartersJson stays the copy the public view and tablet read
        private static async Task CopyToLiveStatusAsync(IDbConnection conn, IDbTransaction tx, Guid gameId, GameRow game, Guid teamId, List<Guid> starters)
        {
            var isHome = teamId == game.HomeTeamId;
            var json = JsonSerializer.Serialize(starters);
            var column = isHome ? "HomeStartersJson" : "AwayStartersJson";
            await conn.ExecuteAsync($@"
                IF OBJECT_ID('dbo.GameLiveStatus', 'U') IS NOT NULL
                MERGE dbo.GameLiveStatus AS target
                USING (SELECT @GameId AS GameId) AS source ON target.GameId = source.GameId
                WHEN MATCHED THEN UPDATE SET {column} = @Json, UpdatedAt = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT (GameId, {column}) VALUES (@GameId, @Json);",
                new { GameId = gameId, Json = json }, tx);
        }

        public async Task<CoachRosterResult> SignAsync(Guid gameId, Guid teamId, LineupActor actor, SignLineupRequest request)
        {
            var signer = request.SignerName?.Trim();
            if (string.IsNullOrWhiteSpace(signer)) return CoachRosterResult.Invalid("Signer name is required.");
            if (signer.Length > 200) return CoachRosterResult.Invalid("Signer name is too long.");

            using var conn = _db.CreateConnection();
            using var tx = conn.BeginTransaction(IsolationLevel.Serializable);

            var game = await LoadGameAsync(conn, tx, gameId, teamId);
            if (game == null) return CoachRosterResult.NotFound("Game or team not found.");

            var current = await conn.QueryFirstOrDefaultAsync<LineupRow>(
                "SELECT ParticipantIdsJson, StarterIdsJson, Version FROM dbo.GameLineups WITH (UPDLOCK, HOLDLOCK) WHERE GameId = @GameId AND TeamId = @TeamId;",
                new { GameId = gameId, TeamId = teamId }, tx);
            if (current == null) return CoachRosterResult.Invalid("Save a lineup before signing.");

            var last = await LatestEventAsync(conn, tx, gameId, teamId);
            if (last?.EventType == "Sign")
                return CoachRosterResult.Warning("The lineup is already signed.", new { code = "LINEUP_LOCKED" });

            if (request.ExpectedVersion != current.Version)
                return CoachRosterResult.Warning("The lineup changed after you reviewed it.",
                    new { code = "STALE_VERSION", currentVersion = current.Version });

            var participants = ParseIds(current.ParticipantIdsJson);
            var starters = ParseIds(current.StarterIdsJson);
            var roster = await LoadRosterAsync(conn, tx, teamId);
            var error = Validate(game.LevelName, participants, starters, roster);
            if (error != null) return CoachRosterResult.Invalid(error);

            var snapshot = JsonSerializer.Serialize(new
            {
                version = current.Version,
                players = roster.Where(r => participants.Contains(r.PlayerId)).Select(r => new
                {
                    playerId = r.PlayerId, r.FirstName, r.LastName, r.JerseyNumber, r.Position,
                    starter = starters.Contains(r.PlayerId),
                }),
            });

            var eventId = Guid.NewGuid();
            await conn.ExecuteAsync(@"
                INSERT INTO dbo.GameLineupEvents (EventId, GameId, TeamId, EventType, LineupVersion, SignerName, Device, IsVerified, ActorUserId, SnapshotJson)
                VALUES (@EventId, @GameId, @TeamId, 'Sign', @Version, @Signer, @Device, @Verified, @UserId, @Snapshot);",
                new
                {
                    EventId = eventId, GameId = gameId, TeamId = teamId, Version = current.Version, Signer = signer,
                    Device = request.Device?.Trim(), Verified = actor.Verified, UserId = actor.UserId, Snapshot = snapshot,
                }, tx);
            tx.Commit();

            return CoachRosterResult.Ok(new { locked = true, version = current.Version, signedBy = signer });
        }

        public async Task<CoachRosterResult> UnlockAsync(Guid gameId, Guid teamId, Guid actorUserId, string? reason)
        {
            reason = reason?.Trim();
            if (string.IsNullOrWhiteSpace(reason)) return CoachRosterResult.Invalid("A reason is required to unlock a lineup.");
            if (reason.Length > 500) return CoachRosterResult.Invalid("Reason is too long.");

            using var conn = _db.CreateConnection();
            using var tx = conn.BeginTransaction(IsolationLevel.Serializable);

            var game = await LoadGameAsync(conn, tx, gameId, teamId);
            if (game == null) return CoachRosterResult.NotFound("Game or team not found.");

            var current = await conn.QueryFirstOrDefaultAsync<LineupRow>(
                "SELECT ParticipantIdsJson, StarterIdsJson, Version FROM dbo.GameLineups WITH (UPDLOCK, HOLDLOCK) WHERE GameId = @GameId AND TeamId = @TeamId;",
                new { GameId = gameId, TeamId = teamId }, tx);
            var last = await LatestEventAsync(conn, tx, gameId, teamId);
            if (current == null || last?.EventType != "Sign")
                return CoachRosterResult.Invalid("The lineup is not locked.");

            await conn.ExecuteAsync(@"
                INSERT INTO dbo.GameLineupEvents (EventId, GameId, TeamId, EventType, LineupVersion, ActorUserId, Reason, IsVerified)
                VALUES (@EventId, @GameId, @TeamId, 'Unlock', @Version, @UserId, @Reason, 1);",
                new { EventId = Guid.NewGuid(), GameId = gameId, TeamId = teamId, Version = current.Version, UserId = actorUserId, Reason = reason }, tx);
            tx.Commit();

            return CoachRosterResult.Ok(new { locked = false, version = current.Version });
        }

        public async Task<Dictionary<Guid, List<Guid>>> GetLockedStartersAsync(Guid gameId)
        {
            using var conn = _db.CreateConnection();
            var rows = await conn.QueryAsync<(Guid TeamId, string StarterIdsJson)>(@"
                SELECT l.TeamId, l.StarterIdsJson
                FROM dbo.GameLineups l
                CROSS APPLY (
                    SELECT TOP 1 e.EventType
                    FROM dbo.GameLineupEvents e
                    WHERE e.GameId = l.GameId AND e.TeamId = l.TeamId
                    ORDER BY e.CreatedAtUtc DESC, e.EventId DESC
                ) latest
                WHERE l.GameId = @GameId AND latest.EventType = 'Sign';", new { GameId = gameId });
            return rows.ToDictionary(r => r.TeamId, r => ParseIds(r.StarterIdsJson));
        }

        public async Task<IEnumerable<CoachGameItem>> ListGamesForTeamAsync(Guid teamId)
        {
            using var conn = _db.CreateConnection();
            return (await conn.QueryAsync<CoachGameItem>(@"
                SELECT g.GameId, g.GameDateTime, g.Status,
                       CASE WHEN g.HomeTeamId = @TeamId THEN 1 ELSE 0 END AS IsHome,
                       opp.Name AS OpponentName,
                       ol.Name AS OpponentLevelName, opp.TeamType AS OpponentTeamType,
                       CASE WHEN (SELECT TOP 1 e.EventType FROM dbo.GameLineupEvents e
                                  WHERE e.GameId = g.GameId AND e.TeamId = @TeamId
                                  ORDER BY e.CreatedAtUtc DESC, e.EventId DESC) = 'Sign' THEN 1 ELSE 0 END AS Locked
                FROM dbo.Games g
                INNER JOIN dbo.Teams opp ON opp.Id = CASE WHEN g.HomeTeamId = @TeamId THEN g.AwayTeamId ELSE g.HomeTeamId END
                LEFT JOIN dbo.Levels ol ON ol.Id = opp.LevelId
                WHERE @TeamId IN (g.HomeTeamId, g.AwayTeamId)
                  AND ISNULL(g.Status, '') <> 'Cancelled'
                  AND g.GameDateTime >= DATEADD(DAY, -7, SYSUTCDATETIME())
                  AND g.GameDateTime <= DATEADD(DAY, 60, SYSUTCDATETIME())
                ORDER BY g.GameDateTime;",
                new { TeamId = teamId })).ToList();
        }

        public async Task<(Guid HomeTeamId, Guid AwayTeamId)?> GetGameTeamsAsync(Guid gameId)
        {
            using var conn = _db.CreateConnection();
            var g = await conn.QueryFirstOrDefaultAsync<GameRow>(
                "SELECT HomeTeamId, AwayTeamId FROM dbo.Games WHERE GameId = @GameId;", new { GameId = gameId });
            return g == null ? null : (g.HomeTeamId, g.AwayTeamId);
        }
    }
}
