using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.Infrastructure.Database;

namespace TipInAPI.Services
{
    /// <summary>A delivery tracking entry; invitation sends can also satisfy a reminder stage.</summary>
    public sealed record CoachEmailLogEntry(
        Guid GameId, Guid TeamId, string Email, string ReminderType, string Status,
        DateTimeOffset ClaimedAtUtc, DateTimeOffset? SentAtUtc,
        string? TeamName, string? HomeTeamName, string? AwayTeamName, DateTime? GameDateTime);

    /// <summary>A page of automated email tracking entries for a Central calendar day.</summary>
    public sealed record CoachEmailLogResponse(
        string Date, int Page, bool HasMore, IReadOnlyList<CoachEmailLogEntry> Items);

    public interface ICoachEmailLogService
    {
        Task<CoachEmailLogResponse> GetAsync(DateOnly date, int page, CancellationToken cancellationToken);
    }

    public sealed class CoachEmailLogService : ICoachEmailLogService
    {
        private readonly ISqlConnectionFactory _db;
        public CoachEmailLogService(ISqlConnectionFactory db) { _db = db; }

        public async Task<CoachEmailLogResponse> GetAsync(DateOnly date, int page, CancellationToken cancellationToken)
        {
            if (page < 1 || page > 10000) throw new ArgumentOutOfRangeException(nameof(page));
            var start = TimeZoneInfo.ConvertTimeToUtc(date.ToDateTime(TimeOnly.MinValue), CoachReminderSchedule.Central);
            var end = TimeZoneInfo.ConvertTimeToUtc(date.AddDays(1).ToDateTime(TimeOnly.MinValue), CoachReminderSchedule.Central);
            using var conn = _db.CreateConnection();
            var rows = (await conn.QueryAsync<CoachEmailLogEntry>(new CommandDefinition(@"
                SELECT d.GameId,d.TeamId,d.Email,d.ReminderType,d.Status,
                    TODATETIMEOFFSET(d.ClaimedAtUtc,'+00:00') AS ClaimedAtUtc,
                    TODATETIMEOFFSET(d.SentAtUtc,'+00:00') AS SentAtUtc,
                    t.Name AS TeamName,h.Name AS HomeTeamName,a.Name AS AwayTeamName,g.GameDateTime
                FROM dbo.CoachReminderDeliveries d
                LEFT JOIN dbo.Teams t ON t.Id=d.TeamId
                LEFT JOIN dbo.Games g ON g.GameId=d.GameId
                LEFT JOIN dbo.Teams h ON h.Id=g.HomeTeamId
                LEFT JOIN dbo.Teams a ON a.Id=g.AwayTeamId
                WHERE COALESCE(d.SentAtUtc,d.ClaimedAtUtc)>=@start
                    AND COALESCE(d.SentAtUtc,d.ClaimedAtUtc)<@end
                ORDER BY COALESCE(d.SentAtUtc,d.ClaimedAtUtc) DESC,
                    d.GameId,d.TeamId,d.Email,d.ReminderType
                OFFSET @offset ROWS FETCH NEXT 101 ROWS ONLY;",
                new { start, end, offset = (page - 1) * 100 }, cancellationToken: cancellationToken))).ToList();
            return new(date.ToString("yyyy-MM-dd"), page, rows.Count > 100, rows.Take(100).ToArray());
        }
    }
}
