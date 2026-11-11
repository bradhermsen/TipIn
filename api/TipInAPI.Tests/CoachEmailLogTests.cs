using System;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.Services;
using Xunit;

namespace TipInAPI.Tests
{
    public class CoachEmailLogTests
    {
        [Theory]
        [InlineData(2080, 1, 15, 24)]
        [InlineData(2080, 3, 10, 23)]
        [InlineData(2080, 11, 3, 25)]
        public async Task Log_UsesCentralDayBoundaries_AndPreservesTrackingStatuses(int year, int month, int day, int hours)
        {
            using var db = new TestDatabase();
            var date = new DateOnly(year, month, day);
            var start = TimeZoneInfo.ConvertTimeToUtc(date.ToDateTime(TimeOnly.MinValue), CoachReminderSchedule.Central);
            var end = TimeZoneInfo.ConvertTimeToUtc(date.AddDays(1).ToDateTime(TimeOnly.MinValue), CoachReminderSchedule.Central);
            Assert.Equal(hours, (end - start).TotalHours);
            var game = db.AddGame(db.HostTeamId, db.VisitorTeamId, 0, "Scheduled");
            using var conn = db.Factory.CreateConnection();
            conn.Execute(@"
                INSERT INTO dbo.CoachReminderDeliveries(GameId,TeamId,Email,ReminderType,Status,ClaimedAtUtc,SentAtUtc)
                VALUES(@game,@team,@email,'RosterReview',@status,@claimed,@sent);",
                new[]
                {
                    new { game, team = db.HostTeamId, email = db.NewEmail("before"), status = "Sent", claimed = start.AddHours(-2), sent = (DateTime?)start.AddSeconds(-1) },
                    new { game, team = db.HostTeamId, email = db.NewEmail("start"), status = "Sent", claimed = start.AddHours(-1), sent = (DateTime?)start },
                    new { game, team = db.HostTeamId, email = db.NewEmail("sending"), status = "Sending", claimed = start.AddHours(1), sent = (DateTime?)null },
                    new { game, team = db.HostTeamId, email = db.NewEmail("review"), status = "NeedsReview", claimed = end.AddSeconds(-1), sent = (DateTime?)null },
                    new { game, team = db.HostTeamId, email = db.NewEmail("end"), status = "Sent", claimed = end, sent = (DateTime?)end }
                });
            var result = await new CoachEmailLogService(db.Factory).GetAsync(date, 1, default);
            Assert.False(result.HasMore);
            Assert.Equal(3, result.Items.Count);
            Assert.Equal(new[] { "NeedsReview", "Sending", "Sent" }, result.Items.Select(x => x.Status));
            Assert.All(result.Items, row =>
            {
                Assert.Equal(game, row.GameId);
                Assert.NotNull(row.TeamName);
                Assert.NotNull(row.HomeTeamName);
                Assert.NotNull(row.AwayTeamName);
                Assert.Equal(TimeSpan.Zero, row.ClaimedAtUtc.Offset);
            });
            Assert.Equal(new DateTimeOffset(start), result.Items[2].SentAtUtc);
        }

        [Fact]
        public async Task Log_PagesDeterministically_WithoutDroppingTrackingEntries()
        {
            using var db = new TestDatabase();
            var game = db.AddGame(db.HostTeamId, db.VisitorTeamId, 0, "Scheduled");
            var date = new DateOnly(2081, 1, 15);
            var claimed = date.ToDateTime(new TimeOnly(12, 0));
            using var conn = db.Factory.CreateConnection();
            conn.Execute(@"
                INSERT INTO dbo.CoachReminderDeliveries(GameId,TeamId,Email,ReminderType,Status,ClaimedAtUtc,SentAtUtc)
                VALUES(@game,@team,@email,'Invitation','Sent',@claimed,@claimed);",
                Enumerable.Range(0, 101).Select(i => new
                {
                    game, team = db.HostTeamId, email = db.NewEmail($"page-{i:D3}"), claimed
                }));
            var service = new CoachEmailLogService(db.Factory);
            var first = await service.GetAsync(date, 1, default);
            var second = await service.GetAsync(date, 2, default);
            Assert.Equal(100, first.Items.Count);
            Assert.True(first.HasMore);
            Assert.Single(second.Items);
            Assert.False(second.HasMore);
            Assert.Equal(101, first.Items.Concat(second.Items).Select(x => x.Email).Distinct().Count());
            Assert.Equal(first.Items, (await service.GetAsync(date, 1, default)).Items);
            Assert.Empty((await service.GetAsync(date, 3, default)).Items);
        }
    }
}
