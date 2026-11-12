using System;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.Services;
using Xunit;

namespace TipInAPI.Tests
{
    public class CoachGameManagerAccessTests
    {
        [Theory]
        [InlineData("head", "GM-ABC123", "GM-ABC123")]
        [InlineData("head", "abc123", "GM-ABC123")]
        [InlineData("head", null, null)]
        [InlineData("assistant", "GM-ABC123", null)]
        [InlineData("away", "GM-ABC123", null)]
        [InlineData("external", "GM-ABC123", null)]
        [InlineData("team-external", "GM-ABC123", null)]
        [InlineData("disabled", "GM-ABC123", null)]
        [InlineData("removed", "GM-ABC123", null)]
        [InlineData("viewer", "GM-ABC123", null)]
        [InlineData("different-game", "GM-ABC123", null)]
        [InlineData("admin-head", "GM-ABC123", "GM-ABC123")]
        [InlineData("admin-not-head", "GM-ABC123", null)]
        public async Task Code_RequiresHomeManagedGame_AndActiveAuthorizedAdminListedHead(string scenario, string? stored, string? expected)
        {
            using var db = new TestDatabase();
            using var conn = db.Factory.CreateConnection();
            var coach = scenario.StartsWith("admin") ? db.HostAdminId : db.AddCoach(db.HostTeamId);
            var email = db.Scalar<string>("SELECT Email FROM dbo.AuthUsers WHERE Id=@coach", new { coach });
            var game = db.AddGame(db.HostTeamId, db.VisitorTeamId, 0, "Scheduled");
            conn.Execute("UPDATE dbo.Teams SET HeadCoachEmail=@email,ScorekeeperCode=@stored WHERE Id=@team",
                new { email, stored, team = db.HostTeamId });
            if (scenario == "assistant" || scenario == "admin-not-head")
                conn.Execute("UPDATE dbo.Teams SET HeadCoachEmail=@other WHERE Id=@t", new { other = db.NewEmail("actualhead"), t = db.HostTeamId });
            if (scenario == "disabled") conn.Execute("UPDATE dbo.AuthUsers SET IsActive=0 WHERE Id=@coach", new { coach });
            if (scenario == "removed") conn.Execute("DELETE FROM dbo.CoachTeams WHERE UserId=@coach", new { coach });
            if (scenario == "viewer") conn.Execute("UPDATE dbo.AuthUsers SET Role='Viewer' WHERE Id=@coach", new { coach });
            if (scenario == "external") conn.Execute("UPDATE dbo.Organizations SET OrganizationType='External' WHERE OrganizationId=@o", new { o = db.HostOrgId });
            if (scenario == "team-external") conn.Execute("UPDATE dbo.Teams SET IsExternal=1 WHERE Id=@t", new { t = db.HostTeamId });
            var response = await new LineupService(db.Factory).GetGameManagerAccessAsync(
                scenario == "different-game" ? Guid.NewGuid() : game,
                scenario == "away" ? db.VisitorTeamId : db.HostTeamId, coach);
            Assert.Equal(expected, response.Code);
        }

        [Fact]
        public async Task InvalidStoredCode_ProducesAnExplicitError_NotAnInventedCredential()
        {
            using var db = new TestDatabase();
            var coach = db.AddCoach(db.HostTeamId);
            using var conn = db.Factory.CreateConnection();
            conn.Execute(@"UPDATE dbo.Teams SET ScorekeeperCode='bad',
                HeadCoachEmail=(SELECT Email FROM dbo.AuthUsers WHERE Id=@coach) WHERE Id=@t", new { coach, t = db.HostTeamId });
            var game = db.AddGame(db.HostTeamId, db.VisitorTeamId, 0, "Scheduled");
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                new LineupService(db.Factory).GetGameManagerAccessAsync(game, db.HostTeamId, coach));
        }
    }
}
