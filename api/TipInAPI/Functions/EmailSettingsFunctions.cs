using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Mail;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using TipInAPI.Infrastructure.Authorization;
using TipInAPI.Services;

namespace TipInAPI.Functions
{
    public class EmailSettingsFunctions
    {
        private readonly IAuthorizationService _authorizationService;
        private readonly IEmailService _emailService;

        public EmailSettingsFunctions(
            IAuthorizationService authorizationService,
            IEmailService emailService)
        {
            _authorizationService = authorizationService;
            _emailService = emailService;
        }

        [Function("GetEmailSettings")]
        public async Task<HttpResponseData> GetEmailSettings(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "email/settings")] HttpRequestData req)
        {
            var denied = await ValidateAdminAccess(req);
            if (denied != null) return denied;

            var settings = await _emailService.GetSettingsAsync(includeSecret: false);
            var mediaOutlets = await _emailService.GetMediaOutletsAsync();

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                settings.Enabled,
                settings.SmtpHost,
                settings.SmtpPort,
                settings.UseSsl,
                settings.Username,
                hasPassword = settings.HasPassword,
                settings.FromAddress,
                settings.FromName,
                MediaOutlets = mediaOutlets
            });
            return response;
        }

        [Function("UpdateEmailSettings")]
        public async Task<HttpResponseData> UpdateEmailSettings(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "email/settings")] HttpRequestData req)
        {
            var denied = await ValidateAdminAccess(req);
            if (denied != null) return denied;

            var payload = await req.ReadFromJsonAsync<UpdateEmailSettingsRequest>();
            if (payload == null)
            {
                return await AuthorizationHelper.BadRequestResponse(req, "Missing settings payload.");
            }

            var mediaOutlets = payload.MediaOutlets
                ?.Where(item => item != null)
                .Select(item => new MediaOutletRecipient
                {
                    Name = (item.Name ?? string.Empty).Trim(),
                    Email = (item.Email ?? string.Empty).Trim()
                })
                .Where(item => !string.IsNullOrWhiteSpace(item.Email) && IsValidEmail(item.Email))
                .ToList();

            var saved = await _emailService.SaveSettingsAsync(new EmailServerSettings
            {
                Enabled = payload.Enabled,
                SmtpHost = payload.SmtpHost ?? "",
                SmtpPort = payload.SmtpPort,
                UseSsl = payload.UseSsl,
                Username = payload.Username,
                Password = payload.Password,
                FromAddress = payload.FromAddress ?? "",
                FromName = payload.FromName ?? "",
            });

            IReadOnlyList<MediaOutletRecipient> savedMediaOutlets;
            if (mediaOutlets == null)
            {
                savedMediaOutlets = await _emailService.GetMediaOutletsAsync();
            }
            else
            {
                savedMediaOutlets = await _emailService.SaveMediaOutletsAsync(mediaOutlets);
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                saved.Enabled,
                saved.SmtpHost,
                saved.SmtpPort,
                saved.UseSsl,
                saved.Username,
                hasPassword = saved.HasPassword,
                saved.FromAddress,
                saved.FromName,
                MediaOutlets = savedMediaOutlets
            });
            return response;
        }

        [Function("GetEmailMediaOutlets")]
        public async Task<HttpResponseData> GetEmailMediaOutlets(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "email/media-outlets")] HttpRequestData req)
        {
            var denied = await ValidateAdminAccess(req);
            if (denied != null) return denied;

            var outlets = await _emailService.GetMediaOutletsAsync();
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(outlets);
            return response;
        }

        [Function("UpdateEmailMediaOutlets")]
        public async Task<HttpResponseData> UpdateEmailMediaOutlets(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "email/media-outlets")] HttpRequestData req)
        {
            var denied = await ValidateAdminAccess(req);
            if (denied != null) return denied;

            var payload = await req.ReadFromJsonAsync<UpdateMediaOutletsRequest>();
            if (payload == null)
            {
                return await AuthorizationHelper.BadRequestResponse(req, "Missing media outlets payload.");
            }

            var normalizedMediaOutlets = (payload.MediaOutlets ?? new List<MediaOutletRequest>())
                .Where(item => item != null)
                .Select(item => new MediaOutletRecipient
                {
                    Name = (item.Name ?? string.Empty).Trim(),
                    Email = (item.Email ?? string.Empty).Trim()
                })
                .Where(item => !string.IsNullOrWhiteSpace(item.Email))
                .ToList();

            var invalidOutlet = normalizedMediaOutlets
                .FirstOrDefault(outlet => !IsValidEmail(outlet.Email));

            if (invalidOutlet != null)
            {
                return await AuthorizationHelper.BadRequestResponse(req, $"Invalid media outlet email: {invalidOutlet.Email}");
            }

            var saved = await _emailService.SaveMediaOutletsAsync(normalizedMediaOutlets);

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(saved);
            return response;
        }

        [Function("SendEmailSettingsTest")]
        public async Task<HttpResponseData> SendEmailSettingsTest(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "email/settings/test")] HttpRequestData req)
        {
            var denied = await ValidateAdminAccess(req);
            if (denied != null) return denied;

            var payload = await req.ReadFromJsonAsync<SendTestEmailRequest>();
            if (payload == null || string.IsNullOrWhiteSpace(payload.To))
            {
                return await AuthorizationHelper.BadRequestResponse(req, "A recipient email is required.");
            }

            try
            {
                await _emailService.SendAsync(new EmailSendRequest
                {
                    To = new List<string> { payload.To.Trim() },
                    Subject = string.IsNullOrWhiteSpace(payload.Subject)
                        ? "TipIn Scoring Email Settings Test"
                        : payload.Subject.Trim(),
                    BodyText = string.IsNullOrWhiteSpace(payload.Body)
                        ? "This is a test email from TipIn Admin Settings."
                        : payload.Body.Trim()
                });

                var ok = req.CreateResponse(HttpStatusCode.OK);
                await ok.WriteAsJsonAsync(new { sent = true });
                return ok;
            }
            catch (Exception ex)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { sent = false, error = ex.Message });
                return bad;
            }
        }

        private async Task<HttpResponseData?> ValidateAdminAccess(HttpRequestData req)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrWhiteSpace(token))
            {
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");
            }

            var (isValid, _, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
            {
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");
            }

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
            {
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to manage email settings");
            }

            return null;
        }

        private static bool IsValidEmail(string email)
        {
            try
            {
                _ = new MailAddress(email);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private class UpdateEmailSettingsRequest
        {
            public bool Enabled { get; set; }
            public string? SmtpHost { get; set; }
            public int SmtpPort { get; set; }
            public bool UseSsl { get; set; }
            public string? Username { get; set; }
            public string? Password { get; set; }
            public string? FromAddress { get; set; }
            public string? FromName { get; set; }
            public List<MediaOutletRequest>? MediaOutlets { get; set; }
        }

        private class UpdateMediaOutletsRequest
        {
            public List<MediaOutletRequest>? MediaOutlets { get; set; }
        }

        private class MediaOutletRequest
        {
            public string? Name { get; set; }
            public string? Email { get; set; }
        }

        private class SendTestEmailRequest
        {
            public string? To { get; set; }
            public string? Subject { get; set; }
            public string? Body { get; set; }
        }
    }
}