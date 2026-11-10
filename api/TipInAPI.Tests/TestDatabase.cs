using System;
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.Linq;
using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;
using TipInAPI.Infrastructure.Database;

namespace TipInAPI.Tests
{
    public sealed class TestConnectionFactory : ISqlConnectionFactory
    {
        private readonly string _cs;
        public TestConnectionFactory(string cs) { _cs = cs; }

        public IDbConnection CreateConnection()
        {
            var conn = new SqlConnection(_cs);
            conn.Open();
            return conn;
        }
    }

    /// <summary>
    /// Creates an isolated set of organizations, teams, users and games in a non-production database
    /// and removes everything it created on dispose.
    /// Connection string: TIPIN_TEST_CONNECTION, or ConnectionStrings:DefaultConnection from the API's local.settings.json.
    /// </summary>
    public sealed class TestDatabase : IDisposable
    {
        public TestConnectionFactory Factory { get; }

        public Guid HostOrgId = Guid.NewGuid();
        public Guid OtherOrgId = Guid.NewGuid();
        public Guid VisitorOrgId = Guid.NewGuid();

        public Guid HostTeamId = Guid.NewGuid();
        public Guid HostTeam2Id = Guid.NewGuid();
        public Guid OtherTeamId = Guid.NewGuid();
        public Guid VisitorTeamId = Guid.NewGuid();
        public Guid FarVisitorTeamId = Guid.NewGuid();

        public Guid HostAdminId = Guid.NewGuid();
        public Guid NoOrgAdminId = Guid.NewGuid();

        private readonly string _tag = "ZZTEST-" + Guid.NewGuid().ToString("N")[..8];

        public TestDatabase()
        {
            var cs = Environment.GetEnvironmentVariable("TIPIN_TEST_CONNECTION") ?? ReadLocalSettings();
            var builder = new SqlConnectionStringBuilder(cs);
            if (builder.InitialCatalog.Contains("prod", StringComparison.OrdinalIgnoreCase)
                || builder.DataSource.Contains("prod", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Refusing to run tests against a production database.");

            Factory = new TestConnectionFactory(cs);
            try { Seed(); }
            catch { Dispose(); throw; }
        }

        private static string ReadLocalSettings()
        {
            var dir = AppContext.BaseDirectory;
            while (dir != null && !File.Exists(Path.Combine(dir, "TipInAPI", "local.settings.json")))
                dir = Path.GetDirectoryName(dir);
            if (dir == null) throw new InvalidOperationException("Set TIPIN_TEST_CONNECTION to a non-production database.");

            using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(dir, "TipInAPI", "local.settings.json")),
                new JsonDocumentOptions { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true });
            return doc.RootElement.GetProperty("ConnectionStrings").GetProperty("DefaultConnection").GetString()!;
        }

        private string Name(Guid id) => _tag + "-" + id.ToString("N")[..6];

        private void Seed()
        {
            using var conn = Factory.CreateConnection();
            var levelId = conn.ExecuteScalar<Guid>("SELECT TOP 1 Id FROM Levels");
            var seasonId = conn.ExecuteScalar<Guid>("SELECT TOP 1 SeasonId FROM Seasons");

            void Org(Guid id, string type) => conn.Execute(
                @"INSERT INTO Organizations (OrganizationId, Name, CreatedAt, UpdatedAt, IsActive, OrganizationType)
                  VALUES (@id, @name, SYSUTCDATETIME(), SYSUTCDATETIME(), 1, @type)",
                new { id, name = Name(id), type });

            void Team(Guid id, Guid orgId, bool external) => conn.Execute(
                @"INSERT INTO Teams (Id, OrganizationId, LevelId, SeasonId, Name, IsExternal, IsActive, UpdatedAt,
                      AssistantCoach1HasLogin, AssistantCoach2HasLogin, AssistantCoach3HasLogin, AssistantCoach4HasLogin)
                  VALUES (@id, @orgId, @levelId, @seasonId, @name, @external, 1, SYSUTCDATETIME(), 0, 0, 0, 0)",
                new { id, orgId, levelId, seasonId, name = Name(id), external });

            void User(Guid id, Guid? orgId) => conn.Execute(
                @"INSERT INTO AuthUsers (Id, Email, PasswordHash, Role, IsActive, CreatedAt)
                  VALUES (@id, @email, 'x', 'OrgAdmin', 1, SYSUTCDATETIME());
                  INSERT INTO Users (Id, FirstName, LastName, CreatedAt, Email, OrganizationId)
                  VALUES (@id, 'Test', 'User', SYSUTCDATETIME(), @email, @orgId)",
                new { id, orgId, email = Name(id) + "@example.test" });

            Org(HostOrgId, "Managed");
            Org(OtherOrgId, "Managed");
            Org(VisitorOrgId, "External");

            Team(HostTeamId, HostOrgId, false);
            Team(HostTeam2Id, HostOrgId, false);
            Team(OtherTeamId, OtherOrgId, false);
            Team(VisitorTeamId, VisitorOrgId, true);
            Team(FarVisitorTeamId, VisitorOrgId, true);

            User(HostAdminId, HostOrgId);
            User(NoOrgAdminId, null);

            AddGame(HostTeamId, VisitorTeamId, 5, "Scheduled");
            AddGame(HostTeamId, FarVisitorTeamId, 90, "Scheduled");
        }

        public Guid AddGame(Guid home, Guid away, int daysFromNow, string status)
        {
            var gameId = Guid.NewGuid();
            using var conn = Factory.CreateConnection();
            conn.Execute(
                @"INSERT INTO Games (GameId, HomeTeamId, AwayTeamId, GameDateTime, Status, CreatedAt, UpdatedAt, PeriodLengthMinutes)
                  VALUES (@gameId, @home, @away, DATEADD(DAY, @daysFromNow, SYSUTCDATETIME()), @status, SYSUTCDATETIME(), SYSUTCDATETIME(), 15)",
                new { gameId, home, away, daysFromNow, status });
            return gameId;
        }

        public Guid AddCoach(Guid teamId)
        {
            var id = Guid.NewGuid();
            using var conn = Factory.CreateConnection();
            conn.Execute(
                @"INSERT INTO AuthUsers (Id, Email, PasswordHash, Role, IsActive, CreatedAt)
                  VALUES (@id, @email, 'x', 'Coach', 1, SYSUTCDATETIME());
                  INSERT INTO Users (Id, FirstName, LastName, CreatedAt, Email, OrganizationId)
                  VALUES (@id, 'Test', 'Coach', SYSUTCDATETIME(), @email, NULL);
                  INSERT INTO CoachTeams (Id, UserId, TeamId) VALUES (NEWID(), @id, @teamId);",
                new { id, teamId, email = Name(id) + "@example.test" });
            return id;
        }

        public Guid AddPlayer(Guid orgId, string first, string last, int? jersey = null, Guid? onTeam = null)
        {
            var id = Guid.NewGuid();
            using var conn = Factory.CreateConnection();
            conn.Execute(
                @"INSERT INTO Players (PlayerId, FirstName, LastName, JerseyNumber, OrganizationId, IsActive, CreatedAt, UpdatedAt)
                  VALUES (@id, @first, @last, @jersey, @orgId, 1, SYSUTCDATETIME(), SYSUTCDATETIME())",
                new { id, first, last, jersey, orgId });
            if (onTeam != null)
                conn.Execute("INSERT INTO PlayerTeams (PlayerId, TeamId) VALUES (@id, @teamId)", new { id, teamId = onTeam });
            return id;
        }

        public T Scalar<T>(string sql, object? args = null)
        {
            using var conn = Factory.CreateConnection();
            return conn.ExecuteScalar<T>(sql, args);
        }

        public void Dispose()
        {
            using var conn = Factory.CreateConnection();
            var teams = new[] { HostTeamId, HostTeam2Id, OtherTeamId, VisitorTeamId, FarVisitorTeamId };
            var orgs = new[] { HostOrgId, OtherOrgId, VisitorOrgId };

            // Players are matched by organization, so players created through the service are cleaned up too
            conn.Execute(@"
                DELETE FROM RosterAuditLog WHERE TeamId IN @teams;
                DELETE FROM RosterEntries WHERE TeamId IN @teams;
                DELETE FROM PlayerTeams WHERE TeamId IN @teams;
                DELETE FROM Players WHERE OrganizationId IN @orgs;
                DELETE FROM CoachInvitations WHERE TeamId IN @teams;
                DELETE FROM GameLineupEvents WHERE TeamId IN @teams;
                DELETE FROM GameLineups WHERE TeamId IN @teams;
                DELETE FROM GameLiveStatus WHERE GameId IN (SELECT GameId FROM Games WHERE HomeTeamId IN @teams OR AwayTeamId IN @teams);
                DELETE FROM Games WHERE HomeTeamId IN @teams OR AwayTeamId IN @teams;
                DELETE FROM CoachTeams WHERE TeamId IN @teams;
                DELETE FROM CoachTeams WHERE UserId IN (SELECT Id FROM Users WHERE Email LIKE @emailLike);
                DELETE FROM Users WHERE Email LIKE @emailLike;
                DELETE FROM AuthUsers WHERE Email LIKE @emailLike;
                DELETE FROM Teams WHERE Id IN @teams;
                DELETE FROM Organizations WHERE OrganizationId IN @orgs;",
                new { teams, orgs, emailLike = _tag + "-%" });
        }
    }
}
