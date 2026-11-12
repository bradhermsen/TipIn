using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Threading;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using TipInAPI.Services;
using Xunit;

namespace TipInAPI.Tests
{
    public class CoachReminderTests
    {
        private static DateTime Local(string text) => DateTime.Parse(text, CultureInfo.InvariantCulture);
        private static DateTime Utc(string text) => TimeZoneInfo.ConvertTimeToUtc(
            DateTime.SpecifyKind(Local(text), DateTimeKind.Unspecified), CoachReminderSchedule.Central);

        [Theory]
        [InlineData("2026-11-10 19:00", "2026-11-07 08:59", null)]
        [InlineData("2026-11-10 19:00", "2026-11-07 09:00", "RosterReview")]
        [InlineData("2026-11-10 19:00", "2026-11-09 07:00", "RosterReview")]
        [InlineData("2026-11-10 19:00", "2026-11-10 07:59", "RosterReview")]
        [InlineData("2026-11-10 19:00", "2026-11-10 08:00", "LineupReminder")]
        [InlineData("2026-11-10 19:00", "2026-11-10 18:59", "LineupReminder")]
        [InlineData("2026-11-10 19:00", "2026-11-10 19:00", null)]
        [InlineData("2026-11-10 19:00", "2026-11-11 08:00", null)]
        [InlineData("2026-11-10 09:59", "2026-11-09 17:59", "RosterReview")]
        [InlineData("2026-11-10 09:59", "2026-11-09 18:00", "LineupReminder")]
        [InlineData("2026-11-10 09:59", "2026-11-10 08:00", "LineupReminder")]
        [InlineData("2026-11-10 10:00", "2026-11-09 18:00", "RosterReview")]
        [InlineData("2026-11-10 10:00", "2026-11-10 08:00", "LineupReminder")]
        [InlineData("2026-03-10 19:00", "2026-03-07 08:59", null)]
        [InlineData("2026-03-10 19:00", "2026-03-07 09:00", "RosterReview")]
        [InlineData("2026-03-08 09:00", "2026-03-07 18:00", "LineupReminder")]
        [InlineData("2026-11-01 09:00", "2026-10-31 18:00", "LineupReminder")]
        [InlineData("2027-01-02 19:00", "2026-12-30 09:00", "RosterReview")]
        public void Schedule_UsesCentralCalendarDays_AndStopsAtPuckDrop(string game, string now, string? expected) =>
            Assert.Equal(expected, CoachReminderSchedule.DueType(Local(game), Utc(now)));

        [Fact]
        public void ExistingAccountEmail_HasDirectLineupLink_NoInvitationExpiry_AndBranding()
        {
            var invite = Fixture();
            const string link = "https://coach-dev.tipinscoring.com/teams/fixture/games/fixture";
            var email = CoachInvitationEmail.CreateReminder(invite, link, "RosterReview", true, Utc("2038-11-07 09:00"));
            Assert.Contains("Review Your Roster", email.Subject);
            Assert.Contains(link, email.BodyText);
            Assert.Contains("No new invitation or account setup is required", email.BodyText);
            Assert.DoesNotContain("expires", email.BodyText);
            Assert.DoesNotContain("Accept your TipIn invitation.", email.BodyText);
            Assert.Contains("cid:tipin-logo", email.BodyHtml);
            Assert.Contains("cid:tipin-gameview-qr", email.BodyHtml);
            Assert.Contains("#ff7b00", email.BodyHtml);
            Assert.Equal(2, email.InlineImages.Count);
        }

        [Fact]
        public void PendingEmail_RefersToOriginalLink_AndMorningCatchupSaysToday()
        {
            var invite = Fixture();
            invite.ReusedPendingInvitation = true;
            invite.Game!.GameDateTime = Local("2038-11-10 09:00");
            var email = CoachInvitationEmail.CreateReminder(invite, "https://example.test/login", "LineupReminder", false, Utc("2038-11-09 18:00"));
            Assert.StartsWith("Game Tomorrow:", email.Subject);
            Assert.Contains("original invitation email", email.BodyText);
            Assert.DoesNotContain("/accept#token=", email.BodyText);
            Assert.Contains("Open Coach Site", email.BodyHtml);
            email = CoachInvitationEmail.CreateReminder(invite, "https://example.test/login", "LineupReminder", false, Utc("2038-11-10 08:00"));
            Assert.StartsWith("Game Today:", email.Subject);
        }

        private static CreatedCoachInvitation Fixture() => new()
        {
            TeamName = "Test Team", Email = "coach@example.test", ExpiresAtUtc = Local("2038-11-14"),
            Game = new CoachInvitationGame
            {
                AwayTeamName = "Away", HomeTeamName = "Home", GameDateTime = Local("2038-11-10 19:00"),
                TeamType = "Boys", LevelName = "Varsity"
            }
        };

        internal sealed class FakeEmail : IEmailService
        {
            public readonly List<EmailSendRequest> Sent = new();
            public bool Fail;
            public bool Enabled = true;
            public int Delay;
            public Task<EmailServerSettings> GetSettingsAsync(bool includeSecret = false) => Task.FromResult(new EmailServerSettings { Enabled = Enabled });
            public async Task SendAsync(EmailSendRequest request)
            {
                if (Delay > 0) await Task.Delay(Delay);
                if (Fail) throw new IOException("Synthetic uncertain SMTP failure.");
                Sent.Add(request);
            }
            public Task<EmailServerSettings> SaveSettingsAsync(EmailServerSettings settings) => throw new NotSupportedException();
            public Task<IReadOnlyList<MediaOutletRecipient>> GetMediaOutletsAsync() => throw new NotSupportedException();
            public Task<IReadOnlyList<MediaOutletRecipient>> SaveMediaOutletsAsync(IEnumerable<MediaOutletRecipient> outlets) => throw new NotSupportedException();
        }

        private sealed class HookInvitations : ICoachInvitationService
        {
            private readonly ICoachInvitationService _inner;
            private readonly Action _afterCreate;
            public HookInvitations(ICoachInvitationService inner, Action afterCreate) { _inner = inner; _afterCreate = afterCreate; }
            public async Task<CreatedCoachInvitation> CreateForReminderAsync(Guid teamId, string email, CoachInvitationGame game, bool allowCreation = true)
            {
                var invite = await _inner.CreateForReminderAsync(teamId, email, game, allowCreation);
                _afterCreate();
                return invite;
            }
            public Task<CreatedCoachInvitation> CreateAsync(Guid actor, Guid team, string email) => _inner.CreateAsync(actor, team, email);
            public Task<IEnumerable<CoachInvitationItem>> ListForTeamAsync(Guid team) => _inner.ListForTeamAsync(team);
            public Task<Guid?> GetTeamIdAsync(Guid id) => _inner.GetTeamIdAsync(id);
            public Task<bool> RevokeAsync(Guid id, Guid actor) => _inner.RevokeAsync(id, actor);
            public Task<AcceptInviteResult> AcceptAsync(string token, string email, string password, string? first, string? last) =>
                _inner.AcceptAsync(token, email, password, first, last);
        }

        private sealed class FakeAutomation : ICoachEmailAutomationSettingsService
        {
            public CoachEmailAutomationSettings Settings = new() { AutomaticInvitations = true, RosterReminders = true, LineupReminders = true };
            public Task<CoachEmailAutomationSettings> GetAsync(CancellationToken cancellationToken = default) => Task.FromResult(Settings);
            public Task SaveAsync(CoachEmailAutomationSettings settings, CancellationToken cancellationToken = default)
            {
                Settings = settings; return Task.CompletedTask;
            }
        }

        private sealed class Scenario : IDisposable
        {
            public readonly TestDatabase Db = new();
            public readonly FakeEmail Mail = new();
            public readonly FakeAutomation Automation = new();
            public readonly Guid GameId;
            public readonly DateTime Now = Utc("2038-11-07 09:00");
            public readonly CoachInvitationService Invitations;
            public Scenario()
            {
                using var conn = Db.Factory.CreateConnection();
                conn.Execute(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "CreateCoachReminderDeliveries.sql")));
                Invitations = new CoachInvitationService(Db.Factory);
                GameId = Db.AddGame(Db.HostTeamId, Db.VisitorTeamId, 10, "Scheduled");
                conn.Execute("UPDATE dbo.Games SET GameDateTime=@date WHERE GameId=@GameId;",
                    new { date = Local("2038-11-10 19:00"), GameId });
            }
            public CoachReminderService Service(bool enabled = true, string? url = "https://coach-dev.tipinscoring.com",
                ICoachInvitationService? invitations = null) =>
                new(Db.Factory, invitations ?? Invitations, Mail, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["CoachReminders:Enabled"] = enabled.ToString(), ["CoachApp:BaseUrl"] = url
                }).Build(), NullLogger<CoachReminderService>.Instance, Automation);
            public string Head(string? email = null)
            {
                email ??= Db.NewEmail("head");
                using var conn = Db.Factory.CreateConnection();
                conn.Execute("UPDATE dbo.Teams SET HeadCoachEmail=@email WHERE Id=@id;", new { email, id = Db.HostTeamId });
                return email.ToLowerInvariant();
            }
            public CoachInvitationGame Game() => new()
            {
                GameId = GameId, GameDateTime = Local("2038-11-10 19:00"), HomeTeamName = "Home", AwayTeamName = "Away"
            };
            public void Dispose() => Db.Dispose();
        }

        [Fact]
        public async Task DisabledByDefault_AndDisabledSmtp_DoNotClaimOrSend()
        {
            using var s = new Scenario();
            s.Head();
            Assert.Equal(0, await s.Service(false).RunAsync(s.Now));
            s.Mail.Enabled = false;
            Assert.Equal(0, await s.Service().RunAsync(s.Now));
            Assert.Empty(s.Mail.Sent);
            Assert.Equal(0, s.Db.Scalar<int>("SELECT COUNT(*) FROM dbo.CoachReminderDeliveries WHERE GameId=@g", new { g = s.GameId }));
            s.Mail.Enabled = true;
            await Assert.ThrowsAsync<InvalidOperationException>(() => s.Service(url: null).RunAsync(s.Now));
        }

        [Fact]
        public async Task ExternalVisitorsReceiveInvitationsAndManagedGameRemindersAfterAssignment()
        {
            using var s = new Scenario();
            var externalEmail = s.Db.NewEmail("external");
            using (var conn = s.Db.Factory.CreateConnection())
                conn.Execute("UPDATE Teams SET HeadCoachEmail=@email WHERE Id=@team",
                    new { email = externalEmail, team = s.Db.VisitorTeamId });

            var invitation = Assert.Single(await s.Service().PreviewAsync(s.Now));
            Assert.Equal(s.Db.VisitorTeamId, invitation.TeamId);
            Assert.True(invitation.InvitationOnly);
            Assert.Equal("Invitation", invitation.ReminderType);
            Assert.Equal(1, await s.Service().RunAsync(s.Now));
            Assert.Equal(externalEmail.ToLowerInvariant(), Assert.Single(s.Mail.Sent).To.Single());

            var coach = s.Db.AddCoach(s.Db.VisitorTeamId);
            var assignedEmail = s.Db.Scalar<string>("SELECT Email FROM AuthUsers WHERE Id=@coach", new { coach });
            using (var conn = s.Db.Factory.CreateConnection())
                conn.Execute("UPDATE Teams SET HeadCoachEmail=@email WHERE Id=@team",
                    new { email = assignedEmail, team = s.Db.VisitorTeamId });
            var reminders = await s.Service().PreviewAsync(Utc("2038-11-10 08:00"));
            var reminder = Assert.Single(reminders);
            Assert.Equal(s.Db.VisitorTeamId, reminder.TeamId);
            Assert.False(reminder.InvitationOnly);
            Assert.Equal("LineupReminder", reminder.ReminderType);
            Assert.Equal(1, await s.Service().RunAsync(Utc("2038-11-10 08:00")));
            var reminderEmail = Assert.Single(s.Mail.Sent, message =>
                message.To.Any(email => string.Equals(email, assignedEmail, StringComparison.OrdinalIgnoreCase)));
            Assert.Contains("lineup", reminderEmail.Subject, StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public async Task ExternalHomeGameDoesNotTriggerRosterRemindersOrInvitationsForEitherTeam()
        {
            using var s = new Scenario();
            s.Head();
            var externalEmail = s.Db.NewEmail("external");
            using (var conn = s.Db.Factory.CreateConnection())
            {
                conn.Execute("UPDATE dbo.Teams SET HeadCoachEmail=@email WHERE Id=@team",
                    new { email = externalEmail, team = s.Db.VisitorTeamId });
                conn.Execute("UPDATE dbo.Games SET HomeTeamId=@external, AwayTeamId=@managed WHERE GameId=@game;",
                    new { external = s.Db.VisitorTeamId, managed = s.Db.HostTeamId, game = s.GameId });
            }

            Assert.Empty(await s.Service().PreviewAsync(s.Now));
            Assert.Equal(0, await s.Service().RunAsync(s.Now));
            Assert.Empty(s.Mail.Sent);
        }

        [Fact]
        public async Task AssignedAccounts_GetDirectLinks_AndBothStagesAreDeduplicated()
        {
            using var s = new Scenario();
            var coach = s.Db.AddCoach(s.Db.HostTeamId);
            var email = s.Db.Scalar<string>("SELECT Email FROM dbo.AuthUsers WHERE Id=@coach", new { coach });
            s.Head(email);
            Assert.Single(await s.Service().PreviewAsync(s.Now));
            Assert.Empty(s.Mail.Sent);
            Assert.Equal(1, await s.Service().RunAsync(s.Now));
            Assert.Contains($"/teams/{s.Db.HostTeamId}/games/{s.GameId}", Assert.Single(s.Mail.Sent).BodyText);
            Assert.Equal(0, await s.Service().RunAsync(s.Now));
            Assert.Equal(1, await s.Service().RunAsync(Utc("2038-11-10 08:00")));
            Assert.Equal(0, await s.Service().RunAsync(Utc("2038-11-10 08:15")));
            Assert.Equal(2, s.Mail.Sent.Count);
            Assert.Equal(0, s.Db.Scalar<int>("SELECT COUNT(*) FROM dbo.CoachInvitations WHERE TeamId=@t", new { t = s.Db.HostTeamId }));
        }

        [Fact]
        public async Task OnlyHeadAndAssignedAccounts_AreContacted_NoAssistantAutoInvites()
        {
            using var s = new Scenario();
            var head = s.Head();
            var assigned = s.Db.AddCoach(s.Db.HostTeamId);
            var assistant = s.Db.NewEmail("assistant");
            using var conn = s.Db.Factory.CreateConnection();
            conn.Execute("UPDATE dbo.Teams SET AssistantCoach1Email=@assistant WHERE Id=@t", new { assistant, t = s.Db.HostTeamId });
            await s.Invitations.CreateAsync(s.Db.HostAdminId, s.Db.HostTeamId, assistant);
            Assert.Equal(2, await s.Service().RunAsync(s.Now));
            Assert.DoesNotContain(s.Mail.Sent, m => m.To.Contains(assistant));
            var headMail = Assert.Single(s.Mail.Sent, m => m.To.Contains(head));
            Assert.Contains("/accept#token=", headMail.BodyText);
            var invitations = s.Db.Scalar<int>("SELECT COUNT(*) FROM dbo.CoachInvitations WHERE Email=@head AND TeamId=@t AND CreatedByUserId IS NULL",
                new { head, t = s.Db.HostTeamId });
            Assert.Equal(1, invitations);
        }

        [Fact]
        public async Task ExistingUnassignedHead_RequiresInvitation_WithoutGrantingAccess()
        {
            using var s = new Scenario();
            var coach = s.Db.AddCoach(s.Db.OtherTeamId);
            var email = s.Db.Scalar<string>("SELECT Email FROM dbo.AuthUsers WHERE Id=@coach", new { coach });
            s.Head(email);
            Assert.Equal(1, await s.Service().RunAsync(s.Now));
            Assert.Contains("/accept#token=", Assert.Single(s.Mail.Sent).BodyText);
            Assert.Equal(0, s.Db.Scalar<int>("SELECT COUNT(*) FROM dbo.CoachTeams WHERE UserId=@coach AND TeamId=@t", new { coach, t = s.Db.HostTeamId }));
        }

        [Fact]
        public async Task ValidPendingInvite_IsReusedWithoutResettingTokenOrExpiry()
        {
            using var s = new Scenario();
            var head = s.Head();
            var existing = await s.Invitations.CreateAsync(s.Db.HostAdminId, s.Db.HostTeamId, head);
            Assert.Equal(1, await s.Service().RunAsync(s.Now));
            Assert.Contains("original invitation email", Assert.Single(s.Mail.Sent).BodyText);
            Assert.DoesNotContain(existing.Token, s.Mail.Sent[0].BodyText);
            Assert.Equal(1, s.Db.Scalar<int>("SELECT COUNT(*) FROM dbo.CoachInvitations WHERE TeamId=@t", new { t = s.Db.HostTeamId }));
            Assert.Equal("Pending", s.Db.Scalar<string>("SELECT Status FROM dbo.CoachInvitations WHERE InvitationId=@id", new { id = existing.InvitationId }));
        }

        [Theory]
        [InlineData("Final")]
        [InlineData("Completed")]
        [InlineData("Closed")]
        [InlineData("Cancelled")]
        [InlineData("Canceled")]
        [InlineData("Postponed")]
        [InlineData("In Progress")]
        [InlineData("Live")]
        public async Task TerminalOrUnderwayGames_AreNotContacted(string status)
        {
            using var s = new Scenario();
            s.Head();
            using var conn = s.Db.Factory.CreateConnection();
            conn.Execute("UPDATE dbo.Games SET Status=@status WHERE GameId=@g", new { status, g = s.GameId });
            Assert.Empty(await s.Service().PreviewAsync(s.Now));
            Assert.Equal(0, await s.Service().RunAsync(s.Now));
        }

        [Fact]
        public async Task SignedLineups_AreSkipped_UnlockRestoresEligibility()
        {
            using var s = new Scenario();
            s.Head();
            using var conn = s.Db.Factory.CreateConnection();
            conn.Execute(@"INSERT INTO dbo.GameLineupEvents(EventId,GameId,TeamId,EventType,LineupVersion,CreatedAtUtc)
                VALUES(NEWID(),@g,@t,'Sign',1,'2038-11-06');", new { g = s.GameId, t = s.Db.HostTeamId });
            Assert.Equal(0, await s.Service().RunAsync(s.Now));
            conn.Execute(@"INSERT INTO dbo.GameLineupEvents(EventId,GameId,TeamId,EventType,LineupVersion,CreatedAtUtc)
                VALUES(NEWID(),@g,@t,'Unlock',1,'2038-11-07');", new { g = s.GameId, t = s.Db.HostTeamId });
            Assert.Equal(1, await s.Service().RunAsync(s.Now));
        }

        [Fact]
        public async Task DisabledAccounts_RevokedInvites_RemovedAccess_AndLockedOutInvites_AreNotResurrected()
        {
            using var s = new Scenario();
            var head = s.Head();
            var invite = await s.Invitations.CreateAsync(s.Db.HostAdminId, s.Db.HostTeamId, head);
            await s.Invitations.RevokeAsync(invite.InvitationId, s.Db.HostAdminId);
            Assert.Empty(await s.Service().PreviewAsync(s.Now));
            invite = await s.Invitations.CreateAsync(s.Db.HostAdminId, s.Db.HostTeamId, head);
            using var conn = s.Db.Factory.CreateConnection();
            conn.Execute("UPDATE dbo.CoachInvitations SET FailedAttempts=5 WHERE InvitationId=@id", new { id = invite.InvitationId });
            Assert.Empty(await s.Service().PreviewAsync(s.Now));
            conn.Execute("UPDATE dbo.CoachInvitations SET FailedAttempts=0,Status='Accepted' WHERE InvitationId=@id", new { id = invite.InvitationId });
            Assert.Empty(await s.Service().PreviewAsync(s.Now));
            var coach = s.Db.AddCoach(s.Db.HostTeamId);
            var email = s.Db.Scalar<string>("SELECT Email FROM dbo.AuthUsers WHERE Id=@coach", new { coach });
            s.Head(email);
            conn.Execute("UPDATE dbo.AuthUsers SET IsActive=0 WHERE Id=@coach", new { coach });
            Assert.Empty(await s.Service().PreviewAsync(s.Now));
            Assert.Empty(s.Mail.Sent);
        }

        [Fact]
        public async Task ExpiredPendingInvite_CanBeReplaced_ButReminderUsesItsSpecificGame()
        {
            using var s = new Scenario();
            var head = s.Head();
            var old = await s.Invitations.CreateAsync(s.Db.HostAdminId, s.Db.HostTeamId, head);
            using var conn = s.Db.Factory.CreateConnection();
            conn.Execute("UPDATE dbo.CoachInvitations SET ExpiresAtUtc=DATEADD(day,-1,SYSUTCDATETIME()) WHERE InvitationId=@id", new { id = old.InvitationId });
            Assert.Equal(1, await s.Service().RunAsync(s.Now));
            Assert.Contains("November 10, 2038", Assert.Single(s.Mail.Sent).BodyText);
            Assert.Contains("/accept#token=", s.Mail.Sent[0].BodyText);
            Assert.Equal("Revoked", s.Db.Scalar<string>("SELECT Status FROM dbo.CoachInvitations WHERE InvitationId=@id", new { id = old.InvitationId }));
        }

        [Fact]
        public async Task UncertainDelivery_IsQuarantinedAndNeverAutomaticallyRetried()
        {
            using var s = new Scenario();
            s.Head();
            s.Mail.Fail = true;
            await Assert.ThrowsAsync<InvalidOperationException>(() => s.Service().RunAsync(s.Now));
            Assert.Equal("NeedsReview", s.Db.Scalar<string>("SELECT Status FROM dbo.CoachReminderDeliveries WHERE GameId=@g", new { g = s.GameId }));
            s.Mail.Fail = false;
            Assert.Equal(0, await s.Service().RunAsync(s.Now));
            Assert.Equal(0, await s.Service().RunAsync(Utc("2038-11-10 08:00")));
            Assert.Empty(s.Mail.Sent);
        }

        [Theory]
        [InlineData("reschedule")]
        [InlineData("cancel")]
        [InlineData("sign")]
        [InlineData("disable")]
        public async Task FinalRecheck_StopsChangedGamesOrAccounts_WithoutLeavingAnUnsentInvitation(string change)
        {
            using var s = new Scenario();
            var head = s.Head();
            var hook = new HookInvitations(s.Invitations, () =>
            {
                using var conn = s.Db.Factory.CreateConnection();
                var args = new { g = s.GameId, t = s.Db.HostTeamId };
                if (change == "reschedule") conn.Execute("UPDATE dbo.Games SET GameDateTime=DATEADD(day,7,GameDateTime) WHERE GameId=@g", args);
                if (change == "cancel") conn.Execute("UPDATE dbo.Games SET Status='Cancelled' WHERE GameId=@g", args);
                if (change == "disable") conn.Execute("UPDATE dbo.Teams SET IsActive=0 WHERE Id=@t", args);
                if (change == "sign") conn.Execute(@"INSERT INTO dbo.GameLineupEvents(EventId,GameId,TeamId,EventType,LineupVersion)
                    VALUES(NEWID(),@g,@t,'Sign',1);", args);
            });
            Assert.Equal(0, await s.Service(invitations: hook).RunAsync(s.Now));
            Assert.Empty(s.Mail.Sent);
            Assert.Equal(0, s.Db.Scalar<int>("SELECT COUNT(*) FROM dbo.CoachReminderDeliveries WHERE GameId=@g", new { g = s.GameId }));
            Assert.Equal(0, s.Db.Scalar<int>("SELECT COUNT(*) FROM dbo.CoachInvitations WHERE TeamId=@t AND Email=@head", new { t = s.Db.HostTeamId, head }));
        }

        [Fact]
        public async Task HeadCoachWithAdminAccess_GetsDirectLink_WithoutCrossOrganizationAccess()
        {
            using var s = new Scenario();
            var email = s.Db.Scalar<string>("SELECT Email FROM dbo.AuthUsers WHERE Id=@id", new { id = s.Db.HostAdminId });
            s.Head(email);
            Assert.True(Assert.Single(await s.Service().PreviewAsync(s.Now)).HasTeamAccess);
            Assert.Equal(1, await s.Service().RunAsync(s.Now));
            Assert.DoesNotContain("/accept#token=", Assert.Single(s.Mail.Sent).BodyText);
            using var conn = s.Db.Factory.CreateConnection();
            conn.Execute("DELETE FROM dbo.CoachReminderDeliveries WHERE GameId=@g; UPDATE dbo.Users SET OrganizationId=NULL WHERE Id=@id;",
                new { g = s.GameId, id = s.Db.HostAdminId });
            Assert.Empty(await s.Service().PreviewAsync(s.Now));
        }

        [Fact]
        public async Task CrashedSendingClaim_BlocksLaterStagesAndOtherGamesUntilOperatorReview()
        {
            using var s = new Scenario();
            var head = s.Head();
            using var conn = s.Db.Factory.CreateConnection();
            conn.Execute(@"INSERT INTO dbo.CoachReminderDeliveries(GameId,TeamId,Email,ReminderType,Status)
                VALUES(@g,@t,@head,'RosterReview','Sending');", new { g = s.GameId, t = s.Db.HostTeamId, head });
            Assert.Equal(0, await s.Service().RunAsync(Utc("2038-11-10 08:00")));
            var another = s.Db.AddGame(s.Db.HostTeamId, s.Db.VisitorTeamId, 20, "Scheduled");
            conn.Execute("UPDATE dbo.Games SET GameDateTime=@date WHERE GameId=@g", new { date = Local("2038-11-10 20:00"), g = another });
            Assert.Empty(await s.Service().PreviewAsync(Utc("2038-11-10 08:00")));
            Assert.Empty(s.Mail.Sent);
        }

        [Fact]
        public async Task ConcurrentScans_SendOnce_AndGameDayCatchupDoesNotSendBothStages()
        {
            using var s = new Scenario();
            s.Head();
            s.Mail.Delay = 300;
            var results = await Task.WhenAll(s.Service().RunAsync(Utc("2038-11-10 08:00")),
                s.Service().RunAsync(Utc("2038-11-10 08:00")));
            Assert.Equal(1, results.Sum());
            Assert.Single(s.Mail.Sent);
            Assert.Contains("Set Your Roster", s.Mail.Sent[0].Subject);
            Assert.Equal(0, await s.Service().RunAsync(Utc("2038-11-10 19:00")));
        }

        [Theory]
        [InlineData(false, false)]
        [InlineData(false, true)]
        [InlineData(true, false)]
        [InlineData(true, true)]
        public async Task EachReminderStage_RespectsItsOwnToggle_WithoutInvitingNewHeads(bool rosterOn, bool lineupOn)
        {
            using var s = new Scenario();
            s.Db.AddCoach(s.Db.HostTeamId);
            s.Head();
            s.Automation.Settings = new() { RosterReminders = rosterOn, LineupReminders = lineupOn };
            Assert.Equal(rosterOn ? 1 : 0, await s.Service().RunAsync(s.Now));
            Assert.Equal(lineupOn ? 1 : 0, await s.Service().RunAsync(Utc("2038-11-10 08:00")));
            Assert.Equal(0, s.Db.Scalar<int>("SELECT COUNT(*) FROM dbo.CoachInvitations WHERE TeamId=@t", new { t = s.Db.HostTeamId }));
        }

        [Fact]
        public async Task AutomaticInvites_AreIndependentOfReminderToggles_AndDoNotSendAnImmediateDuplicate()
        {
            using var s = new Scenario();
            s.Head();
            s.Automation.Settings = new() { AutomaticInvitations = true };
            Assert.Equal(1, await s.Service().RunAsync(s.Now));
            Assert.Equal(0, await s.Service().RunAsync(s.Now));
            Assert.Equal(0, await s.Service().RunAsync(Utc("2038-11-10 08:00")));
            s.Automation.Settings = new() { AutomaticInvitations = true, RosterReminders = true, LineupReminders = true };
            Assert.Equal(0, await s.Service().RunAsync(s.Now));
            Assert.Equal(1, await s.Service().RunAsync(Utc("2038-11-10 08:00")));
            Assert.Equal(2, s.Mail.Sent.Count);
        }

        [Fact]
        public async Task PendingInvites_CanGetRemindersWithAutomaticInvitationsOff_ButCannotBeRegenerated()
        {
            using var s = new Scenario();
            var head = s.Head();
            var pending = await s.Invitations.CreateAsync(s.Db.HostAdminId, s.Db.HostTeamId, head);
            s.Automation.Settings = new() { RosterReminders = true };
            Assert.Equal(1, await s.Service().RunAsync(s.Now));
            Assert.Contains("original invitation email", Assert.Single(s.Mail.Sent).BodyText);
            using var conn = s.Db.Factory.CreateConnection();
            conn.Execute("UPDATE dbo.CoachInvitations SET ExpiresAtUtc=DATEADD(day,-1,SYSUTCDATETIME()) WHERE InvitationId=@id", new { id = pending.InvitationId });
            await Assert.ThrowsAsync<InvalidOperationException>(() => s.Invitations.CreateForReminderAsync(s.Db.HostTeamId, head, s.Game(), false));
            Assert.Equal(1, s.Db.Scalar<int>("SELECT COUNT(*) FROM dbo.CoachInvitations WHERE TeamId=@t", new { t = s.Db.HostTeamId }));
        }

        [Fact]
        public async Task AllAutomationOff_DoesNotSend_OrAffectManualInvitations()
        {
            using var s = new Scenario();
            var head = s.Head();
            s.Automation.Settings = new();
            Assert.Empty(await s.Service().PreviewAsync(s.Now));
            Assert.Equal(0, await s.Service().RunAsync(s.Now));
            var manual = await s.Invitations.CreateAsync(s.Db.HostAdminId, s.Db.HostTeamId, head);
            Assert.NotEmpty(manual.Token);
        }
    }
}
