using System;
using System.Globalization;
using System.Linq;
using System.Net;
using QRCoder;

namespace TipInAPI.Services
{
    public static class CoachInvitationEmail
    {
        public const string GameViewUrl = "https://gameview.tipinscoring.com";
        private const string QrContentId = "tipin-gameview-qr";

        public static EmailSendRequest Create(CreatedCoachInvitation invite, string link)
        {
            var culture = CultureInfo.GetCultureInfo("en-US");
            var game = invite.Game;
            var hockey = string.Join(" ", new[] { game?.TeamType, game?.LevelName, "Hockey" }
                .Where(s => !string.IsNullOrWhiteSpace(s)));
            var subject = game == null
                ? $"{invite.TeamDisplayName} Hockey \u2013 Set Your Roster"
                : $"{game.AwayTeamName} vs. {game.HomeTeamName} {hockey} \u2013 Set Your Roster";
            var intro = $"You\u2019ve been invited to manage the {invite.TeamDisplayName} roster"
                + (game == null ? "" : " for your upcoming game") + " on TipIn Scoring.";
            var expiry = invite.ExpiresAtUtc.ToString("MMMM d, yyyy", culture);
            var details = game == null ? ""
                : $"Game Details\n\n{game.AwayTeamName} at {game.HomeTeamName}\n"
                + $"{game.GameDateTime.ToString("dddd, MMMM d, yyyy", culture)} \u2022 {game.GameDateTime.ToString("h:mm tt", culture)} Central\n"
                + $"{(string.IsNullOrWhiteSpace(game.ArenaName) ? "Venue to be confirmed" : game.ArenaName)}"
                + (string.IsNullOrWhiteSpace(game.RinkName) ? "" : $" \u2014 {game.RinkName}")
                + $"\n{hockey}\n\n";
            const string steps = "Get your team ready for game day:\n\n1. Accept your TipIn invitation.\n"
                + "2. Review and update your roster.\n3. Set your active players and starting lineup.\n"
                + "4. Sign and lock your lineup when complete.";
            var expiryText = $"Your invitation link expires on {expiry} and can be used once.";
            const string returning = "Once your invitation is accepted, you can return to TipIn Scoring to manage your roster and lineup.";
            const string fanText = "Family, friends, and fans can follow game scoring and view rosters on TipIn GameView.";
            const string ignore = "If you weren\u2019t expecting this invitation, you can safely ignore this email.";
            static string H(string value) => WebUtility.HtmlEncode(value);
            var request = new EmailSendRequest
            {
                To = { invite.Email },
                Subject = subject.Replace('\r', ' ').Replace('\n', ' '),
                BodyText = $"{intro}\n\n{details}{steps}\n\nSet Up Your Roster: {link}\n\n{expiryText}\n\n{returning}\n\n"
                    + $"Share GameView with your fans\n\n{fanText}\nVisit {GameViewUrl} or scan the QR code in the HTML email.\n\n"
                    + $"Questions? Email info@tipinscoring.com.\n\n{ignore}\n\nTipIn Scoring",
                BodyHtml = $"""
                    <!doctype html><html lang="en"><body style="margin:0;background:#ffffff;color:#0b1424;font-family:Arial,sans-serif">
                    <div style="max-width:600px;margin:auto;padding:24px">
                    <h1 style="color:#0b1424">TipIn Scoring</h1>
                    <p>{H(intro)}</p>
                    {(game == null ? "" : $"<h2>Game Details</h2><p>{H(details.Replace("Game Details\n\n", "").TrimEnd()).Replace("\n", "<br />")}</p>")}
                    <h2>Get your team ready for game day:</h2>
                    <ol><li>Accept your TipIn invitation.</li><li>Review and update your roster.</li>
                    <li>Set your active players and starting lineup.</li><li>Sign and lock your lineup when complete.</li></ol>
                    <p><a href="{H(link)}" style="display:inline-block;background:#ff7b00;color:#0b1424;padding:14px 20px;text-decoration:none;font-weight:bold;border-radius:6px">Set Up Your Roster</a></p>
                    <p>{H(expiryText)}</p><p>{H(returning)}</p>
                    <h2>Share GameView with your fans</h2><p>{H(fanText)}</p>
                    <p>Visit <a href="{GameViewUrl}">gameview.tipinscoring.com</a> or scan the QR code below.</p>
                    <p><a href="{GameViewUrl}"><img src="cid:{QrContentId}" width="180" height="180" alt="QR code for TipIn GameView: {GameViewUrl}" /></a></p>
                    <p>Questions? Email <a href="mailto:info@tipinscoring.com">info@tipinscoring.com</a>.</p>
                    <p>{H(ignore)}</p><p><strong>TipIn Scoring</strong></p>
                    </div></body></html>
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
            return request;
        }
    }
}
