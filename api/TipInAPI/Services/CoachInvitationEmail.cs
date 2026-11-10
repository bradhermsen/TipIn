using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using QRCoder;

namespace TipInAPI.Services
{
    public static class CoachInvitationEmail
    {
        public const string GameViewUrl = "https://gameview.tipinscoring.com";
        private const string QrContentId = "tipin-gameview-qr";
        private const string LogoContentId = "tipin-logo";

        public static EmailSendRequest Create(CreatedCoachInvitation invite, string link) =>
            Build(invite, link, null, false, DateTime.UtcNow);

        public static EmailSendRequest CreateReminder(CreatedCoachInvitation invite, string link,
            string reminderType, bool hasTeamAccess, DateTime? utcNow = null)
        {
            if (invite.Game == null) throw new ArgumentException("Reminder emails require a game.", nameof(invite));
            if (reminderType != "RosterReview" && reminderType != "LineupReminder")
                throw new ArgumentException("Unknown coach reminder type.", nameof(reminderType));
            return Build(invite, link, reminderType, hasTeamAccess, utcNow ?? DateTime.UtcNow);
        }

        private static EmailSendRequest Build(CreatedCoachInvitation invite, string link, string? reminderType, bool hasTeamAccess, DateTime utcNow)
        {
            var culture = CultureInfo.GetCultureInfo("en-US");
            var game = invite.Game;
            var hockey = string.Join(" ", new[] { game?.TeamType, game?.LevelName, "Hockey" }
                .Where(s => !string.IsNullOrWhiteSpace(s)));
            var subject = game == null
                ? $"{invite.TeamDisplayName} Hockey \u2013 Set Your Roster"
                : $"{game.AwayTeamName} vs. {game.HomeTeamName} {hockey} \u2013 Set Your Roster";
            if (reminderType == "RosterReview")
                subject = $"{game!.AwayTeamName} vs. {game.HomeTeamName} {hockey} \u2013 Review Your Roster";
            if (reminderType == "LineupReminder")
                subject = $"{(game!.GameDateTime.Date > CoachReminderSchedule.LocalNow(utcNow).Date ? "Game Tomorrow" : "Game Today")}: {game.AwayTeamName} vs. {game.HomeTeamName} \u2013 Complete Your Lineup";
            var intro = hasTeamAccess
                ? $"Please verify the {invite.TeamDisplayName} roster, select your active players and starters, then sign and lock your lineup before puck drop."
                : $"You\u2019ve been invited to manage the {invite.TeamDisplayName} roster"
                    + (game == null ? "" : " for your upcoming game") + " on TipIn Scoring.";
            var expiry = invite.ExpiresAtUtc.ToString("MMMM d, yyyy", culture);
            var details = game == null ? ""
                : $"Game Details\n\n{game.AwayTeamName} at {game.HomeTeamName}\n"
                + $"{game.GameDateTime.ToString("dddd, MMMM d, yyyy", culture)} \u2022 {game.GameDateTime.ToString("h:mm tt", culture)} Central\n"
                + $"{(string.IsNullOrWhiteSpace(game.ArenaName) ? "Venue to be confirmed" : game.ArenaName)}"
                + (string.IsNullOrWhiteSpace(game.RinkName) ? "" : $" \u2014 {game.RinkName}")
                + $"\n{hockey}\n\n";
            var firstStep = hasTeamAccess ? "Sign in to your TipIn account."
                : invite.ReusedPendingInvitation ? "Accept your TipIn invitation from the original invitation email."
                : "Accept your TipIn invitation.";
            var steps = $"Get your team ready for game day:\n\n1. {firstStep}\n"
                + "2. Review and update your roster.\n3. Set your active players and starting lineup.\n"
                + "4. Sign and lock your lineup when complete.";
            var expiryText = hasTeamAccess ? "Your existing team access is ready. No new invitation or account setup is required."
                : $"Your invitation link expires on {expiry} and can be used once.";
            var pendingText = invite.ReusedPendingInvitation
                ? "Your existing invitation is still valid. Use the one-use link in your original invitation email to accept it; this reminder does not replace that link."
                : "";
            var returning = hasTeamAccess ? "Sign in to TipIn Scoring to review this game's roster and lineup."
                : "Once your invitation is accepted, you can return to TipIn Scoring to manage your roster and lineup.";
            var button = hasTeamAccess ? "Review Your Lineup" : invite.ReusedPendingInvitation ? "Open Coach Site" : "Set Up Your Roster";
            const string fanText = "Family, friends, and fans can follow game scoring and view rosters on TipIn GameView.";
            var ignore = reminderType == null
                ? "If you weren\u2019t expecting this invitation, you can safely ignore this email."
                : "If this reminder no longer applies to you, contact info@tipinscoring.com.";
            static string H(string value) => WebUtility.HtmlEncode(value);
            var request = new EmailSendRequest
            {
                To = { invite.Email },
                Subject = subject.Replace('\r', ' ').Replace('\n', ' '),
                BodyText = $"{intro}\n\n{details}{steps}\n\n{button}: {link}\n\n{pendingText}\n\n{expiryText}\n\n{returning}\n\n"
                    + $"Share GameView with your fans\n\n{fanText}\nVisit {GameViewUrl} or scan the QR code in the HTML email.\n\n"
                    + $"Questions? Email info@tipinscoring.com.\n\n{ignore}\n\nTipIn Scoring",
                BodyHtml = $"""
                    <!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
                    <body style="margin:0;background:#eef1f5;color:#0b1424;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
                    <div style="max-width:600px;margin:auto;background:#ffffff">
                    <div style="background:#0b1424;border-bottom:5px solid #ff7b00;padding:24px;text-align:center">
                    <img src="cid:{LogoContentId}" width="120" alt="TipIn Scoring" style="display:block;width:120px;max-width:100%;height:auto;margin:auto" />
                    <p style="color:#ffffff;font-size:20px;font-weight:bold;margin:12px 0 0">Tip<span style="color:#ff7b00">In</span> Scoring</p></div>
                    <div style="padding:24px">
                    <p>{H(intro)}</p>
                    {(game == null ? "" : $"<h2>Game Details</h2><p>{H(details.Replace("Game Details\n\n", "").TrimEnd()).Replace("\n", "<br />")}</p>")}
                    <h2>Get your team ready for game day:</h2>
                    <ol><li>{H(firstStep)}</li><li>Review and update your roster.</li>
                    <li>Set your active players and starting lineup.</li><li>Sign and lock your lineup when complete.</li></ol>
                    <p><a href="{H(link)}" style="display:inline-block;background:#ff7b00;color:#0b1424;padding:14px 20px;text-decoration:none;font-weight:bold;border-radius:6px">{H(button)}</a></p>
                    {(pendingText.Length == 0 ? "" : $"<p>{H(pendingText)}</p>")}
                    <p>{H(expiryText)}</p><p>{H(returning)}</p>
                    <h2>Share GameView with your fans</h2><p>{H(fanText)}</p>
                    <p>Visit <a href="{GameViewUrl}">gameview.tipinscoring.com</a> or scan the QR code below.</p>
                    <p><a href="{GameViewUrl}"><img src="cid:{QrContentId}" width="180" height="180" alt="QR code for TipIn GameView: {GameViewUrl}" /></a></p>
                    <p>Questions? Email <a href="mailto:info@tipinscoring.com">info@tipinscoring.com</a>.</p>
                    <p>{H(ignore)}</p><p><strong>TipIn Scoring</strong></p>
                    <p style="border-top:1px solid #d4dbe3;padding-top:16px;font-size:12px;color:#526078">&copy; {DateTime.UtcNow.Year} TipIn Scoring. All rights reserved.<br />TipIn Scoring&trade; is a trademark of Brad Hermsen.</p>
                    </div></div></body></html>
                    """
            };
            using var generator = new QRCodeGenerator();
            using var data = generator.CreateQrCode(GameViewUrl, QRCodeGenerator.ECCLevel.Q);
            using var png = new PngByteQRCode(data);
            request.InlineImages.Add(new EmailAttachment
            {
                ContentId = QrContentId, FileName = "tipin-gameview-qr.png", ContentType = "image/png",
                Content = png.GetGraphic(8)
            });
            request.InlineImages.Add(new EmailAttachment
            {
                ContentId = LogoContentId, FileName = "tipin-logo.png", ContentType = "image/png",
                Content = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Assets", "TipIn NoBG.png"))
            });
            return request;
        }
    }
}
