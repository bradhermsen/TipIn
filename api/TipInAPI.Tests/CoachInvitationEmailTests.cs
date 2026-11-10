using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Mail;
using System.Reflection;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.Services;
using Xunit;

namespace TipInAPI.Tests
{
    public class CoachInvitationEmailTests
    {
        private static CreatedCoachInvitation Invite() => new()
        {
            TeamName = "Black River Falls Co-op", LevelName = "Varsity", TeamType = "Boys",
            Email = "coach@example.test", ExpiresAtUtc = new DateTime(2026, 11, 17),
            Game = new CoachInvitationGame
            {
                AwayTeamName = "Black River Falls Co-op", HomeTeamName = "Riverbend",
                TeamType = "Boys", LevelName = "Varsity", GameDateTime = new DateTime(2026, 11, 10, 19, 0, 0),
                ArenaName = "Example Ice Arena", RinkName = "Rink 2"
            }
        };

        [Fact]
        public void Email_ContainsApprovedSubject_GameDetails_Links_AndEmbeddedQr()
        {
            const string link = "https://coach-dev.tipinscoring.com/accept#token=fixture";
            var previous = CultureInfo.CurrentCulture;
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("fr-FR");
            try
            {
                var email = CoachInvitationEmail.Create(Invite(), link);
                Assert.Equal("Black River Falls Co-op vs. Riverbend Boys Varsity Hockey \u2013 Set Your Roster", email.Subject);
                Assert.Contains("Tuesday, November 10, 2026 \u2022 7:00 PM Central", email.BodyText);
                Assert.Contains("Black River Falls Co-op at Riverbend", email.BodyText);
                Assert.Contains("Example Ice Arena \u2014 Rink 2", email.BodyText);
                Assert.Contains("November 17, 2026", email.BodyText);
                Assert.Contains("can be used once", email.BodyText);
                Assert.Contains("1. Accept your TipIn invitation.", email.BodyText);
                Assert.Contains("4. Sign and lock your lineup when complete.", email.BodyText);
                Assert.Contains(link, email.BodyText);
                Assert.Contains("info@tipinscoring.com", email.BodyText);
                Assert.Contains(CoachInvitationEmail.GameViewUrl, email.BodyText);
                Assert.Contains("Set Up Your Roster", email.BodyHtml);
                Assert.Contains("mailto:info@tipinscoring.com", email.BodyHtml);
                var qr = Assert.Single(email.InlineImages, i => i.ContentId == "tipin-gameview-qr");
                var logo = Assert.Single(email.InlineImages, i => i.ContentId == "tipin-logo");
                Assert.Contains("cid:tipin-logo", email.BodyHtml);
                Assert.True(logo.Content.Length > 1000);
                Assert.Equal("image/png", qr.ContentType);
                Assert.Contains($"cid:{qr.ContentId}", email.BodyHtml);
                Assert.Equal(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }, qr.Content[..8]);
            }
            finally { CultureInfo.CurrentCulture = previous; }
        }

        [Fact]
        public void Email_WithoutGameUsesTeamOnlyCopy_AndMissingVenueIsExplicit()
        {
            var invite = Invite();
            invite.Game = null;
            var email = CoachInvitationEmail.Create(invite, "https://example.test/accept#token=fixture");
            Assert.Equal("Black River Falls Co-op Varsity - Boys Hockey \u2013 Set Your Roster", email.Subject);
            Assert.DoesNotContain("Game Details", email.BodyText);
            Assert.DoesNotContain("upcoming game", email.BodyText);
            Assert.DoesNotContain("Game Details", email.BodyHtml);
            invite = Invite();
            invite.Game!.ArenaName = null;
            invite.Game.RinkName = null;
            Assert.Contains("Venue to be confirmed", CoachInvitationEmail.Create(invite, "https://example.test").BodyText);
        }

        [Fact]
        public void Email_EncodesDynamicHtml_AndRemovesSubjectNewlines()
        {
            var invite = Invite();
            invite.TeamName = "<script>alert(1)</script>";
            invite.Game!.AwayTeamName = "Away\r\nInjected: header";
            invite.Game.ArenaName = "<img src=x>";
            var email = CoachInvitationEmail.Create(invite, "https://example.test/accept#token=x&extra=\"bad\"");
            Assert.DoesNotContain("<script>", email.BodyHtml);
            Assert.DoesNotContain("<img src=x>", email.BodyHtml);
            Assert.Contains("&lt;script&gt;", email.BodyHtml);
            Assert.Contains("&amp;extra=&quot;bad&quot;", email.BodyHtml);
            Assert.DoesNotContain("\n", email.Subject);
            Assert.DoesNotContain("\r", email.Subject);
        }

        [Fact]
        public void SmtpBody_PreservesPlainText_AndEmbedsQrAsRelatedResource()
        {
            var method = typeof(SmtpEmailService).GetMethod("AddHtmlBody", BindingFlags.NonPublic | BindingFlags.Static)!;
            var request = CoachInvitationEmail.Create(Invite(), "https://example.test");
            using var message = new MailMessage { Body = request.BodyText };
            method.Invoke(null, new object[] { message, request });
            Assert.Equal(2, message.AlternateViews.Count);
            Assert.Equal("text/plain", message.AlternateViews[0].ContentType.MediaType);
            var html = message.AlternateViews[1];
            Assert.Equal("text/html", html.ContentType.MediaType);
            Assert.Equal(2, html.LinkedResources.Count);
            Assert.Equal(request.InlineImages[0].ContentId, html.LinkedResources[0].ContentId);
            Assert.Equal("image/png", html.LinkedResources[0].ContentType.MediaType);
            using var plain = new MailMessage { Body = "Existing scoresheet text" };
            method.Invoke(null, new object[] { plain, new EmailSendRequest { BodyText = plain.Body } });
            Assert.Empty(plain.AlternateViews);
            Assert.Equal("Existing scoresheet text", plain.Body);
        }

        [Fact]
        public async Task SmtpBody_SerializesHtml_PlainText_AndCidImageTogether()
        {
            var directory = Path.Combine(Path.GetTempPath(), "tipin-invite-mail-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            try
            {
                var request = CoachInvitationEmail.Create(Invite(), "https://example.test/accept#token=fixture");
                using var message = new MailMessage("sender@example.test", "coach@example.test")
                {
                    Subject = request.Subject, Body = request.BodyText
                };
                typeof(SmtpEmailService).GetMethod("AddHtmlBody", BindingFlags.NonPublic | BindingFlags.Static)!
                    .Invoke(null, new object[] { message, request });
                using var smtp = new SmtpClient
                {
                    DeliveryMethod = SmtpDeliveryMethod.SpecifiedPickupDirectory,
                    PickupDirectoryLocation = directory
                };
                await smtp.SendMailAsync(message);
                var mime = await File.ReadAllTextAsync(Assert.Single(Directory.GetFiles(directory)));
                Assert.Contains("multipart/alternative", mime);
                Assert.Contains("multipart/related", mime);
                Assert.Contains("text/plain", mime);
                Assert.Contains("text/html", mime);
                Assert.Contains("image/png", mime);
                Assert.Contains("Content-ID: <tipin-gameview-qr>", mime, StringComparison.OrdinalIgnoreCase);
                Assert.Contains("Content-ID: <tipin-logo>", mime, StringComparison.OrdinalIgnoreCase);
            }
            finally
            {
                foreach (var file in Directory.GetFiles(directory)) File.Delete(file);
                Directory.Delete(directory);
            }
        }

        [Fact]
        public async Task Invitation_SelectsNextEligibleGame_IncludingToday_ThenFallsBackToTeamOnly()
        {
            using var db = new TestDatabase();
            using var conn = db.Factory.CreateConnection();
            conn.Execute("UPDATE Games SET Status = 'Final' WHERE HomeTeamId = @t OR AwayTeamId = @t", new { t = db.HostTeamId });
            var today = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("America/Chicago")).Date;
            var past = db.AddGame(db.HostTeamId, db.VisitorTeamId, -2, "Scheduled");
            conn.Execute("UPDATE Games SET GameDateTime = @date WHERE GameId = @id", new { date = today.AddDays(-1), id = past });
            foreach (var status in new[] { "Final", "Cancelled", "Completed", "Closed", "Postponed", "Canceled", "In Progress", "Live" })
            {
                var id = db.AddGame(db.HostTeamId, db.VisitorTeamId, 0, status);
                conn.Execute("UPDATE Games SET GameDateTime = @date WHERE GameId = @id", new { date = today, id });
            }
            var tomorrow = db.AddGame(db.HostTeamId, db.VisitorTeamId, 1, "Scheduled");
            var nearest = db.AddGame(db.VisitorTeamId, db.HostTeamId, 0, "Scheduled");
            conn.Execute("UPDATE Games SET GameDateTime = @date, ArenaName = 'Test Arena', RinkName = 'Test Rink' WHERE GameId = @id",
                new { date = today.AddHours(19), id = nearest });
            var service = new CoachInvitationService(db.Factory);
            var invite = await service.CreateAsync(db.HostAdminId, db.HostTeamId, db.NewEmail("game-mail"));
            Assert.Equal(nearest, invite.Game!.GameId);
            Assert.Equal("Test Arena", invite.Game.ArenaName);
            Assert.Equal("Test Rink", invite.Game.RinkName);
            Assert.Equal(today.AddHours(19), invite.Game.GameDateTime);
            conn.Execute("UPDATE Games SET Status = 'Final' WHERE GameId = @id", new { id = nearest });
            invite = await service.CreateAsync(db.HostAdminId, db.HostTeamId, db.NewEmail("next-mail"));
            Assert.Equal(tomorrow, invite.Game!.GameId);
            conn.Execute("UPDATE Games SET Status = 'Final' WHERE GameId = @id", new { id = tomorrow });
            invite = await service.CreateAsync(db.HostAdminId, db.HostTeamId, db.NewEmail("team-mail"));
            Assert.Null(invite.Game);
        }
    }
}
