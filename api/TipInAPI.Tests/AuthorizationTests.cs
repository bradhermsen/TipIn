using System;
using System.Threading.Tasks;
using TipInAPI.Repositories;
using TipInAPI.Services;
using Xunit;

namespace TipInAPI.Tests
{
    public class AuthorizationTests : IDisposable
    {
        private readonly TestDatabase _db = new();
        private readonly TeamAuthorizationService _auth;
        private readonly CoachTeamsService _coachTeams;

        public AuthorizationTests()
        {
            _auth = new TeamAuthorizationService(_db.Factory);
            _coachTeams = new CoachTeamsService(new CoachTeamsRepository(_db.Factory));
        }

        public void Dispose() => _db.Dispose();

        [Fact]
        public async Task SuperAdmin_CanAccessAnyTeam()
        {
            Assert.True(await _auth.CanAdminAccessTeamAsync(Guid.NewGuid(), "SuperAdmin", _db.OtherTeamId));
            Assert.True(await _auth.CanAdminAccessTeamAsync(Guid.NewGuid(), "SuperAdmin", _db.VisitorTeamId));
        }

        [Fact]
        public async Task OrgAdmin_CanAccessOwnOrganizationTeams_Only()
        {
            Assert.True(await _auth.CanAdminAccessTeamAsync(_db.HostAdminId, "OrgAdmin", _db.HostTeamId));
            Assert.False(await _auth.CanAdminAccessTeamAsync(_db.HostAdminId, "OrgAdmin", _db.OtherTeamId));
            Assert.False(await _auth.CanAdminAccessTeamAsync(_db.HostAdminId, "OrgAdmin", _db.VisitorTeamId));
        }

        [Fact]
        public async Task OrgAdmin_WithoutOrganization_IsDenied()
        {
            Assert.False(await _auth.CanAdminAccessTeamAsync(_db.NoOrgAdminId, "OrgAdmin", _db.HostTeamId));
            Assert.False(await _auth.CanAdminInviteToTeamAsync(_db.NoOrgAdminId, "OrgAdmin", _db.VisitorTeamId));
        }

        [Theory]
        [InlineData("Coach")]
        [InlineData("TeamManager")]
        [InlineData("Viewer")]
        [InlineData("")]
        public async Task NonAdminRoles_AreDeniedAdminAccess(string role)
        {
            Assert.False(await _auth.CanAdminAccessTeamAsync(_db.HostAdminId, role, _db.HostTeamId));
            Assert.False(await _auth.CanAdminInviteToTeamAsync(_db.HostAdminId, role, _db.HostTeamId));
        }

        [Fact]
        public async Task OrgAdmin_CanInviteVisitingTeam_WithGameInsideWindow()
        {
            Assert.True(await _auth.CanAdminInviteToTeamAsync(_db.HostAdminId, "OrgAdmin", _db.VisitorTeamId));
        }

        [Fact]
        public async Task OrgAdmin_CannotInviteVisitingTeam_WhenGameIsOutsideWindow()
        {
            Assert.False(await _auth.CanAdminInviteToTeamAsync(_db.HostAdminId, "OrgAdmin", _db.FarVisitorTeamId));
        }

        [Fact]
        public async Task OrgAdmin_CanInviteVisitingTeam_ForRecentGame()
        {
            _db.AddGame(_db.VisitorTeamId, _db.HostTeam2Id, -10, "Final");
            // Window is symmetrical; a past game within 30 days also counts
            Assert.True(await _auth.CanAdminInviteToTeamAsync(_db.HostAdminId, "OrgAdmin", _db.VisitorTeamId));
        }

        [Fact]
        public async Task OrgAdmin_CannotInviteVisitingTeam_WhenOnlyGameIsCancelled()
        {
            _db.AddGame(_db.HostTeamId, _db.OtherTeamId, 0, "Scheduled");
            using var conn = _db.Factory.CreateConnection();
            Dapper.SqlMapper.Execute(conn, "UPDATE Games SET Status = 'Cancelled' WHERE HomeTeamId = @t AND AwayTeamId = @v",
                new { t = _db.HostTeamId, v = _db.VisitorTeamId });

            Assert.False(await _auth.CanAdminInviteToTeamAsync(_db.HostAdminId, "OrgAdmin", _db.VisitorTeamId));
        }

        [Fact]
        public async Task OrgAdmin_CannotInviteInternalTeamOfAnotherOrganization_EvenWithGame()
        {
            _db.AddGame(_db.HostTeamId, _db.OtherTeamId, 3, "Scheduled");
            Assert.False(await _auth.CanAdminInviteToTeamAsync(_db.HostAdminId, "OrgAdmin", _db.OtherTeamId));
        }

        [Fact]
        public async Task SuperAdmin_CanInviteToAnyTeam()
        {
            Assert.True(await _auth.CanAdminInviteToTeamAsync(Guid.NewGuid(), "SuperAdmin", _db.FarVisitorTeamId));
        }

        [Fact]
        public async Task Coach_IsAssigned_OnlyToTheirOwnTeams()
        {
            var coachId = _db.AddCoach(_db.VisitorTeamId);

            Assert.True(await _auth.IsUserAssignedToTeamAsync(coachId, _db.VisitorTeamId, _coachTeams));
            Assert.False(await _auth.IsUserAssignedToTeamAsync(coachId, _db.HostTeamId, _coachTeams));
            Assert.Contains(_db.VisitorTeamId, await _auth.GetAssignedTeamIdsAsync(coachId, _coachTeams));
            Assert.DoesNotContain(_db.HostTeamId, await _auth.GetAssignedTeamIdsAsync(coachId, _coachTeams));
        }

        [Fact]
        public async Task OrgAdmin_CanAccessUsersInOwnOrganization_Only()
        {
            Assert.True(await _auth.CanAdminAccessUserAsync(_db.HostAdminId, "OrgAdmin", _db.HostAdminId));
            Assert.False(await _auth.CanAdminAccessUserAsync(_db.HostAdminId, "OrgAdmin", _db.NoOrgAdminId));
            Assert.False(await _auth.CanAdminAccessUserAsync(_db.NoOrgAdminId, "OrgAdmin", _db.HostAdminId));
            Assert.True(await _auth.CanAdminAccessUserAsync(Guid.NewGuid(), "SuperAdmin", _db.HostAdminId));
        }
    }
}
