using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Mail;
using System.Threading.Tasks;
using Dapper;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using TipInAPI.Infrastructure.Database;
using TipInAPI.Services;

namespace TipInAPI.Functions
{
    public class GameManagerPilotFunctions
    {
        private readonly ISqlConnectionFactory _connectionFactory;
        private readonly IEmailService _emailService;
        private const string NotificationEmail = "info@tipinscoring.com";

        public GameManagerPilotFunctions(ISqlConnectionFactory connectionFactory, IEmailService emailService)
        {
            _connectionFactory = connectionFactory;
            _emailService = emailService;
        }

        [Function("SubmitGameManagerPilotInterest")]
        public async Task<HttpResponseData> SubmitGameManagerPilotInterest(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "public/game-manager/pilot-interest")] HttpRequestData req)
        {
            var payload = await req.ReadFromJsonAsync<PilotInterestRequest>();
            var validationError = Validate(payload);
            if (validationError != null)
            {
                var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                await badRequest.WriteAsJsonAsync(new { error = validationError });
                return badRequest;
            }

            using var connection = _connectionFactory.CreateConnection();
            await connection.ExecuteAsync(@"
                IF OBJECT_ID('dbo.GameManagerPilotInterests', 'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.GameManagerPilotInterests
                    (
                        PilotInterestId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_GameManagerPilotInterests PRIMARY KEY,
                        OrganizationName NVARCHAR(200) NOT NULL,
                        ContactName NVARCHAR(160) NOT NULL,
                        Email NVARCHAR(255) NOT NULL,
                        ContactRole NVARCHAR(120) NULL,
                        TeamCount INT NULL,
                        GatewayInterest NVARCHAR(40) NOT NULL,
                        Notes NVARCHAR(1200) NULL,
                        NotificationSentAtUtc DATETIME2 NULL,
                        NotificationError NVARCHAR(1000) NULL,
                        CreatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_GameManagerPilotInterests_CreatedAtUtc DEFAULT SYSUTCDATETIME()
                    );
                    CREATE INDEX IX_GameManagerPilotInterests_EmailCreated
                        ON dbo.GameManagerPilotInterests (Email, CreatedAtUtc DESC);
                END;
                IF COL_LENGTH('dbo.GameManagerPilotInterests', 'NotificationSentAtUtc') IS NULL
                    ALTER TABLE dbo.GameManagerPilotInterests ADD NotificationSentAtUtc DATETIME2 NULL;
                IF COL_LENGTH('dbo.GameManagerPilotInterests', 'NotificationError') IS NULL
                    ALTER TABLE dbo.GameManagerPilotInterests ADD NotificationError NVARCHAR(1000) NULL;");

            var email = payload!.Email.Trim().ToLowerInvariant();
            var recentSubmission = await connection.QueryFirstOrDefaultAsync<PilotInterestRow>(@"
                    SELECT TOP 1 PilotInterestId, NotificationSentAtUtc
                    FROM dbo.GameManagerPilotInterests
                    WHERE Email = @Email AND CreatedAtUtc >= DATEADD(MINUTE, -5, SYSUTCDATETIME())
                    ORDER BY CreatedAtUtc DESC;", new { Email = email });

            var pilotInterestId = recentSubmission?.PilotInterestId ?? Guid.NewGuid();
            if (recentSubmission == null)
            {
                await connection.ExecuteAsync(@"
                    INSERT INTO dbo.GameManagerPilotInterests
                        (PilotInterestId, OrganizationName, ContactName, Email, ContactRole, TeamCount, GatewayInterest, Notes, CreatedAtUtc)
                    VALUES
                        (@PilotInterestId, @OrganizationName, @ContactName, @Email, @ContactRole, @TeamCount, @GatewayInterest, @Notes, SYSUTCDATETIME());",
                    new
                    {
                        PilotInterestId = pilotInterestId,
                        OrganizationName = payload.OrganizationName.Trim(),
                        ContactName = payload.ContactName.Trim(),
                        Email = email,
                        ContactRole = NormalizeOptional(payload.ContactRole, 120),
                        TeamCount = payload.TeamCount is > 0 and <= 500 ? payload.TeamCount : null,
                        GatewayInterest = NormalizeGatewayInterest(payload.GatewayInterest),
                        Notes = NormalizeOptional(payload.Notes, 1200)
                    });
            }

            if (recentSubmission?.NotificationSentAtUtc == null)
            {
                try
                {
                    await _emailService.SendAsync(new EmailSendRequest
                    {
                        To = new List<string> { NotificationEmail },
                        Subject = $"TipIn Game Manager pilot interest — {payload.OrganizationName.Trim()}",
                        BodyText = BuildNotificationBody(payload, email)
                    });
                    await connection.ExecuteAsync(@"
                        UPDATE dbo.GameManagerPilotInterests
                        SET NotificationSentAtUtc = SYSUTCDATETIME(), NotificationError = NULL
                        WHERE PilotInterestId = @PilotInterestId;", new { PilotInterestId = pilotInterestId });
                }
                catch (Exception ex)
                {
                    await connection.ExecuteAsync(@"
                        UPDATE dbo.GameManagerPilotInterests
                        SET NotificationError = @NotificationError
                        WHERE PilotInterestId = @PilotInterestId;",
                        new { PilotInterestId = pilotInterestId, NotificationError = NormalizeOptional(ex.Message, 1000) });
                }
            }

            var response = req.CreateResponse(HttpStatusCode.Created);
            await response.WriteAsJsonAsync(new { message = "Thanks. We received your pilot interest and will follow up." });
            return response;
        }

        private static string? Validate(PilotInterestRequest? payload)
        {
            if (payload == null) return "Pilot interest details are required.";
            if (!string.IsNullOrWhiteSpace(payload.Website)) return "Unable to accept this submission.";
            if (string.IsNullOrWhiteSpace(payload.OrganizationName)) return "Organization name is required.";
            if (string.IsNullOrWhiteSpace(payload.ContactName)) return "Contact name is required.";
            if (string.IsNullOrWhiteSpace(payload.Email)) return "Email is required.";
            if (payload.OrganizationName.Trim().Length > 200 || payload.ContactName.Trim().Length > 160) return "One or more fields are too long.";
            try { _ = new MailAddress(payload.Email.Trim()); }
            catch (FormatException) { return "Enter a valid email address."; }
            return null;
        }

        private static string? NormalizeOptional(string? value, int maxLength)
        {
            var normalized = value?.Trim();
            if (string.IsNullOrWhiteSpace(normalized)) return null;
            return normalized.Length <= maxLength ? normalized : normalized[..maxLength];
        }

        private static string NormalizeGatewayInterest(string? value)
        {
            return value?.Trim().ToLowerInvariant() switch
            {
                "interested" => "Interested",
                "not-now" => "Not now",
                _ => "Unsure"
            };
        }

        private static string BuildNotificationBody(PilotInterestRequest payload, string email)
        {
            var teamCount = payload.TeamCount is > 0 and <= 500 ? payload.TeamCount.Value.ToString() : "Not provided";
            return $@"New TipIn Game Manager pilot inquiry

Organization: {payload.OrganizationName.Trim()}
Contact: {payload.ContactName.Trim()}
Email: {email}
Role: {NormalizeOptional(payload.ContactRole, 120) ?? "Not provided"}
Number of teams: {teamCount}
Gateway interest: {NormalizeGatewayInterest(payload.GatewayInterest)}

What they want to improve:
{NormalizeOptional(payload.Notes, 1200) ?? "Not provided"}
";
        }

        private sealed class PilotInterestRow
        {
            public Guid PilotInterestId { get; set; }
            public DateTime? NotificationSentAtUtc { get; set; }
        }

        private sealed class PilotInterestRequest
        {
            public string OrganizationName { get; set; } = string.Empty;
            public string ContactName { get; set; } = string.Empty;
            public string Email { get; set; } = string.Empty;
            public string? ContactRole { get; set; }
            public int? TeamCount { get; set; }
            public string? GatewayInterest { get; set; }
            public string? Notes { get; set; }
            public string? Website { get; set; }
        }
    }
}