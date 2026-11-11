using System.Net;
using System;
using System.Globalization;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Configuration;
using TipInAPI.Infrastructure.Authorization;
using TipInAPI.Services;

namespace TipInAPI.Functions
{
    public sealed class CoachEmailAutomationFunctions
    {
        private readonly IAuthorizationService _auth;
        private readonly ICoachEmailAutomationSettingsService _settings;
        private readonly IConfiguration _config;
        private readonly ICoachEmailLogService _log;
        public CoachEmailAutomationFunctions(IAuthorizationService auth, ICoachEmailAutomationSettingsService settings, IConfiguration config,
            ICoachEmailLogService log)
        {
            _auth = auth; _settings = settings; _config = config; _log = log;
        }

        private async Task<HttpResponseData?> AuthorizeAsync(HttpRequestData req)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token)) return await AuthorizationHelper.UnauthorizedResponse(req, "Sign in is required.");
            var (valid, _, role) = _auth.ValidateToken(token);
            if (!valid) return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token.");
            if (!_auth.HasAnyRole(role, "SuperAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin can manage global email automation.");
            return null;
        }

        [Function("GetCoachEmailAutomationSettings")]
        public async Task<HttpResponseData> Get(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "email/automation")] HttpRequestData req,
            CancellationToken cancellationToken)
        {
            var denied = await AuthorizeAsync(req);
            if (denied != null) return denied;
            var settings = await _settings.GetAsync(cancellationToken);
            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add("Cache-Control", "no-store");
            await response.WriteAsJsonAsync(new
            {
                settings.AutomaticInvitations, settings.RosterReminders, settings.LineupReminders,
                deploymentPaused = _config.GetValue<bool?>("CoachReminders:Enabled") == false
            }, cancellationToken);
            return response;
        }

        [Function("SaveCoachEmailAutomationSettings")]
        public async Task<HttpResponseData> Put(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "email/automation")] HttpRequestData req,
            CancellationToken cancellationToken)
        {
            var denied = await AuthorizeAsync(req);
            if (denied != null) return denied;
            CoachEmailAutomationSettings? settings;
            try
            {
                settings = await JsonSerializer.DeserializeAsync<CoachEmailAutomationSettings>(req.Body,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }, cancellationToken);
            }
            catch (JsonException) { return await AuthorizationHelper.BadRequestResponse(req, "Invalid automation settings JSON."); }
            if (settings == null) return await AuthorizationHelper.BadRequestResponse(req, "Automation settings are required.");
            await _settings.SaveAsync(settings, cancellationToken);
            return await Get(req, cancellationToken);
        }

        [Function("GetCoachEmailLog")]
        public async Task<HttpResponseData> GetLog(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "email/automation/log")] HttpRequestData req,
            CancellationToken cancellationToken)
        {
            var denied = await AuthorizeAsync(req);
            if (denied != null) return denied;
            var dateText = req.Query["date"];
            var date = DateOnly.FromDateTime(CoachReminderSchedule.LocalNow(DateTime.UtcNow));
            if (dateText != null && (!DateOnly.TryParseExact(dateText, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out date) || date.Year < 2000 || date.Year > 9998))
                return await AuthorizationHelper.BadRequestResponse(req, "Date must be yyyy-MM-dd between 2000 and 9998 (Central Time).");
            var pageText = req.Query["page"];
            var page = 1;
            if (pageText != null && (!int.TryParse(pageText, NumberStyles.None, CultureInfo.InvariantCulture, out page)
                || page < 1 || page > 10000))
                return await AuthorizationHelper.BadRequestResponse(req, "Page must be between 1 and 10000.");
            var result = await _log.GetAsync(date, page, cancellationToken);
            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add("Cache-Control", "no-store");
            await response.WriteAsJsonAsync(result, cancellationToken);
            return response;
        }
    }
}
