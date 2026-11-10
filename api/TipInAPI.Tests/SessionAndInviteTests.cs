using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using Microsoft.Extensions.Configuration;
using TipInAPI.Functions;
using TipInAPI.Repositories;
using TipInAPI.Services;
using Xunit;

namespace TipInAPI.Tests
{
    public class SessionAndInviteTests : IDisposable
    {
        private const string Password = "correct-horse-battery";
        private readonly TestDatabase _db = new();
        private readonly SessionService _sessions;
        private readonly CoachInvitationService _invites;

        public SessionAndInviteTests()
        {
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "test-key-that-is-long-enough-for-hmac-sha256-signing",
                ["Jwt:Issuer"] = "test",
                ["Jwt:Audience"] = "test"
            }).Build();
            _sessions = new SessionService(_db.Factory, config);
            _invites = new CoachInvitationService(_db.Factory);
        }

        public void Dispose() => _db.Dispose();

        private async Task<(Guid UserId, string Email)> AcceptNewCoach()
        {
            var email = _db.NewEmail("coach");
            var invite = await _invites.CreateAsync(_db.HostAdminId, _db.HostTeamId, email);
            var result = await _invites.AcceptAsync(invite.Token, email, Password, "Cora", "Coach");
            Assert.Equal(AcceptInviteStatus.Accepted, result.Status);
            var id = _db.Scalar<Guid>("SELECT Id FROM AuthUsers WHERE Email = @email", new { email });
            return (id, email);
        }

        [Fact]
        public async Task TeamLabels_IncludeLevelAndType_ForInvitesAndCoachTeams()
        {
            using (var conn = _db.Factory.CreateConnection())
            {
                Assert.Equal(1, conn.Execute(@"
                    UPDATE Teams SET Name = 'Riverbend', TeamType = 'Boys',
                        LevelId = (SELECT Id FROM Levels WHERE Name = 'JV')
                    WHERE Id = @id", new { id = _db.HostTeamId }));
                Assert.Equal(1, conn.Execute(@"
                    UPDATE Teams SET Name = 'Riverbend', TeamType = 'Girls',
                        LevelId = (SELECT Id FROM Levels WHERE Name = 'Varsity')
                    WHERE Id = @id", new { id = _db.HostTeam2Id }));
            }

            var email = _db.NewEmail("labels");
            var first = await _invites.CreateAsync(_db.HostAdminId, _db.HostTeamId, email);
            var second = await _invites.CreateAsync(_db.HostAdminId, _db.HostTeam2Id, email);
            Assert.Equal("Riverbend", first.TeamName);
            Assert.Equal("Riverbend JV - Boys", first.TeamDisplayName);
            Assert.Equal("Riverbend Varsity - Girls", second.TeamDisplayName);
            Assert.Equal(AcceptInviteStatus.Accepted,
                (await _invites.AcceptAsync(first.Token, email, Password, "Cora", "Coach")).Status);
            Assert.Equal(AcceptInviteStatus.Accepted,
                (await _invites.AcceptAsync(second.Token, email, Password, null, null)).Status);

            var userId = _db.Scalar<Guid>("SELECT Id FROM AuthUsers WHERE Email = @email", new { email });
            var teams = (await new CoachTeamsRepository(_db.Factory).GetTeamsForCoachAsync(userId)).ToList();
            Assert.Equal(2, teams.Count);
            Assert.Equal("Riverbend JV - Boys", teams.Single(t => t.TeamId == _db.HostTeamId).TeamDisplayName);
            Assert.Equal("Riverbend Varsity - Girls", teams.Single(t => t.TeamId == _db.HostTeam2Id).TeamDisplayName);
        }

        [Fact]
        public async Task Invite_CreatesCoachAccount_AssignedToTeam_AndIsSingleUse()
        {
            var email = _db.NewEmail("new");
            var invite = await _invites.CreateAsync(_db.HostAdminId, _db.HostTeamId, email);

            var first = await _invites.AcceptAsync(invite.Token, email, Password, "Cora", "Coach");
            Assert.Equal(AcceptInviteStatus.Accepted, first.Status);
            Assert.True(first.CreatedAccount);
            Assert.Equal("Coach", _db.Scalar<string>("SELECT Role FROM AuthUsers WHERE Email = @email", new { email }));
            Assert.Equal(1, _db.Scalar<int>(
                "SELECT COUNT(*) FROM CoachTeams ct JOIN AuthUsers a ON a.Id = ct.UserId WHERE a.Email = @email AND ct.TeamId = @t",
                new { email, t = _db.HostTeamId }));

            var second = await _invites.AcceptAsync(invite.Token, email, Password, "Cora", "Coach");
            Assert.Equal(AcceptInviteStatus.Used, second.Status);
        }

        [Fact]
        public async Task Invite_RejectsWrongEmail_WeakPassword_MissingName_AndBadToken()
        {
            var email = _db.NewEmail("x");
            var invite = await _invites.CreateAsync(_db.HostAdminId, _db.HostTeamId, email);

            Assert.Equal(AcceptInviteStatus.WrongEmail,
                (await _invites.AcceptAsync(invite.Token, _db.NewEmail("other"), Password, "A", "B")).Status);
            Assert.Equal(AcceptInviteStatus.WeakPassword,
                (await _invites.AcceptAsync(invite.Token, email, "short", "A", "B")).Status);
            Assert.Equal(AcceptInviteStatus.MissingDetails,
                (await _invites.AcceptAsync(invite.Token, email, Password, "", "")).Status);
            Assert.Equal(AcceptInviteStatus.Invalid,
                (await _invites.AcceptAsync("not-a-token", email, Password, "A", "B")).Status);
        }

        [Fact]
        public async Task Invite_Revoked_AndExpired_CannotBeAccepted()
        {
            var email = _db.NewEmail("r");
            var revoked = await _invites.CreateAsync(_db.HostAdminId, _db.HostTeamId, email);
            Assert.True(await _invites.RevokeAsync(revoked.InvitationId, _db.HostAdminId));
            Assert.Equal(AcceptInviteStatus.Revoked,
                (await _invites.AcceptAsync(revoked.Token, email, Password, "A", "B")).Status);

            var email2 = _db.NewEmail("e");
            var expired = await _invites.CreateAsync(_db.HostAdminId, _db.HostTeamId, email2);
            _db.Scalar<int>("UPDATE CoachInvitations SET ExpiresAtUtc = DATEADD(DAY, -1, SYSUTCDATETIME()) WHERE InvitationId = @id; SELECT 1",
                new { id = expired.InvitationId });
            Assert.Equal(AcceptInviteStatus.Expired,
                (await _invites.AcceptAsync(expired.Token, email2, Password, "A", "B")).Status);
        }

        [Fact]
        public async Task Invite_ExistingAccount_NeedsItsCurrentPassword_AndLocksAfterRepeatedFailures()
        {
            var (_, email) = await AcceptNewCoach();
            var invite = await _invites.CreateAsync(_db.HostAdminId, _db.HostTeam2Id, email);

            for (var i = 0; i < 5; i++)
                Assert.Equal(AcceptInviteStatus.InvalidCredentials,
                    (await _invites.AcceptAsync(invite.Token, email, "wrong-password-1", null, null)).Status);

            Assert.Equal(AcceptInviteStatus.Revoked,
                (await _invites.AcceptAsync(invite.Token, email, Password, null, null)).Status);

            var fresh = await _invites.CreateAsync(_db.HostAdminId, _db.HostTeam2Id, email);
            var ok = await _invites.AcceptAsync(fresh.Token, email, Password, null, null);
            Assert.Equal(AcceptInviteStatus.Accepted, ok.Status);
            Assert.False(ok.CreatedAccount);
        }

        [Fact]
        public async Task Refresh_RotatesToken_AndReplayRevokesTheWholeChain()
        {
            var (userId, _) = await AcceptNewCoach();
            var first = await _sessions.IssueRefreshTokenAsync(userId);

            var rotated = await _sessions.RotateAsync(first);
            Assert.NotNull(rotated);
            Assert.NotEqual(first, rotated!.RefreshToken);
            Assert.Equal(userId, rotated.UserId);

            Assert.Null(await _sessions.RotateAsync(first));
            Assert.Null(await _sessions.RotateAsync(rotated.RefreshToken));
        }

        [Fact]
        public async Task Refresh_FailsForUnknownToken_Expired_AndDeactivatedUser()
        {
            var (userId, _) = await AcceptNewCoach();
            Assert.Null(await _sessions.RotateAsync("unknown"));
            Assert.Null(await _sessions.RotateAsync(""));

            var expired = await _sessions.IssueRefreshTokenAsync(userId);
            _db.Scalar<int>("UPDATE RefreshTokens SET ExpiresAtUtc = DATEADD(DAY, -1, SYSUTCDATETIME()) WHERE UserId = @userId; SELECT 1", new { userId });
            Assert.Null(await _sessions.RotateAsync(expired));

            var live = await _sessions.IssueRefreshTokenAsync(userId);
            _db.Scalar<int>("UPDATE AuthUsers SET IsActive = 0 WHERE Id = @userId; SELECT 1", new { userId });
            Assert.Null(await _sessions.RotateAsync(live));
        }

        [Fact]
        public async Task PasswordReset_IsSingleUse_AndSignsOutEveryDevice()
        {
            var (userId, email) = await AcceptNewCoach();
            var refresh = await _sessions.IssueRefreshTokenAsync(userId);

            var reset = await _sessions.CreatePasswordResetAsync(email);
            Assert.NotNull(reset);

            Assert.False(await _sessions.ResetPasswordAsync(reset!.Value.Token, "short"));
            Assert.True(await _sessions.ResetPasswordAsync(reset.Value.Token, "a-brand-new-password"));
            Assert.False(await _sessions.ResetPasswordAsync(reset.Value.Token, "another-new-password"));
            Assert.Null(await _sessions.RotateAsync(refresh));
        }

        [Fact]
        public async Task PasswordReset_UnknownAccount_ReturnsNull_AndIsRateLimited()
        {
            Assert.Null(await _sessions.CreatePasswordResetAsync(_db.NewEmail("nobody")));

            var (_, email) = await AcceptNewCoach();
            for (var i = 0; i < 3; i++)
                Assert.NotNull(await _sessions.CreatePasswordResetAsync(email));
            Assert.Null(await _sessions.CreatePasswordResetAsync(email));
        }

        [Fact]
        public async Task AdminPasswordReset_RevokesRefreshTokens()
        {
            var (userId, _) = await AcceptNewCoach();
            var refresh = await _sessions.IssueRefreshTokenAsync(userId);

            var repo = new UsersRepository(_db.Factory, new CoachTeamsRepository(_db.Factory));
            await repo.UpdatePasswordHashAsync(userId, BCrypt.Net.BCrypt.HashPassword("admin-set-password"));

            Assert.Null(await _sessions.RotateAsync(refresh));
        }

        [Fact]
        public void SearchLimiter_BlocksAfterThirtyPerMinute_AndRecovers()
        {
            var user = Guid.NewGuid();
            var t = DateTime.UtcNow;
            for (var i = 0; i < 30; i++) Assert.True(SearchLimiter.TryAcquire(user, t));
            Assert.False(SearchLimiter.TryAcquire(user, t.AddSeconds(30)));
            Assert.True(SearchLimiter.TryAcquire(user, t.AddSeconds(61)));
            Assert.True(SearchLimiter.TryAcquire(Guid.NewGuid(), t));
        }
    }
}
