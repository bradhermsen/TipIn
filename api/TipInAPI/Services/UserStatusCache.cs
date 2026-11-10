using System;
using System.Collections.Concurrent;
using Dapper;
using TipInAPI.Infrastructure.Database;

namespace TipInAPI.Services
{
    public interface IUserStatusCache
    {
        /// <summary>
        /// True when the user exists, is active, and still holds the role stored in the token.
        /// Fails closed if the lookup cannot be completed.
        /// </summary>
        bool IsTokenStillValid(Guid userId, string tokenRole);
    }

    /// <summary>
    /// Short-lived cache of AuthUsers state so disabled users and role changes
    /// take effect within the TTL instead of waiting for the JWT to expire.
    /// </summary>
    public class UserStatusCache : IUserStatusCache
    {
        private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(60);

        private sealed record Entry(bool Active, string? Role, DateTime FetchedUtc);

        private readonly ISqlConnectionFactory _db;
        private readonly ConcurrentDictionary<Guid, Entry> _cache = new();

        public UserStatusCache(ISqlConnectionFactory db)
        {
            _db = db;
        }

        public bool IsTokenStillValid(Guid userId, string tokenRole)
        {
            if (!_cache.TryGetValue(userId, out var entry) || DateTime.UtcNow - entry.FetchedUtc > Ttl)
            {
                try
                {
                    using var conn = _db.CreateConnection();
                    var row = conn.QueryFirstOrDefault<(bool IsActive, string Role)?>(
                        "SELECT TOP 1 IsActive, Role FROM dbo.AuthUsers WHERE Id = @Id",
                        new { Id = userId });

                    entry = row.HasValue
                        ? new Entry(row.Value.IsActive, row.Value.Role, DateTime.UtcNow)
                        : new Entry(false, null, DateTime.UtcNow);
                    _cache[userId] = entry;
                }
                catch
                {
                    return false;
                }
            }

            return entry.Active &&
                   string.Equals(entry.Role, tokenRole, StringComparison.OrdinalIgnoreCase);
        }
    }
}
