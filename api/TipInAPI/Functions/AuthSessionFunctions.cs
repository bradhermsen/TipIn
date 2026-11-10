using System;
using System.Net;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using TipInAPI.Infrastructure.Authorization;
using TipInAPI.Services;

namespace TipInAPI.Functions
{
    public class AuthSessionFunctions
    {
        private readonly ISessionService _sessions;
        private readonly IEmailService _email;
        private readonly IConfiguration _config;
        private readonly ILogger<AuthSessionFunctions> _logger;

        public AuthSessionFunctions(
            ISessionService sessions,
            IEmailService email,
            IConfiguration config,
            ILogger<AuthSessionFunctions> logger)
        {
            _sessions = sessions;
            _email = email;
            _config = config;
            _logger = logger;
        }

        private sealed class RefreshRequest { public string? RefreshToken { get; set; } }
        private sealed class ForgotRequest { public string? Email { get; set; } }
        private sealed class ResetRequest { public string? Token { get; set; } public string? Password { get; set; } }

        [Function("AuthRefresh")]
        public async Task<HttpResponseData> Refresh(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "auth/refresh")] HttpRequestData req)
        {
            RefreshRequest? body;
            try { body = await req.ReadFromJsonAsync<RefreshRequest>(); }
            catch { return await AuthorizationHelper.BadRequestResponse(req, "Invalid JSON payload"); }

            var result = string.IsNullOrWhiteSpace(body?.RefreshToken) ? null : await _sessions.RotateAsync(body!.RefreshToken!);
            if (result == null)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Session expired. Please sign in again.");

            var res = req.CreateResponse(HttpStatusCode.OK);
            await res.WriteAsJsonAsync(new
            {
                token = result.AccessToken,
                refreshToken = result.RefreshToken,
                role = result.Role,
                userId = result.UserId
            });
            return res;
        }

        [Function("AuthLogout")]
        public async Task<HttpResponseData> Logout(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "auth/logout")] HttpRequestData req)
        {
            try
            {
                var body = await req.ReadFromJsonAsync<RefreshRequest>();
                if (!string.IsNullOrWhiteSpace(body?.RefreshToken))
                    await _sessions.RevokeAsync(body!.RefreshToken!);
            }
            catch { /* logging out must never fail the client */ }

            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        // Always answers 200 so the endpoint can't be used to discover which emails have accounts
        [Function("AuthForgotPassword")]
        public async Task<HttpResponseData> Forgot(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "auth/forgot-password")] HttpRequestData req)
        {
            try
            {
                var body = await req.ReadFromJsonAsync<ForgotRequest>();
                if (!string.IsNullOrWhiteSpace(body?.Email))
                {
                    var created = await _sessions.CreatePasswordResetAsync(body!.Email!);
                    if (created != null)
                    {
                        var baseUrl = (_config["CoachApp:BaseUrl"] ?? "https://coach.tipinscoring.com").TrimEnd('/');
                        var settings = await _email.GetSettingsAsync();
                        if (settings.Enabled)
                        {
                            await _email.SendAsync(new EmailSendRequest
                            {
                                To = { created.Value.Email },
                                Subject = "Reset your TipIn Scoring password",
                                BodyText =
                                    "We received a request to reset your TipIn Scoring password.\n\n" +
                                    $"Choose a new password: {baseUrl}/reset#token={created.Value.Token}\n\n" +
                                    "This link expires in 1 hour and can be used once. If you didn't ask for this, you can ignore this email."
                            });
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Password reset request failed");
            }

            var res = req.CreateResponse(HttpStatusCode.OK);
            await res.WriteAsJsonAsync(new { message = "If an account exists for that email, a reset link has been sent." });
            return res;
        }

        [Function("AuthResetPassword")]
        public async Task<HttpResponseData> Reset(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "auth/reset-password")] HttpRequestData req)
        {
            ResetRequest? body;
            try { body = await req.ReadFromJsonAsync<ResetRequest>(); }
            catch { return await AuthorizationHelper.BadRequestResponse(req, "Invalid JSON payload"); }

            if (string.IsNullOrWhiteSpace(body?.Token))
                return await AuthorizationHelper.BadRequestResponse(req, "Reset token is required");
            if (string.IsNullOrEmpty(body!.Password) || body.Password.Length < SessionService.MinPasswordLength)
                return await AuthorizationHelper.BadRequestResponse(req, $"Choose a password of at least {SessionService.MinPasswordLength} characters.");

            var ok = await _sessions.ResetPasswordAsync(body.Token!, body.Password);
            if (!ok)
                return await AuthorizationHelper.BadRequestResponse(req, "This reset link is invalid or has expired. Request a new one.");

            return req.CreateResponse(HttpStatusCode.NoContent);
        }
    }
}
