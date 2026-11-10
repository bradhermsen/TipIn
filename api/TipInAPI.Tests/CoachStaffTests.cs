using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.DTOs;
using TipInAPI.Services;
using Xunit;

namespace TipInAPI.Tests
{
    public class CoachStaffTests : IDisposable
    {
        private readonly TestDatabase _db = new();
        public void Dispose() => _db.Dispose();

        [Fact]
        public async Task Staff_UsesAdminHeadCoach_AndEditsFourAssistantsWithoutAccountChanges()
        {
            using (var conn = _db.Factory.CreateConnection())
                conn.Execute("UPDATE Teams SET HeadCoachName = 'Admin Head', HeadCoachEmail = 'head@example.test' WHERE Id = @id", new { id = _db.HostTeamId });
            var service = new CoachRosterService(_db.Factory);
            var coach = _db.AddCoach(_db.HostTeamId);
            var accountCount = _db.Scalar<int>("SELECT COUNT(*) FROM CoachTeams WHERE TeamId = @id", new { id = _db.HostTeamId });
            for (var slot = 1; slot <= 4; slot++)
                Assert.Equal(CoachRosterOutcome.Ok, (await service.UpdateAssistantAsync(_db.HostTeamId, slot,
                    new UpdateAssistantRequest { Name = $"Assistant {slot}" })).Outcome);
            var staff = (IEnumerable<CoachStaffDto>)(await service.GetStaffAsync(_db.HostTeamId)).Data!;
            Assert.Equal(5, staff.Count());
            Assert.Equal("Admin Head", staff.Single(s => s.Slot == 0).Name);
            Assert.All(staff.Where(s => s.Slot > 0), s => { Assert.Equal("Assistant Coach", s.Title); Assert.Null(s.Email); });
            Assert.Equal(CoachRosterOutcome.Ok, (await service.UpdateAssistantAsync(_db.HostTeamId, 1,
                new UpdateAssistantRequest { Name = "Updated", ExpectedName = "Assistant 1", Email = "optional@example.test" })).Outcome);
            Assert.Equal(CoachRosterOutcome.Ok, (await service.UpdateAssistantAsync(_db.HostTeamId, 1,
                new UpdateAssistantRequest { ExpectedName = "Updated", ExpectedEmail = "optional@example.test" })).Outcome);
            Assert.Equal(accountCount, _db.Scalar<int>("SELECT COUNT(*) FROM CoachTeams WHERE TeamId = @id", new { id = _db.HostTeamId }));
            Assert.Equal(1, _db.Scalar<int>("SELECT COUNT(*) FROM AuthUsers WHERE Id = @coach", new { coach }));
            Assert.Equal("Admin Head", _db.Scalar<string>("SELECT HeadCoachName FROM Teams WHERE Id = @id", new { id = _db.HostTeamId }));
        }

        [Fact]
        public async Task Staff_RejectsHeadSlot_OutOfRange_StaleUpdates_AndInvalidEmail()
        {
            var service = new CoachRosterService(_db.Factory);
            foreach (var slot in new[] { -1, 0, 5 })
                Assert.Equal(CoachRosterOutcome.Invalid, (await service.UpdateAssistantAsync(_db.HostTeamId, slot, new UpdateAssistantRequest { Name = "No" })).Outcome);
            Assert.Equal(CoachRosterOutcome.Invalid, (await service.UpdateAssistantAsync(_db.HostTeamId, 1,
                new UpdateAssistantRequest { Name = "Test", Email = "not-an-email" })).Outcome);
            Assert.Equal(CoachRosterOutcome.Ok, (await service.UpdateAssistantAsync(_db.HostTeamId, 1,
                new UpdateAssistantRequest { Name = "Current" })).Outcome);
            Assert.Equal(CoachRosterOutcome.Warning, (await service.UpdateAssistantAsync(_db.HostTeamId, 1,
                new UpdateAssistantRequest { Name = "Stale edit" })).Outcome);
            Assert.Equal("Current", _db.Scalar<string>("SELECT AssistantCoach1Name FROM Teams WHERE Id = @id", new { id = _db.HostTeamId }));
            Assert.Equal(CoachRosterOutcome.NotFound, (await service.GetStaffAsync(Guid.NewGuid())).Outcome);
        }
    }
}
