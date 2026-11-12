using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.Services;
using Xunit;

namespace TipInAPI.Tests
{
    public class LineupTests : IDisposable
    {
        private readonly TestDatabase _db = new();
        private readonly LineupService _lineups;
        private readonly Guid _gameId;
        private readonly LineupActor _coach = new() { UserId = Guid.NewGuid(), Label = "coach:test", Verified = true };
        private readonly List<Guid> _players = new();

        public LineupTests()
        {
            _lineups = new LineupService(_db.Factory);
            _gameId = _db.AddGame(_db.HostTeamId, _db.OtherTeamId, 0, "Scheduled");
        }

        public void Dispose() => _db.Dispose();

        private void SetLevel(string name)
        {
            using var conn = _db.Factory.CreateConnection();
            conn.Execute("UPDATE Teams SET LevelId = (SELECT TOP 1 Id FROM Levels WHERE Name = @name) WHERE Id = @id",
                new { name, id = _db.HostTeamId });
        }

        // Adds players to the host roster; the first is a goalie
        private void BuildRoster(int count)
        {
            for (var i = 0; i < count; i++)
            {
                var id = _db.AddPlayer(_db.HostOrgId, "Zz" + i, "Test", i + 1, _db.HostTeamId);
                _players.Add(id);
            }
            using var conn = _db.Factory.CreateConnection();
            conn.Execute("UPDATE RosterEntries SET Position = 'G' WHERE TeamId = @t AND PlayerId = @p", new { t = _db.HostTeamId, p = _players[0] });
        }

        private Task<CoachRosterResult> Save(int expected, IEnumerable<Guid> participants, IEnumerable<Guid> starters) =>
            _lineups.SaveAsync(_gameId, _db.HostTeamId, _coach, new SaveLineupRequest
            {
                ExpectedVersion = expected, ParticipantIds = participants.ToList(), StarterIds = starters.ToList()
            });

        private Task<CoachRosterResult> SaveForTeam(Guid gameId, Guid teamId, int expected, IEnumerable<Guid> participants, IEnumerable<Guid> starters) =>
            _lineups.SaveAsync(gameId, teamId, _coach, new SaveLineupRequest
            {
                ExpectedVersion = expected, ParticipantIds = participants.ToList(), StarterIds = starters.ToList()
            });

        private Task<CoachRosterResult> Sign(int version) =>
            _lineups.SignAsync(_gameId, _db.HostTeamId, _coach, new SignLineupRequest { ExpectedVersion = version, SignerName = "Coach T" });

        private Task<CoachRosterResult> SignForTeam(Guid gameId, Guid teamId, int version) =>
            _lineups.SignAsync(gameId, teamId, _coach, new SignLineupRequest { ExpectedVersion = version, SignerName = "Coach T" });

        [Fact]
        public async Task ListGamesForTeam_ReturnsUpcomingGames_WithOpponentAndLockState()
        {
            using (var conn = _db.Factory.CreateConnection())
            {
                conn.Execute("UPDATE Games SET Status = 'Cancelled' WHERE HomeTeamId = @t AND AwayTeamId = @v",
                    new { t = _db.HostTeamId, v = _db.VisitorTeamId });
                conn.Execute(@"UPDATE Teams SET Name = 'Riverbend', TeamType = 'Boys',
                    LevelId = (SELECT Id FROM Levels WHERE Name = 'JV') WHERE Id = @id",
                    new { id = _db.OtherTeamId });
            }

            var games = (await _lineups.ListGamesForTeamAsync(_db.HostTeamId)).ToList();

            var mine = Assert.Single(games);
            Assert.Equal(_gameId, mine.GameId);
            Assert.True(mine.IsHome);
            Assert.True(mine.IsTipInManaged);
            Assert.False(mine.Locked);
            Assert.True(mine.NeedsLineup);
            Assert.False(string.IsNullOrEmpty(mine.OpponentName));
            Assert.Equal("JV", mine.OpponentLevelName);
            Assert.Equal("Boys", mine.OpponentTeamType);
            Assert.Equal("Riverbend JV - Boys", mine.OpponentDisplayName);
        }

        [Fact]
        public async Task Varsity_RequiresExactlySixStarters()
        {
            SetLevel("Varsity");
            BuildRoster(8);

            Assert.Equal(CoachRosterOutcome.Invalid, (await Save(0, _players, _players.Take(5))).Outcome);
            Assert.Equal(CoachRosterOutcome.Invalid, (await Save(0, _players, _players.Take(7))).Outcome);
            Assert.Equal(CoachRosterOutcome.Ok, (await Save(0, _players, _players.Take(6))).Outcome);
        }

        [Fact]
        public async Task Starters_MustIncludeGoalie_AndBeParticipants()
        {
            SetLevel("Varsity");
            BuildRoster(8);

            var noGoalie = await Save(0, _players, _players.Skip(1).Take(6));
            Assert.Equal(CoachRosterOutcome.Invalid, noGoalie.Outcome);
            Assert.Equal("Goalie selection required. Select a goalie as a starter.", noGoalie.Message);
            var inactiveStarter = await Save(0, _players.Take(5), _players.Take(6));
            Assert.Equal(CoachRosterOutcome.Invalid, inactiveStarter.Outcome);
            Assert.Equal("Every starter must be a participant.", inactiveStarter.Message);
            var tooFew = await Save(0, _players, _players.Take(5));
            Assert.Equal("Varsity lineups need exactly 6 starters.", tooFew.Message);
        }

        [Fact]
        public async Task GoalieFlag_IsExposedToCoachSite_AndAcceptedForStartingGoalie()
        {
            SetLevel("Varsity");
            BuildRoster(6);
            using (var conn = _db.Factory.CreateConnection())
                conn.Execute("UPDATE RosterEntries SET Position = NULL, IsGoalie = 1 WHERE TeamId = @t AND PlayerId = @p",
                    new { t = _db.HostTeamId, p = _players[0] });

            var roster = await new CoachRosterService(_db.Factory).GetRosterAsync(_db.HostTeamId);
            Assert.True(roster.Single(p => p.PlayerId == _players[0]).IsGoalie);
            Assert.Equal(CoachRosterOutcome.Ok, (await Save(0, _players, _players)).Outcome);
        }

        [Fact]
        public async Task Participants_MustBeOnActiveRoster()
        {
            SetLevel("Varsity");
            BuildRoster(7);
            var removed = _players[6];
            using (var conn = _db.Factory.CreateConnection())
                conn.Execute("UPDATE RosterEntries SET RemovedAtUtc = SYSUTCDATETIME() WHERE TeamId = @t AND PlayerId = @p", new { t = _db.HostTeamId, p = removed });

            Assert.Equal(CoachRosterOutcome.Invalid, (await Save(0, _players, _players.Take(6))).Outcome);
            Assert.Equal(CoachRosterOutcome.Ok, (await Save(0, _players.Take(6), _players.Take(6))).Outcome);
        }

        [Fact]
        public async Task StaleVersion_IsRejected()
        {
            SetLevel("Varsity");
            BuildRoster(7);

            Assert.Equal(CoachRosterOutcome.Ok, (await Save(0, _players, _players.Take(6))).Outcome);
            var stale = await Save(0, _players, _players.Take(6));
            Assert.Equal(CoachRosterOutcome.Warning, stale.Outcome);
            Assert.Equal(CoachRosterOutcome.Ok, (await Save(1, _players, _players.Take(6))).Outcome);
        }

        [Fact]
        public async Task Sign_LocksLineup_AndBlocksEdits()
        {
            SetLevel("Varsity");
            BuildRoster(7);
            await Save(0, _players, _players.Take(6));

            Assert.Equal(CoachRosterOutcome.Ok, (await Sign(1)).Outcome);

            var edit = await Save(1, _players, _players.Take(6));
            Assert.Equal(CoachRosterOutcome.Warning, edit.Outcome);
            Assert.Equal(CoachRosterOutcome.Warning, (await Sign(1)).Outcome);
            Assert.True(((LineupState)(await _lineups.GetAsync(_gameId, _db.HostTeamId)).Data!).Locked);
            Assert.False((await _lineups.ListGamesForTeamAsync(_db.HostTeamId)).Single(g => g.GameId == _gameId).NeedsLineup);
        }

        [Fact]
        public async Task Sign_WithStaleVersion_IsRejected()
        {
            SetLevel("Varsity");
            BuildRoster(7);
            await Save(0, _players, _players.Take(6));
            await Save(1, _players, _players.Take(6));

            Assert.Equal(CoachRosterOutcome.Warning, (await Sign(1)).Outcome);
            Assert.Equal(CoachRosterOutcome.Ok, (await Sign(2)).Outcome);
        }

        [Fact]
        public async Task Sign_RequiresSignerName_AndSavedLineup()
        {
            SetLevel("Varsity");
            BuildRoster(7);

            Assert.Equal(CoachRosterOutcome.Invalid, (await Sign(0)).Outcome);
            await Save(0, _players, _players.Take(6));
            var noName = await _lineups.SignAsync(_gameId, _db.HostTeamId, _coach, new SignLineupRequest { ExpectedVersion = 1, SignerName = " " });
            Assert.Equal(CoachRosterOutcome.Invalid, noName.Outcome);
        }

        [Fact]
        public async Task Unlock_RequiresReason_RecordsHistory_AndAllowsResign()
        {
            SetLevel("Varsity");
            BuildRoster(7);
            await Save(0, _players, _players.Take(6));
            await Sign(1);

            Assert.Equal(CoachRosterOutcome.Invalid, (await _lineups.UnlockAsync(_gameId, _db.HostTeamId, Guid.NewGuid(), " ")).Outcome);
            Assert.Equal(CoachRosterOutcome.Ok, (await _lineups.UnlockAsync(_gameId, _db.HostTeamId, Guid.NewGuid(), "Injury")).Outcome);

            Assert.Equal(CoachRosterOutcome.Ok, (await Save(1, _players, _players.Take(6).Reverse())).Outcome);
            Assert.Equal(CoachRosterOutcome.Ok, (await Sign(2)).Outcome);

            Assert.Equal(3, _db.Scalar<int>("SELECT COUNT(*) FROM GameLineupEvents WHERE GameId = @g", new { g = _gameId }));
        }

        [Fact]
        public async Task Unlock_WhenNotLocked_IsRejected()
        {
            SetLevel("Varsity");
            BuildRoster(7);
            await Save(0, _players, _players.Take(6));
            Assert.Equal(CoachRosterOutcome.Invalid, (await _lineups.UnlockAsync(_gameId, _db.HostTeamId, Guid.NewGuid(), "x")).Outcome);
        }

        [Fact]
        public async Task SignedSnapshot_IsNotAffectedByLaterRosterChanges()
        {
            SetLevel("Varsity");
            BuildRoster(7);
            await Save(0, _players, _players.Take(6));
            await Sign(1);

            using (var conn = _db.Factory.CreateConnection())
                conn.Execute("UPDATE RosterEntries SET JerseyNumber = 99 WHERE TeamId = @t AND PlayerId = @p", new { t = _db.HostTeamId, p = _players[0] });

            var snapshot = _db.Scalar<string>("SELECT SnapshotJson FROM GameLineupEvents WHERE GameId = @g AND EventType = 'Sign'", new { g = _gameId });
            Assert.DoesNotContain("\"JerseyNumber\":99", snapshot);
            Assert.Contains("\"JerseyNumber\":1", snapshot);
        }

        [Fact]
        public async Task LockedStarters_AreReportedForLegacyRoute_AndClearedOnUnlock()
        {
            SetLevel("Varsity");
            BuildRoster(7);
            await Save(0, _players, _players.Take(6));
            await Sign(1);

            var locked = await _lineups.GetLockedStartersAsync(_gameId);
            Assert.Equal(6, locked[_db.HostTeamId].Count);

            await _lineups.UnlockAsync(_gameId, _db.HostTeamId, Guid.NewGuid(), "fix");
            Assert.Empty(await _lineups.GetLockedStartersAsync(_gameId));
        }

        [Fact]
        public async Task TeamNotInGame_IsNotFound()
        {
            var result = await _lineups.GetAsync(_gameId, _db.VisitorTeamId);
            Assert.Equal(CoachRosterOutcome.NotFound, result.Outcome);
        }

        [Fact]
        public async Task ManagedHomeGame_RequiresLineupsForBothTeamsIncludingExternalVisitor()
        {
            var managedGame = _db.AddGame(_db.HostTeamId, _db.VisitorTeamId, 0, "Scheduled");
            var visitorGame = Assert.Single(await _lineups.ListGamesForTeamAsync(_db.VisitorTeamId),
                item => item.GameId == managedGame);
            Assert.False(visitorGame.IsHome);
            Assert.True(visitorGame.IsTipInManaged);
            Assert.True(visitorGame.NeedsLineup);
            Assert.Equal(CoachRosterOutcome.Ok, (await _lineups.GetAsync(managedGame, _db.VisitorTeamId)).Outcome);

            using (var conn = _db.Factory.CreateConnection())
            {
                conn.Execute("UPDATE Teams SET LevelId=(SELECT Id FROM Levels WHERE Name='JV') WHERE Id=@team",
                    new { team = _db.VisitorTeamId });
                conn.Execute("UPDATE RosterEntries SET Position='G' WHERE TeamId=@team AND PlayerId=@player",
                    new
                    {
                        team = _db.VisitorTeamId,
                        player = _db.AddPlayer(_db.VisitorOrgId, "Away", "Goalie", 1, _db.VisitorTeamId)
                    });
            }

            var goalie = _db.Scalar<Guid>("SELECT TOP 1 PlayerId FROM RosterEntries WHERE TeamId=@team",
                new { team = _db.VisitorTeamId });
            Assert.Equal(CoachRosterOutcome.Ok,
                (await SaveForTeam(managedGame, _db.VisitorTeamId, 0, new[] { goalie }, new[] { goalie })).Outcome);
            Assert.Equal(CoachRosterOutcome.Ok, (await SignForTeam(managedGame, _db.VisitorTeamId, 1)).Outcome);

            var lockedStarters = await _lineups.GetLockedStartersAsync(managedGame);
            Assert.Equal(new[] { goalie }, lockedStarters[_db.VisitorTeamId]);
        }

        [Fact]
        public async Task ExternalHomeGame_DoesNotRequireLineupsForEitherTeam()
        {
            var unmanagedGame = _db.AddGame(_db.VisitorTeamId, _db.HostTeamId, 0, "Scheduled");
            foreach (var teamId in new[] { _db.VisitorTeamId, _db.HostTeamId })
            {
                var game = Assert.Single(await _lineups.ListGamesForTeamAsync(teamId),
                    item => item.GameId == unmanagedGame);
                Assert.False(game.IsTipInManaged);
                Assert.False(game.NeedsLineup);
                Assert.Equal(CoachRosterOutcome.Forbidden, (await _lineups.GetAsync(unmanagedGame, teamId)).Outcome);
                Assert.Equal(CoachRosterOutcome.Forbidden,
                    (await _lineups.SaveAsync(unmanagedGame, teamId, _coach, new SaveLineupRequest())).Outcome);
                Assert.Equal(CoachRosterOutcome.Forbidden,
                    (await _lineups.SignAsync(unmanagedGame, teamId, _coach,
                        new SignLineupRequest { SignerName = "Coach T" })).Outcome);
                Assert.Equal(CoachRosterOutcome.Forbidden,
                    (await _lineups.UnlockAsync(unmanagedGame, teamId, Guid.NewGuid(), "test")).Outcome);
            }

            Assert.False(await _lineups.IsTipInManagedGameAsync(unmanagedGame));
            Assert.Empty(await _lineups.GetLockedStartersAsync(unmanagedGame));
        }

        [Fact]
        public async Task PreviouslySignedLineup_IsIgnoredIfItsTeamBecomesExternal()
        {
            SetLevel("Varsity");
            BuildRoster(7);
            await Save(0, _players, _players.Take(6));
            Assert.Equal(CoachRosterOutcome.Ok, (await Sign(1)).Outcome);
            Assert.Single(await _lineups.GetLockedStartersAsync(_gameId));

            using (var conn = _db.Factory.CreateConnection())
                conn.Execute("UPDATE Organizations SET OrganizationType='External' WHERE OrganizationId=@org; UPDATE Teams SET IsExternal=1 WHERE Id=@team;",
                    new { org = _db.HostOrgId, team = _db.HostTeamId });

            Assert.Empty(await _lineups.GetLockedStartersAsync(_gameId));
        }
    }
}
