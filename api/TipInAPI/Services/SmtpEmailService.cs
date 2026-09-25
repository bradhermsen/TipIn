using System;
using System.Data;
using System.Linq;
using System.Net;
using System.Net.Mail;
using System.Threading.Tasks;
using System.Collections.Generic;
using Dapper;
using Microsoft.Extensions.Configuration;
using TipInAPI.Infrastructure.Database;

namespace TipInAPI.Services
{
    public class SmtpEmailService : IEmailService
    {
        private readonly ISqlConnectionFactory _connectionFactory;
        private readonly IConfiguration _configuration;

        public SmtpEmailService(
            ISqlConnectionFactory connectionFactory,
            IConfiguration configuration)
        {
            _connectionFactory = connectionFactory;
            _configuration = configuration;
        }

        public async Task<EmailServerSettings> GetSettingsAsync(bool includeSecret = false)
        {
            using var conn = _connectionFactory.CreateConnection();
            await EnsureTablesAsync(conn);

            const string sql = @"
                SELECT TOP 1
                    Enabled,
                    SmtpHost,
                    SmtpPort,
                    UseSsl,
                    Username,
                    SmtpPassword AS Password,
                    FromAddress,
                    FromName
                FROM dbo.EmailServerSettings
                WHERE Id = 1;";

            var dbSettings = await conn.QueryFirstOrDefaultAsync<EmailServerSettings>(sql);
            var merged = MergeWithDefaults(dbSettings);

            if (!includeSecret)
            {
                merged.Password = null;
            }

            return merged;
        }

        public async Task<EmailServerSettings> SaveSettingsAsync(EmailServerSettings settings)
        {
            using var conn = _connectionFactory.CreateConnection();
            await EnsureTablesAsync(conn);

            var existing = await GetSettingsAsync(includeSecret: true);
            var normalized = NormalizeForSave(settings, existing);

            const string upsertSql = @"
                MERGE dbo.EmailServerSettings AS target
                USING (SELECT CAST(1 AS INT) AS Id) AS source
                ON target.Id = source.Id
                WHEN MATCHED THEN
                    UPDATE SET
                        Enabled = @Enabled,
                        SmtpHost = @SmtpHost,
                        SmtpPort = @SmtpPort,
                        UseSsl = @UseSsl,
                        Username = @Username,
                        SmtpPassword = @Password,
                        FromAddress = @FromAddress,
                        FromName = @FromName,
                        UpdatedAt = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN
                    INSERT
                    (
                        Id,
                        Enabled,
                        SmtpHost,
                        SmtpPort,
                        UseSsl,
                        Username,
                        SmtpPassword,
                        FromAddress,
                        FromName,
                        CreatedAt,
                        UpdatedAt
                    )
                    VALUES
                    (
                        1,
                        @Enabled,
                        @SmtpHost,
                        @SmtpPort,
                        @UseSsl,
                        @Username,
                        @Password,
                        @FromAddress,
                        @FromName,
                        SYSUTCDATETIME(),
                        SYSUTCDATETIME()
                    );";

            await conn.ExecuteAsync(upsertSql, normalized);
            return await GetSettingsAsync(includeSecret: false);
        }

        public async Task<IReadOnlyList<MediaOutletRecipient>> GetMediaOutletsAsync()
        {
            using var conn = _connectionFactory.CreateConnection();
            await EnsureTablesAsync(conn);

            const string sql = @"
                SELECT
                    OutletName AS Name,
                    Email
                FROM dbo.EmailMediaOutlets
                WHERE IsActive = 1
                ORDER BY SortOrder, OutletName, Email;";

            var rows = await conn.QueryAsync<MediaOutletRecipient>(sql);
            return rows
                .Where(row => !string.IsNullOrWhiteSpace(row.Email))
                .Select(row => new MediaOutletRecipient
                {
                    Name = (row.Name ?? string.Empty).Trim(),
                    Email = row.Email.Trim()
                })
                .ToList();
        }

        public async Task<IReadOnlyList<MediaOutletRecipient>> SaveMediaOutletsAsync(IEnumerable<MediaOutletRecipient> outlets)
        {
            using var conn = _connectionFactory.CreateConnection();
            await EnsureTablesAsync(conn);

            var normalized = (outlets ?? Array.Empty<MediaOutletRecipient>())
                .Where(item => item != null && !string.IsNullOrWhiteSpace(item.Email))
                .Select(item => new MediaOutletRecipient
                {
                    Name = (item.Name ?? string.Empty).Trim(),
                    Email = item.Email.Trim()
                })
                .Where(item => item.Email.Length > 0)
                .GroupBy(item => item.Email, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .ToList();

            using var tx = conn.BeginTransaction();

            await conn.ExecuteAsync("DELETE FROM dbo.EmailMediaOutlets;", transaction: tx);

            const string insertSql = @"
                INSERT INTO dbo.EmailMediaOutlets
                (
                    MediaOutletId,
                    OutletName,
                    Email,
                    IsActive,
                    SortOrder,
                    CreatedAt,
                    UpdatedAt
                )
                VALUES
                (
                    NEWID(),
                    @OutletName,
                    @Email,
                    1,
                    @SortOrder,
                    SYSUTCDATETIME(),
                    SYSUTCDATETIME()
                );";

            for (var i = 0; i < normalized.Count; i++)
            {
                await conn.ExecuteAsync(
                    insertSql,
                    new
                    {
                        OutletName = string.IsNullOrWhiteSpace(normalized[i].Name)
                            ? "Media Outlet"
                            : normalized[i].Name,
                        normalized[i].Email,
                        SortOrder = i + 1
                    },
                    tx);
            }

            tx.Commit();
            return normalized;
        }

        public async Task SendAsync(EmailSendRequest request)
        {
            if (request == null)
            {
                throw new InvalidOperationException("Email request is required.");
            }

            var recipients = (request.To ?? new System.Collections.Generic.List<string>())
                .Where(email => !string.IsNullOrWhiteSpace(email))
                .Select(email => email.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (!recipients.Any())
            {
                throw new InvalidOperationException("At least one recipient email is required.");
            }

            var settings = await GetSettingsAsync(includeSecret: true);
            if (!settings.Enabled)
            {
                throw new InvalidOperationException("Email sending is disabled in settings.");
            }

            MailAddress fromAddress;
            try
            {
                fromAddress = new MailAddress(settings.FromAddress, settings.FromName);
            }
            catch (FormatException)
            {
                throw new InvalidOperationException($"SMTP From Address is invalid: {settings.FromAddress}");
            }

            var parsedRecipients = new List<MailAddress>();
            foreach (var recipient in recipients)
            {
                try
                {
                    parsedRecipients.Add(new MailAddress(recipient));
                }
                catch (FormatException)
                {
                    throw new InvalidOperationException($"Recipient email is invalid: {recipient}");
                }
            }

            using var message = new MailMessage
            {
                From = fromAddress,
                Subject = string.IsNullOrWhiteSpace(request.Subject) ? "TipIn Notification" : request.Subject,
                Body = request.BodyText ?? string.Empty,
                IsBodyHtml = false
            };

            foreach (var recipient in parsedRecipients)
            {
                message.To.Add(recipient);
            }

            foreach (var attachment in request.Attachments ?? new System.Collections.Generic.List<EmailAttachment>())
            {
                if (attachment?.Content == null || attachment.Content.Length == 0)
                {
                    continue;
                }

                var stream = new System.IO.MemoryStream(attachment.Content);
                var mailAttachment = new Attachment(
                    stream,
                    string.IsNullOrWhiteSpace(attachment.FileName) ? "attachment.bin" : attachment.FileName,
                    string.IsNullOrWhiteSpace(attachment.ContentType) ? "application/octet-stream" : attachment.ContentType);
                message.Attachments.Add(mailAttachment);
            }

            using var client = new SmtpClient(settings.SmtpHost, settings.SmtpPort)
            {
                EnableSsl = settings.UseSsl,
                DeliveryMethod = SmtpDeliveryMethod.Network,
                UseDefaultCredentials = false
            };

            if (!string.IsNullOrWhiteSpace(settings.Username))
            {
                client.Credentials = new NetworkCredential(
                    settings.Username,
                    settings.Password ?? string.Empty);
            }

            await client.SendMailAsync(message);
        }

        private EmailServerSettings MergeWithDefaults(EmailServerSettings? dbSettings)
        {
            var defaults = ReadDefaultsFromConfig();
            if (dbSettings == null)
            {
                return defaults;
            }

            return new EmailServerSettings
            {
                Enabled = dbSettings.Enabled,
                SmtpHost = string.IsNullOrWhiteSpace(dbSettings.SmtpHost) ? defaults.SmtpHost : dbSettings.SmtpHost,
                SmtpPort = dbSettings.SmtpPort > 0 ? dbSettings.SmtpPort : defaults.SmtpPort,
                UseSsl = dbSettings.UseSsl,
                Username = string.IsNullOrWhiteSpace(dbSettings.Username) ? defaults.Username : dbSettings.Username,
                Password = dbSettings.Password,
                FromAddress = string.IsNullOrWhiteSpace(dbSettings.FromAddress) ||
                    string.Equals(dbSettings.FromAddress, "no-reply@TipIn.local", StringComparison.OrdinalIgnoreCase)
                        ? defaults.FromAddress
                        : dbSettings.FromAddress,
                FromName = string.IsNullOrWhiteSpace(dbSettings.FromName) ||
                    string.Equals(dbSettings.FromName, "TipIn", StringComparison.OrdinalIgnoreCase)
                        ? defaults.FromName
                        : dbSettings.FromName
            };
        }

        private static EmailServerSettings NormalizeForSave(EmailServerSettings incoming, EmailServerSettings existing)
        {
            var normalized = new EmailServerSettings
            {
                Enabled = incoming.Enabled,
                SmtpHost = string.IsNullOrWhiteSpace(incoming.SmtpHost) ? existing.SmtpHost : incoming.SmtpHost.Trim(),
                SmtpPort = incoming.SmtpPort > 0 ? incoming.SmtpPort : existing.SmtpPort,
                UseSsl = incoming.UseSsl,
                Username = string.IsNullOrWhiteSpace(incoming.Username) ? null : incoming.Username.Trim(),
                Password = string.IsNullOrWhiteSpace(incoming.Password)
                    ? existing.Password
                    : incoming.Password,
                FromAddress = string.IsNullOrWhiteSpace(incoming.FromAddress) ? existing.FromAddress : incoming.FromAddress.Trim(),
                FromName = string.IsNullOrWhiteSpace(incoming.FromName) ? existing.FromName : incoming.FromName.Trim(),
            };

            return normalized;
        }

        private EmailServerSettings ReadDefaultsFromConfig()
        {
            var host = _configuration["Email:SmtpHost"];
            var portRaw = _configuration["Email:SmtpPort"];
            var sslRaw = _configuration["Email:UseSsl"];
            var enabledRaw = _configuration["Email:Enabled"];

            var parsedPort = 1025;
            if (!string.IsNullOrWhiteSpace(portRaw) && int.TryParse(portRaw, out var portValue) && portValue > 0)
            {
                parsedPort = portValue;
            }

            var useSsl = false;
            if (!string.IsNullOrWhiteSpace(sslRaw) && bool.TryParse(sslRaw, out var sslValue))
            {
                useSsl = sslValue;
            }

            var enabled = true;
            if (!string.IsNullOrWhiteSpace(enabledRaw) && bool.TryParse(enabledRaw, out var enabledValue))
            {
                enabled = enabledValue;
            }

            return new EmailServerSettings
            {
                Enabled = enabled,
                SmtpHost = string.IsNullOrWhiteSpace(host) ? "localhost" : host,
                SmtpPort = parsedPort,
                UseSsl = useSsl,
                Username = _configuration["Email:Username"],
                Password = _configuration["Email:Password"],
                FromAddress = string.IsNullOrWhiteSpace(_configuration["Email:FromAddress"])
                    ? "no-reply@tipinscoring.local"
                    : (_configuration["Email:FromAddress"] ?? "no-reply@tipinscoring.local"),
                FromName = string.IsNullOrWhiteSpace(_configuration["Email:FromName"])
                    ? "TipIn Scoring"
                    : (_configuration["Email:FromName"] ?? "TipIn Scoring")
            };
        }

        private static async Task EnsureTablesAsync(IDbConnection conn)
        {
            const string sql = @"
                IF OBJECT_ID('dbo.EmailServerSettings', 'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.EmailServerSettings
                    (
                        Id INT NOT NULL PRIMARY KEY,
                        Enabled BIT NOT NULL CONSTRAINT DF_EmailServerSettings_Enabled DEFAULT 1,
                        SmtpHost NVARCHAR(255) NOT NULL,
                        SmtpPort INT NOT NULL,
                        UseSsl BIT NOT NULL CONSTRAINT DF_EmailServerSettings_UseSsl DEFAULT 0,
                        Username NVARCHAR(255) NULL,
                        SmtpPassword NVARCHAR(512) NULL,
                        FromAddress NVARCHAR(255) NOT NULL,
                        FromName NVARCHAR(255) NOT NULL,
                        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_EmailServerSettings_CreatedAt DEFAULT SYSUTCDATETIME(),
                        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_EmailServerSettings_UpdatedAt DEFAULT SYSUTCDATETIME()
                    );
                END;

                IF OBJECT_ID('dbo.EmailMediaOutlets', 'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.EmailMediaOutlets
                    (
                        MediaOutletId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_EmailMediaOutlets PRIMARY KEY,
                        OutletName NVARCHAR(255) NOT NULL,
                        Email NVARCHAR(255) NOT NULL,
                        IsActive BIT NOT NULL CONSTRAINT DF_EmailMediaOutlets_IsActive DEFAULT 1,
                        SortOrder INT NOT NULL CONSTRAINT DF_EmailMediaOutlets_SortOrder DEFAULT 0,
                        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_EmailMediaOutlets_CreatedAt DEFAULT SYSUTCDATETIME(),
                        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_EmailMediaOutlets_UpdatedAt DEFAULT SYSUTCDATETIME()
                    );
                END;";

            await conn.ExecuteAsync(sql);
        }
    }
}