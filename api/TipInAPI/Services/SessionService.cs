using System;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using TipInAPI.Infrastructure.Database;

namespace TipInAPI.Services
{
    public class RefreshResult
    {
        public string AccessToken { get; set; } = "";
        public string RefreshToken { get; set; } = "";
        public string Role { get; set; } = "";
        public Guid UserId { get; set; }
    }

    public interface ISessionService
    {
        string CreateAccessToken(Guid userId, string email, string role);
        Task<string> IssueRefreshTokenAsync(Guid userId);
        Task<RefreshResult?> RotateAsync(string refreshToken);
        Task RevokeAsync(string refreshToken);
        Task RevokeAllForUserAsync(Guid userId);

        /// <summary>Returns the token to email, or null when the account doesn't exist or is rate-limited.</summary>
        Task<(string Token, string Email)?> CreatePasswordResetAsync(string email);
        Task<bool> ResetPasswordAsync(string token, string newPassword);
    }

    public class SessionService : ISessionService
    {
        public const int SlidingDays = 30;
        public const int AbsoluteDays = 90;
        private const int ResetLifetimeMinutes = 60;
        private const int MaxResetRequestsPerHour = 3;
        public const int MinPasswordLength = 10;

        private readonly ISqlConnectionFactory _db;
        private readonly IConfiguration _config;

        public SessionService(ISqlConnectionFactory db, IConfiguration config)
        {
            _db = db;
            _config = config;
        }

        private static string Hash(string token) =>
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

        private static string NewToken() =>
            Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

        public string CreateAccessToken(Guid userId, string email, string role)
        {
            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));
            var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

            var claims = new[]
            {
                new Claim(JwtRegisteredClaimNames.Sub, email),
                new Claim("role", role),
                new Claim("uid", userId.ToString())
            };

            var token = new JwtSecurityToken(
                issuer: _config["Jwt:Issuer"],
                audience: _config["Jwt:Audience"],
                claims: claims,
                expires: DateTime.UtcNow.AddHours(12),
                signingCredentials: creds);

            return new JwtSecurityTokenHandler().WriteToken(token);
        }

        public async Task<string> IssueRefreshTokenAsync(Guid userId)
        {
            var token = NewToken();
            var now = DateTime.UtcNow;
            using var conn = _db.CreateConnection();
            await conn.ExecuteAsync(@"
                INSERT INTO dbo.RefreshTokens (RefreshTokenId, UserId, TokenHash, ExpiresAtUtc, AbsoluteExpiresAtUtc)
                VALUES (@Id, @UserId, @Hash, @Expires, @Absolute);",
                new
                {
                    Id = Guid.NewGuid(),
                    UserId = userId,
                    Hash = Hash(token),
                    Expires = now.AddDays(SlidingDays),
                    Absolute = now.AddDays(AbsoluteDays)
                });
            return token;
        }

        private sealed class TokenRow
        {
            public Guid RefreshTokenId { get; set; }
            public Guid UserId { get; set; }
            public DateTime ExpiresAtUtc { get; set; }
            public DateTime AbsoluteExpiresAtUtc { get; set; }
            public DateTime? RevokedAtUtc { get; set; }
        }

        private sealed class UserRow
        {
            public string Email { get; set; } = "";
            public string Role { get; set; } = "";
            public bool IsActive { get; set; }
            public string? OrganizationType { get; set; }
        }

        // Each refresh token is single-use. Presenting an already-used token revokes the whole chain,
        // which limits the damage if a token is stolen.
        public async Task<RefreshResult?> RotateAsync(string refreshToken)
        {
            if (string.IsNullOrWhiteSpace(refreshToken)) return null;

            using var conn = _db.CreateConnection();
            var row = await conn.QueryFirstOrDefaultAsync<TokenRow>(
                "SELECT RefreshTokenId, UserId, ExpiresAtUtc, AbsoluteExpiresAtUtc, RevokedAtUtc FROM dbo.RefreshTokens WHERE TokenHash = @Hash;",
                new { Hash = Hash(refreshToken.Trim()) });
            if (row == null) return null;

            if (row.RevokedAtUtc != null)
            {
                await RevokeAllForUserAsync(row.UserId);
                return null;
            }

            var now = DateTime.UtcNow;
            if (row.ExpiresAtUtc < now || row.AbsoluteExpiresAtUtc < now) return null;

            var user = await conn.QueryFirstOrDefaultAsync<UserRow>(@"
                SELECT au.Email, au.Role, au.IsActive, o.OrganizationType
                FROM dbo.AuthUsers au
                LEFT JOIN dbo.Users u ON u.Id = au.Id
                LEFT JOIN dbo.Organizations o ON o.OrganizationId = u.OrganizationId
                WHERE au.Id = @Id;", new { Id = row.UserId });
            if (user == null || !user.IsActive) return null;

            // Same sign-in rule as login
            var external = string.Equals(user.OrganizationType, "External", StringComparison.OrdinalIgnoreCase);
            var allowedExternal = string.Equals(user.Role, "SuperAdmin", StringComparison.OrdinalIgnoreCase) ||
                                  string.Equals(user.Role, "Coach", StringComparison.OrdinalIgnoreCase);
            if (external && !allowedExternal) return null;

            var newToken = NewToken();
            var newId = Guid.NewGuid();
            var newExpires = now.AddDays(SlidingDays);
            if (newExpires > row.AbsoluteExpiresAtUtc) newExpires = row.AbsoluteExpiresAtUtc;

            using var tx = conn.BeginTransaction();
            try
            {
                var claimed = await conn.ExecuteAsync(@"
                    UPDATE dbo.RefreshTokens
                    SET RevokedAtUtc = SYSUTCDATETIME(), ReplacedByTokenId = @NewId
                    WHERE RefreshTokenId = @Id AND RevokedAtUtc IS NULL;",
                    new { Id = row.RefreshTokenId, NewId = newId }, tx);
                if (claimed != 1)
                {
                    tx.Rollback();
                    return null;
                }

                await conn.ExecuteAsync(@"
                    INSERT INTO dbo.RefreshTokens (RefreshTokenId, UserId, TokenHash, ExpiresAtUtc, AbsoluteExpiresAtUtc)
                    VALUES (@Id, @UserId, @Hash, @Expires, @Absolute);",
                    new
                    {
                        Id = newId,
                        UserId = row.UserId,
                        Hash = Hash(newToken),
                        Expires = newExpires,
                        Absolute = row.AbsoluteExpiresAtUtc
                    }, tx);
                tx.Commit();
            }
            catch
            {
                tx.Rollback();
                throw;
            }

            return new RefreshResult
            {
                AccessToken = CreateAccessToken(row.UserId, user.Email, user.Role),
                RefreshToken = newToken,
                Role = user.Role,
                UserId = row.UserId
            };
        }

        public async Task RevokeAsync(string refreshToken)
        {
            if (string.IsNullOrWhiteSpace(refreshToken)) return;
            using var conn = _db.CreateConnection();
            await conn.ExecuteAsync(
                "UPDATE dbo.RefreshTokens SET RevokedAtUtc = SYSUTCDATETIME() WHERE TokenHash = @Hash AND RevokedAtUtc IS NULL;",
                new { Hash = Hash(refreshToken.Trim()) });
        }

        public async Task RevokeAllForUserAsync(Guid userId)
        {
            using var conn = _db.CreateConnection();
            await conn.ExecuteAsync(
                "UPDATE dbo.RefreshTokens SET RevokedAtUtc = SYSUTCDATETIME() WHERE UserId = @UserId AND RevokedAtUtc IS NULL;",
                new { UserId = userId });
        }

        public async Task<(string Token, string Email)?> CreatePasswordResetAsync(string email)
        {
            email = (email ?? "").Trim().ToLowerInvariant();
            using var conn = _db.CreateConnection();

            var user = await conn.QueryFirstOrDefaultAsync<(Guid Id, string Email)?>(
                "SELECT TOP 1 Id, Email FROM dbo.AuthUsers WHERE Email = @Email AND IsActive = 1;",
                new { Email = email });
            if (user == null) return null;

            var recent = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM dbo.PasswordResetTokens WHERE UserId = @Id AND CreatedAtUtc > DATEADD(HOUR, -1, SYSUTCDATETIME());",
                new { Id = user.Value.Id });
            if (recent >= MaxResetRequestsPerHour) return null;

            var token = NewToken();
            await conn.ExecuteAsync(@"
                INSERT INTO dbo.PasswordResetTokens (PasswordResetTokenId, UserId, TokenHash, ExpiresAtUtc)
                VALUES (@Id, @UserId, @Hash, @Expires);",
                new
                {
                    Id = Guid.NewGuid(),
                    UserId = user.Value.Id,
                    Hash = Hash(token),
                    Expires = DateTime.UtcNow.AddMinutes(ResetLifetimeMinutes)
                });

            return (token, user.Value.Email);
        }

        public async Task<bool> ResetPasswordAsync(string token, string newPassword)
        {
            if (string.IsNullOrWhiteSpace(token) || string.IsNullOrEmpty(newPassword) || newPassword.Length < MinPasswordLength)
                return false;

            using var conn = _db.CreateConnection();
            using var tx = conn.BeginTransaction();
            try
            {
                // Atomic single use
                var userId = await conn.QueryFirstOrDefaultAsync<Guid?>(@"
                    UPDATE dbo.PasswordResetTokens
                    SET UsedAtUtc = SYSUTCDATETIME()
                    OUTPUT inserted.UserId
                    WHERE TokenHash = @Hash AND UsedAtUtc IS NULL AND ExpiresAtUtc >= SYSUTCDATETIME();",
                    new { Hash = Hash(token.Trim()) }, tx);

                if (userId == null)
                {
                    tx.Rollback();
                    return false;
                }

                await conn.ExecuteAsync(
                    "UPDATE dbo.AuthUsers SET PasswordHash = @Hash WHERE Id = @Id;",
                    new { Hash = BCrypt.Net.BCrypt.HashPassword(newPassword), Id = userId.Value }, tx);

                // A password reset signs out every device
                await conn.ExecuteAsync(
                    "UPDATE dbo.RefreshTokens SET RevokedAtUtc = SYSUTCDATETIME() WHERE UserId = @Id AND RevokedAtUtc IS NULL;",
                    new { Id = userId.Value }, tx);

                tx.Commit();
                return true;
            }
            catch
            {
                tx.Rollback();
                throw;
            }
        }
    }
}
