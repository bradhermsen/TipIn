using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.Infrastructure.Database;

namespace TipInAPI.Services
{
    public class CoachInvitationItem
    {
        public Guid InvitationId { get; set; }
        public Guid TeamId { get; set; }
        public string Email { get; set; } = "";
        public string Status { get; set; } = "";
        public bool IsExpired { get; set; }
        public DateTime ExpiresAtUtc { get; set; }
        public DateTime CreatedAtUtc { get; set; }
        public DateTime? UsedAtUtc { get; set; }
        public DateTime? RevokedAtUtc { get; set; }
    }

    public class CreatedCoachInvitation
    {
        public Guid InvitationId { get; set; }
        public Guid TeamId { get; set; }
        public string TeamName { get; set; } = "";
        public string? LevelName { get; set; }
        public string? TeamType { get; set; }
        public string TeamDisplayName => Infrastructure.TeamNameFormatter.Format(TeamName, LevelName, TeamType);
        public string Email { get; set; } = "";
        public DateTime ExpiresAtUtc { get; set; }
        public string Token { get; set; } = "";
    }

    public enum AcceptInviteStatus
    {
        Accepted,
        Invalid,
        Expired,
        Used,
        Revoked,
        WrongEmail,
        InvalidCredentials,
        WeakPassword,
        MissingDetails
    }

    public class AcceptInviteResult
    {
        public AcceptInviteStatus Status { get; set; }
        public Guid? TeamId { get; set; }
        public string? TeamName { get; set; }
        public bool CreatedAccount { get; set; }
    }

    public interface ICoachInvitationService
    {
        Task<CreatedCoachInvitation> CreateAsync(Guid createdByUserId, Guid teamId, string email);
        Task<IEnumerable<CoachInvitationItem>> ListForTeamAsync(Guid teamId);
        Task<Guid?> GetTeamIdAsync(Guid invitationId);
        Task<bool> RevokeAsync(Guid invitationId, Guid revokedByUserId);
        Task<AcceptInviteResult> AcceptAsync(string token, string email, string password, string? firstName, string? lastName);
    }

    public class CoachInvitationService : ICoachInvitationService
    {
        public const int InviteLifetimeDays = 7;
        private const int MaxFailedAttempts = 5;
        private const int MinPasswordLength = 10;

        private readonly ISqlConnectionFactory _db;

        public CoachInvitationService(ISqlConnectionFactory db)
        {
            _db = db;
        }

        public static string HashToken(string token)
        {
            var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
            return Convert.ToHexString(bytes).ToLowerInvariant();
        }

        private static string NewToken()
        {
            var bytes = RandomNumberGenerator.GetBytes(32);
            return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        private static string NormalizeEmail(string email) => (email ?? "").Trim().ToLowerInvariant();

        // Creating a new invite for the same team and email replaces (revokes) the pending one.
        public async Task<CreatedCoachInvitation> CreateAsync(Guid createdByUserId, Guid teamId, string email)
        {
            email = NormalizeEmail(email);
            var token = NewToken();
            var invitationId = Guid.NewGuid();
            var expires = DateTime.UtcNow.AddDays(InviteLifetimeDays);

            using var conn = _db.CreateConnection();
            using var tx = conn.BeginTransaction();
            try
            {
                var team = await conn.QuerySingleOrDefaultAsync<DTOs.CoachTeamDetailDto>(@"
                    SELECT t.Name AS TeamName, l.Name AS LevelName, t.TeamType
                    FROM dbo.Teams t
                    LEFT JOIN dbo.Levels l ON l.Id = t.LevelId
                    WHERE t.Id = @TeamId", new { TeamId = teamId }, tx);
                if (team == null)
                    throw new InvalidOperationException("Team not found.");

                await conn.ExecuteAsync(@"
                    UPDATE dbo.CoachInvitations
                    SET Status = 'Revoked', RevokedAtUtc = SYSUTCDATETIME(), RevokedByUserId = @UserId
                    WHERE TeamId = @TeamId AND Email = @Email AND Status = 'Pending';",
                    new { UserId = createdByUserId, TeamId = teamId, Email = email }, tx);

                await conn.ExecuteAsync(@"
                    INSERT INTO dbo.CoachInvitations
                        (InvitationId, TeamId, Email, TokenHash, Status, ExpiresAtUtc, CreatedByUserId)
                    VALUES
                        (@InvitationId, @TeamId, @Email, @TokenHash, 'Pending', @ExpiresAtUtc, @CreatedBy);",
                    new
                    {
                        InvitationId = invitationId,
                        TeamId = teamId,
                        Email = email,
                        TokenHash = HashToken(token),
                        ExpiresAtUtc = expires,
                        CreatedBy = createdByUserId
                    }, tx);

                tx.Commit();

                return new CreatedCoachInvitation
                {
                    InvitationId = invitationId,
                    TeamId = teamId,
                    TeamName = team.TeamName!,
                    LevelName = team.LevelName,
                    TeamType = team.TeamType,
                    Email = email,
                    ExpiresAtUtc = expires,
                    Token = token
                };
            }
            catch
            {
                tx.Rollback();
                throw;
            }
        }

        public async Task<IEnumerable<CoachInvitationItem>> ListForTeamAsync(Guid teamId)
        {
            using var conn = _db.CreateConnection();
            return (await conn.QueryAsync<CoachInvitationItem>(@"
                SELECT InvitationId, TeamId, Email, Status,
                       CASE WHEN Status = 'Pending' AND ExpiresAtUtc < SYSUTCDATETIME() THEN 1 ELSE 0 END AS IsExpired,
                       ExpiresAtUtc, CreatedAtUtc, UsedAtUtc, RevokedAtUtc
                FROM dbo.CoachInvitations
                WHERE TeamId = @TeamId
                ORDER BY CreatedAtUtc DESC;",
                new { TeamId = teamId })).ToList();
        }

        public async Task<Guid?> GetTeamIdAsync(Guid invitationId)
        {
            using var conn = _db.CreateConnection();
            return await conn.ExecuteScalarAsync<Guid?>(
                "SELECT TeamId FROM dbo.CoachInvitations WHERE InvitationId = @Id",
                new { Id = invitationId });
        }

        public async Task<bool> RevokeAsync(Guid invitationId, Guid revokedByUserId)
        {
            using var conn = _db.CreateConnection();
            var rows = await conn.ExecuteAsync(@"
                UPDATE dbo.CoachInvitations
                SET Status = 'Revoked', RevokedAtUtc = SYSUTCDATETIME(), RevokedByUserId = @UserId
                WHERE InvitationId = @Id AND Status = 'Pending';",
                new { Id = invitationId, UserId = revokedByUserId });
            return rows == 1;
        }

        private sealed class InviteRow
        {
            public Guid InvitationId { get; set; }
            public Guid TeamId { get; set; }
            public string Email { get; set; } = "";
            public string Status { get; set; } = "";
            public DateTime ExpiresAtUtc { get; set; }
            public int FailedAttempts { get; set; }
            public string TeamName { get; set; } = "";
            public Guid? OrganizationId { get; set; }
        }

        private sealed class ExistingAuth
        {
            public Guid Id { get; set; }
            public string PasswordHash { get; set; } = "";
            public bool IsActive { get; set; }
        }

        public async Task<AcceptInviteResult> AcceptAsync(
            string token, string email, string password, string? firstName, string? lastName)
        {
            if (string.IsNullOrWhiteSpace(token))
                return new AcceptInviteResult { Status = AcceptInviteStatus.Invalid };

            email = NormalizeEmail(email);
            var hash = HashToken(token.Trim());

            using var conn = _db.CreateConnection();

            var invite = await conn.QueryFirstOrDefaultAsync<InviteRow>(@"
                SELECT i.InvitationId, i.TeamId, i.Email, i.Status, i.ExpiresAtUtc, i.FailedAttempts,
                       t.Name AS TeamName, t.OrganizationId
                FROM dbo.CoachInvitations i
                JOIN dbo.Teams t ON t.Id = i.TeamId
                WHERE i.TokenHash = @Hash;", new { Hash = hash });

            if (invite == null)
                return new AcceptInviteResult { Status = AcceptInviteStatus.Invalid };
            if (invite.Status == "Accepted")
                return new AcceptInviteResult { Status = AcceptInviteStatus.Used };
            if (invite.Status == "Revoked" || invite.FailedAttempts >= MaxFailedAttempts)
                return new AcceptInviteResult { Status = AcceptInviteStatus.Revoked };
            if (invite.ExpiresAtUtc < DateTime.UtcNow)
                return new AcceptInviteResult { Status = AcceptInviteStatus.Expired };
            if (!string.Equals(invite.Email, email, StringComparison.OrdinalIgnoreCase))
                return new AcceptInviteResult { Status = AcceptInviteStatus.WrongEmail };

            var existing = await conn.QueryFirstOrDefaultAsync<ExistingAuth>(
                "SELECT TOP 1 Id, PasswordHash, IsActive FROM dbo.AuthUsers WHERE Email = @Email;",
                new { Email = email });

            Guid userId;
            var createAccount = existing == null;

            if (existing != null)
            {
                // Existing account: must prove ownership with its current password
                var ok = existing.IsActive &&
                         !string.IsNullOrEmpty(password) &&
                         BCrypt.Net.BCrypt.Verify(password, existing.PasswordHash);
                if (!ok)
                {
                    await conn.ExecuteAsync(
                        "UPDATE dbo.CoachInvitations SET FailedAttempts = FailedAttempts + 1 WHERE InvitationId = @Id;",
                        new { Id = invite.InvitationId });
                    return new AcceptInviteResult { Status = AcceptInviteStatus.InvalidCredentials };
                }
                userId = existing.Id;
            }
            else
            {
                if (string.IsNullOrWhiteSpace(firstName) || string.IsNullOrWhiteSpace(lastName))
                    return new AcceptInviteResult { Status = AcceptInviteStatus.MissingDetails };
                if (string.IsNullOrEmpty(password) || password.Length < MinPasswordLength)
                    return new AcceptInviteResult { Status = AcceptInviteStatus.WeakPassword };
                userId = Guid.NewGuid();
            }

            using var tx = conn.BeginTransaction();
            try
            {
                // Atomic single-use consumption: only one concurrent caller can flip Pending to Accepted
                var consumed = await conn.ExecuteAsync(@"
                    UPDATE dbo.CoachInvitations
                    SET Status = 'Accepted', UsedAtUtc = SYSUTCDATETIME(), UsedByUserId = @UserId
                    WHERE InvitationId = @Id AND Status = 'Pending' AND ExpiresAtUtc >= SYSUTCDATETIME();",
                    new { Id = invite.InvitationId, UserId = userId }, tx);

                if (consumed != 1)
                {
                    tx.Rollback();
                    return new AcceptInviteResult { Status = AcceptInviteStatus.Used };
                }

                if (createAccount)
                {
                    var now = DateTime.UtcNow;
                    await conn.ExecuteAsync(@"
                        INSERT INTO dbo.AuthUsers (Id, Email, PasswordHash, Role, IsActive, CreatedAt)
                        VALUES (@Id, @Email, @PasswordHash, 'Coach', 1, @Now);",
                        new { Id = userId, Email = email, PasswordHash = BCrypt.Net.BCrypt.HashPassword(password), Now = now }, tx);
                    await conn.ExecuteAsync(@"
                        INSERT INTO dbo.Users (Id, OrganizationId, FirstName, LastName, Email, CreatedAt)
                        VALUES (@Id, @OrganizationId, @FirstName, @LastName, @Email, @Now);",
                        new
                        {
                            Id = userId,
                            OrganizationId = invite.OrganizationId,
                            FirstName = firstName!.Trim(),
                            LastName = lastName!.Trim(),
                            Email = email,
                            Now = now
                        }, tx);
                }

                // Existing accounts keep their role. Only the team assignment is added.
                await conn.ExecuteAsync(@"
                    IF NOT EXISTS (SELECT 1 FROM dbo.CoachTeams WHERE UserId = @UserId AND TeamId = @TeamId)
                        INSERT INTO dbo.CoachTeams (UserId, TeamId) VALUES (@UserId, @TeamId);",
                    new { UserId = userId, TeamId = invite.TeamId }, tx);

                tx.Commit();
            }
            catch
            {
                tx.Rollback();
                throw;
            }

            return new AcceptInviteResult
            {
                Status = AcceptInviteStatus.Accepted,
                TeamId = invite.TeamId,
                TeamName = invite.TeamName,
                CreatedAccount = createAccount
            };
        }
    }
}
