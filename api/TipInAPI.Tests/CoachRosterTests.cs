using System;
using System.Linq;
using System.Threading.Tasks;
using TipInAPI.Services;
using Xunit;

namespace TipInAPI.Tests
{
    public class CoachRosterTests : IDisposable
    {
        private readonly TestDatabase _db = new();
        private readonly CoachRosterService _roster;
        private readonly Guid _actor = Guid.NewGuid();

        public CoachRosterTests()
        {
            _roster = new CoachRosterService(_db.Factory);
        }

        public void Dispose() => _db.Dispose();

        private static Guid EntryId(CoachRosterResult r)
        {
            var prop = r.Data!.GetType().GetProperty("rosterEntryId")!;
            return (Guid)prop.GetValue(r.Data)!;
        }

        private static Guid PlayerId(CoachRosterResult r)
        {
            var prop = r.Data!.GetType().GetProperty("playerId")!;
            return (Guid)prop.GetValue(r.Data)!;
        }

        private async Task<CoachRosterResult> AddNew(string first, string last, int? jersey, bool confirm = false, Guid? team = null) =>
            await _roster.AddPlayerAsync(_actor, team ?? _db.HostTeamId, new AddRosterPlayerRequest
            {
                FirstName = first, LastName = last, Grade = 10, JerseyNumber = jersey, Position = "F", Confirm = confirm
            });

        [Fact]
        public async Task InclusiveRoster_ReturnsRemovedAndInactivePlayers_WithoutChangingDefaultMemberships()
        {
            var active = await AddNew("Active", "Player", 1);
            var removed = await AddNew("Removed", "Player", 2);
            var inactive = await AddNew("Inactive", "Player", 3);
            await _roster.RemovePlayerAsync(_actor, _db.HostTeamId, EntryId(removed));
            using (var conn = _db.Factory.CreateConnection())
            {
                Dapper.SqlMapper.Execute(conn, "UPDATE Players SET IsActive=0 WHERE PlayerId=@id", new { id = PlayerId(inactive) });
                // Legacy game-day toggles must not turn a roster membership inactive.
                Dapper.SqlMapper.Execute(conn, "UPDATE RosterEntries SET IsActive=0 WHERE Id=@id", new { id = EntryId(active) });
            }
            Assert.Equal(2, (await _roster.GetRosterAsync(_db.HostTeamId)).Count());
            var all = (await _roster.GetRosterAsync(_db.HostTeamId, includeInactive: true)).ToList();
            Assert.Equal(3, all.Count);
            Assert.True(all.Single(p => p.RosterEntryId == EntryId(active)).IsRosterActive);
            Assert.False(all.Single(p => p.RosterEntryId == EntryId(removed)).IsRosterActive);
            Assert.False(all.Single(p => p.RosterEntryId == EntryId(inactive)).IsRosterActive);
            Assert.Empty(await _roster.GetRosterAsync(_db.OtherTeamId, includeInactive: true));
        }

        [Fact]
        public async Task AddNewPlayer_CreatesPlayerInTeamOrganization_AndRosterEntry()
        {
            var result = await AddNew("Ava", "Larsen", 12);

            Assert.Equal(CoachRosterOutcome.Ok, result.Outcome);
            var roster = (await _roster.GetRosterAsync(_db.HostTeamId)).ToList();
            var row = Assert.Single(roster);
            Assert.Equal(12, row.JerseyNumber);
            Assert.Equal(_db.HostOrgId, _db.Scalar<Guid>("SELECT OrganizationId FROM Players WHERE PlayerId = @id", new { id = row.PlayerId }));
            Assert.Equal(1, _db.Scalar<int>("SELECT COUNT(*) FROM RosterAuditLog WHERE TeamId = @t AND Action = 'AddPlayer'", new { t = _db.HostTeamId }));
        }

        [Theory]
        [InlineData("", "Larsen", 5, 10)]
        [InlineData("Ava", "", 5, 10)]
        [InlineData("Ava", "Larsen", 100, 10)]
        [InlineData("Ava", "Larsen", -1, 10)]
        public async Task AddPlayer_RejectsInvalidInput(string first, string last, int jersey, int grade)
        {
            var result = await _roster.AddPlayerAsync(_actor, _db.HostTeamId, new AddRosterPlayerRequest
            {
                FirstName = first, LastName = last, JerseyNumber = jersey, Grade = grade
            });
            Assert.Equal(CoachRosterOutcome.Invalid, result.Outcome);
            Assert.Empty(await _roster.GetRosterAsync(_db.HostTeamId));
        }

        [Fact]
        public async Task AddPlayer_RejectsInvalidGrade()
        {
            var result = await _roster.AddPlayerAsync(_actor, _db.HostTeamId, new AddRosterPlayerRequest
            {
                FirstName = "Ava", LastName = "Larsen", Grade = 13, JerseyNumber = 3
            });
            Assert.Equal(CoachRosterOutcome.Invalid, result.Outcome);
        }

        [Fact]
        public async Task AddPlayer_WarnsOnDuplicateName_UntilConfirmed()
        {
            _db.AddPlayer(_db.HostOrgId, "Ava", "Larsen", 7);

            var warned = await AddNew("  ava ", "LARSEN", 12);
            Assert.Equal(CoachRosterOutcome.Warning, warned.Outcome);
            Assert.Empty(await _roster.GetRosterAsync(_db.HostTeamId));

            var confirmed = await AddNew("ava", "larsen", 12, confirm: true);
            Assert.Equal(CoachRosterOutcome.Ok, confirmed.Outcome);
            Assert.Single(await _roster.GetRosterAsync(_db.HostTeamId));
            Assert.Equal(1, _db.Scalar<int>("SELECT COUNT(*) FROM RosterAuditLog WHERE TeamId = @t AND Action = 'ConfirmedWarning'", new { t = _db.HostTeamId }));
        }

        [Fact]
        public async Task DuplicateCheck_IsScopedToTheTeamsOrganization()
        {
            _db.AddPlayer(_db.OtherOrgId, "Ava", "Larsen", 7);

            var result = await AddNew("Ava", "Larsen", 12);
            Assert.Equal(CoachRosterOutcome.Ok, result.Outcome);
        }

        [Fact]
        public async Task AddPlayer_WarnsWhenJerseyAlreadyUsed_UntilConfirmed()
        {
            Assert.Equal(CoachRosterOutcome.Ok, (await AddNew("Ava", "Larsen", 12)).Outcome);

            Assert.Equal(CoachRosterOutcome.Warning, (await AddNew("Zoe", "Berg", 12)).Outcome);
            Assert.Equal(CoachRosterOutcome.Ok, (await AddNew("Zoe", "Berg", 12, confirm: true)).Outcome);
        }

        [Fact]
        public async Task AddExistingPlayer_UsesPerTeamJersey_WithoutChangingPlayerDefault()
        {
            var playerId = _db.AddPlayer(_db.HostOrgId, "Mia", "Holt", 9, onTeam: _db.HostTeamId);

            var result = await _roster.AddPlayerAsync(_actor, _db.HostTeam2Id,
                new AddRosterPlayerRequest { ExistingPlayerId = playerId, JerseyNumber = 22 });

            Assert.Equal(CoachRosterOutcome.Ok, result.Outcome);
            Assert.Equal(22, Assert.Single(await _roster.GetRosterAsync(_db.HostTeam2Id)).JerseyNumber);
            Assert.Equal(9, Assert.Single(await _roster.GetRosterAsync(_db.HostTeamId)).JerseyNumber);
            Assert.Equal(9, _db.Scalar<int>("SELECT JerseyNumber FROM Players WHERE PlayerId = @id", new { id = playerId }));
        }

        [Fact]
        public async Task AddExistingPlayer_FromAnotherOrganization_IsNotFound()
        {
            var foreign = _db.AddPlayer(_db.OtherOrgId, "Sam", "Reed", 4);

            var result = await _roster.AddPlayerAsync(_actor, _db.HostTeamId, new AddRosterPlayerRequest { ExistingPlayerId = foreign });

            Assert.Equal(CoachRosterOutcome.NotFound, result.Outcome);
            Assert.Empty(await _roster.GetRosterAsync(_db.HostTeamId));
        }

        [Fact]
        public async Task AddExistingPlayer_AlreadyOnRoster_IsRejected()
        {
            var playerId = _db.AddPlayer(_db.HostOrgId, "Mia", "Holt", 9, onTeam: _db.HostTeamId);

            var result = await _roster.AddPlayerAsync(_actor, _db.HostTeamId, new AddRosterPlayerRequest { ExistingPlayerId = playerId });

            Assert.Equal(CoachRosterOutcome.Invalid, result.Outcome);
        }

        [Fact]
        public async Task Update_NameAndGrade_ApplyToPlayer_JerseyAndPosition_StayPerTeam()
        {
            var playerId = _db.AddPlayer(_db.HostOrgId, "Mia", "Holt", 9, onTeam: _db.HostTeamId);
            await _roster.AddPlayerAsync(_actor, _db.HostTeam2Id, new AddRosterPlayerRequest { ExistingPlayerId = playerId, JerseyNumber = 9 });
            var entry = (await _roster.GetRosterAsync(_db.HostTeamId)).Single();

            var result = await _roster.UpdatePlayerAsync(_actor, _db.HostTeamId, entry.RosterEntryId,
                new UpdateRosterPlayerRequest { FirstName = "Maia", Grade = 11, JerseyNumber = 31, Position = "D" });

            Assert.Equal(CoachRosterOutcome.Ok, result.Outcome);
            var team1 = (await _roster.GetRosterAsync(_db.HostTeamId)).Single();
            var team2 = (await _roster.GetRosterAsync(_db.HostTeam2Id)).Single();
            Assert.Equal("Maia", team1.FirstName);
            Assert.Equal("Maia", team2.FirstName);
            Assert.Equal(11, team2.Grade);
            Assert.Equal(31, team1.JerseyNumber);
            Assert.Equal(9, team2.JerseyNumber);
            Assert.Equal("D", team1.Position);
            Assert.NotEqual("D", team2.Position);
            Assert.Equal(9, _db.Scalar<int>("SELECT JerseyNumber FROM Players WHERE PlayerId = @id", new { id = playerId }));

            Assert.Equal(1, _db.Scalar<int>("SELECT COUNT(*) FROM RosterAuditLog WHERE PlayerId = @id AND Action = 'UpdateName' AND OldValue = 'Mia Holt' AND NewValue = 'Maia Holt'", new { id = playerId }));
            Assert.Equal(1, _db.Scalar<int>("SELECT COUNT(*) FROM RosterAuditLog WHERE PlayerId = @id AND Action = 'UpdateJersey' AND OldValue = '9' AND NewValue = '31'", new { id = playerId }));
        }

        [Fact]
        public async Task Update_WithNoChanges_WritesNoAuditRows()
        {
            _db.AddPlayer(_db.HostOrgId, "Mia", "Holt", 9, onTeam: _db.HostTeamId);
            var entry = (await _roster.GetRosterAsync(_db.HostTeamId)).Single();

            await _roster.UpdatePlayerAsync(_actor, _db.HostTeamId, entry.RosterEntryId, new UpdateRosterPlayerRequest());

            Assert.Equal(0, _db.Scalar<int>("SELECT COUNT(*) FROM RosterAuditLog WHERE TeamId = @t", new { t = _db.HostTeamId }));
        }

        [Fact]
        public async Task Update_JerseyAlreadyUsed_Warns_UntilConfirmed()
        {
            _db.AddPlayer(_db.HostOrgId, "Mia", "Holt", 9, onTeam: _db.HostTeamId);
            _db.AddPlayer(_db.HostOrgId, "Zoe", "Berg", 10, onTeam: _db.HostTeamId);
            var zoe = (await _roster.GetRosterAsync(_db.HostTeamId)).Single(r => r.FirstName == "Zoe");

            var warned = await _roster.UpdatePlayerAsync(_actor, _db.HostTeamId, zoe.RosterEntryId, new UpdateRosterPlayerRequest { JerseyNumber = 9 });
            Assert.Equal(CoachRosterOutcome.Warning, warned.Outcome);

            var ok = await _roster.UpdatePlayerAsync(_actor, _db.HostTeamId, zoe.RosterEntryId, new UpdateRosterPlayerRequest { JerseyNumber = 9, Confirm = true });
            Assert.Equal(CoachRosterOutcome.Ok, ok.Outcome);
        }

        [Fact]
        public async Task Update_EntryFromAnotherTeam_IsNotFound()
        {
            _db.AddPlayer(_db.HostOrgId, "Mia", "Holt", 9, onTeam: _db.HostTeamId);
            var entry = (await _roster.GetRosterAsync(_db.HostTeamId)).Single();

            var result = await _roster.UpdatePlayerAsync(_actor, _db.HostTeam2Id, entry.RosterEntryId, new UpdateRosterPlayerRequest { FirstName = "Hacked" });

            Assert.Equal(CoachRosterOutcome.NotFound, result.Outcome);
            Assert.Equal("Mia", (await _roster.GetRosterAsync(_db.HostTeamId)).Single().FirstName);
        }

        [Fact]
        public async Task Remove_HidesPlayerOnThisTeamOnly_AndKeepsPlayer()
        {
            var playerId = _db.AddPlayer(_db.HostOrgId, "Mia", "Holt", 9, onTeam: _db.HostTeamId);
            await _roster.AddPlayerAsync(_actor, _db.HostTeam2Id, new AddRosterPlayerRequest { ExistingPlayerId = playerId, JerseyNumber = 9 });
            var entry = (await _roster.GetRosterAsync(_db.HostTeamId)).Single();

            var result = await _roster.RemovePlayerAsync(_actor, _db.HostTeamId, entry.RosterEntryId);

            Assert.Equal(CoachRosterOutcome.Ok, result.Outcome);
            Assert.Empty(await _roster.GetRosterAsync(_db.HostTeamId));
            Assert.Single(await _roster.GetRosterAsync(_db.HostTeam2Id));
            Assert.Equal(1, _db.Scalar<int>("SELECT COUNT(*) FROM Players WHERE PlayerId = @id", new { id = playerId }));
            Assert.Equal(1, _db.Scalar<int>("SELECT COUNT(*) FROM RosterAuditLog WHERE RosterEntryId = @id AND Action = 'RemovePlayer'", new { id = entry.RosterEntryId }));
        }

        [Fact]
        public async Task Remove_Twice_SecondIsNotFound()
        {
            _db.AddPlayer(_db.HostOrgId, "Mia", "Holt", 9, onTeam: _db.HostTeamId);
            var entry = (await _roster.GetRosterAsync(_db.HostTeamId)).Single();

            await _roster.RemovePlayerAsync(_actor, _db.HostTeamId, entry.RosterEntryId);
            var second = await _roster.RemovePlayerAsync(_actor, _db.HostTeamId, entry.RosterEntryId);

            Assert.Equal(CoachRosterOutcome.NotFound, second.Outcome);
        }

        [Fact]
        public async Task Remove_EntryFromAnotherTeam_IsNotFound_AndNotRemoved()
        {
            _db.AddPlayer(_db.HostOrgId, "Mia", "Holt", 9, onTeam: _db.HostTeamId);
            var entry = (await _roster.GetRosterAsync(_db.HostTeamId)).Single();

            var result = await _roster.RemovePlayerAsync(_actor, _db.HostTeam2Id, entry.RosterEntryId);

            Assert.Equal(CoachRosterOutcome.NotFound, result.Outcome);
            Assert.Single(await _roster.GetRosterAsync(_db.HostTeamId));
        }

        [Fact]
        public async Task ReAddingRemovedPlayer_RestoresEntry_InsteadOfDuplicating()
        {
            var playerId = _db.AddPlayer(_db.HostOrgId, "Mia", "Holt", 9, onTeam: _db.HostTeamId);
            var entry = (await _roster.GetRosterAsync(_db.HostTeamId)).Single();
            await _roster.RemovePlayerAsync(_actor, _db.HostTeamId, entry.RosterEntryId);

            var result = await _roster.AddPlayerAsync(_actor, _db.HostTeamId, new AddRosterPlayerRequest { ExistingPlayerId = playerId, JerseyNumber = 14 });

            Assert.Equal(CoachRosterOutcome.Ok, result.Outcome);
            var restored = Assert.Single(await _roster.GetRosterAsync(_db.HostTeamId));
            Assert.Equal(entry.RosterEntryId, restored.RosterEntryId);
            Assert.Equal(14, restored.JerseyNumber);
            Assert.Equal(1, _db.Scalar<int>("SELECT COUNT(*) FROM RosterEntries WHERE TeamId = @t AND PlayerId = @p", new { t = _db.HostTeamId, p = playerId }));
        }

        [Fact]
        public async Task Search_ReturnsOnlySameOrganizationPlayers_AndRequiresTwoCharacters()
        {
            _db.AddPlayer(_db.HostOrgId, "Mia", "Holt", 9);
            _db.AddPlayer(_db.OtherOrgId, "Mia", "Holtz", 3);

            var tooShort = await _roster.SearchPlayersAsync(_db.HostTeamId, "M");
            Assert.Equal(CoachRosterOutcome.Invalid, tooShort.Outcome);

            var result = await _roster.SearchPlayersAsync(_db.HostTeamId, "holt");
            var matches = ((System.Collections.Generic.IEnumerable<PlayerSearchMatch>)result.Data!).ToList();
            Assert.Single(matches);
            Assert.Equal("Holt", matches[0].LastName);
        }

        [Fact]
        public async Task Search_TreatsWildcardCharactersLiterally()
        {
            _db.AddPlayer(_db.HostOrgId, "Mia", "Holt", 9);

            var result = await _roster.SearchPlayersAsync(_db.HostTeamId, "%%");
            Assert.Empty((System.Collections.Generic.IEnumerable<PlayerSearchMatch>)result.Data!);
        }

        [Fact]
        public async Task RemovedPlayers_AreHiddenFromPublicRosterCountQueries()
        {
            _db.AddPlayer(_db.HostOrgId, "Mia", "Holt", 9, onTeam: _db.HostTeamId);
            var entry = (await _roster.GetRosterAsync(_db.HostTeamId)).Single();
            await _roster.RemovePlayerAsync(_actor, _db.HostTeamId, entry.RosterEntryId);

            // The team RosterCount subquery used by the admin portal excludes removed entries
            var count = _db.Scalar<int>(
                "SELECT (SELECT COUNT(*) FROM RosterEntries r WHERE r.TeamId = t.Id AND r.RemovedAtUtc IS NULL) FROM Teams t WHERE t.Id = @t",
                new { t = _db.HostTeamId });
            Assert.Equal(0, count);
        }
    }
}
