using System;
using System.IO;
using System.Threading.Tasks;
using System.Transactions;
using Dapper;
using TipInAPI.Services;
using Xunit;

namespace TipInAPI.Tests
{
    public class CoachEmailAutomationSettingsTests
    {
        [Fact]
        public async Task Settings_PersistIndependently_AndMigrationDoesNotResetExistingChoices()
        {
            using var db = new TestDatabase();
            var script = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "CreateCoachReminderDeliveries.sql"));
            using (var conn = db.Factory.CreateConnection()) conn.Execute(script);
            var service = new CoachEmailAutomationSettingsService(db.Factory);
            var before = await service.GetAsync();
            // Ambient rollback keeps the shared non-production database's actual automation switches unchanged.
            using (var scope = new TransactionScope(TransactionScopeAsyncFlowOption.Enabled))
            {
                var expected = new CoachEmailAutomationSettings { AutomaticInvitations = true, LineupReminders = true };
                await service.SaveAsync(expected);
                Assert.Equal(expected, await service.GetAsync());
                using (var conn = db.Factory.CreateConnection()) conn.Execute(script);
                Assert.Equal(expected, await service.GetAsync());
                await service.SaveAsync(new());
                Assert.Equal(new CoachEmailAutomationSettings(), await service.GetAsync());
            }
            Assert.Equal(before, await service.GetAsync());
        }
    }
}
