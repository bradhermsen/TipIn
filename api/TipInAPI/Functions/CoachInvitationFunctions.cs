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
    public class CoachInvitationFunctions
    {
        private readonly ICoachInvitationService _service;
        private readonly IAuthorizationService _authorizationService;
        private readonly ITeamAuthorizationService _teamAuthorizationService;
        private readonly IEmailService _emailService;
        private readonly IConfiguration _config;
        private readonly ILogger<CoachInvitationFunctions> _logger;

        public CoachInvitationFunctions(
            ICoachInvitationService service,
            IAuthorizationService authorizationService,
            ITeamAuthorizationService teamAuthorizationService,
            IEmailService emailService,
            IConfiguration config,
            ILogger<CoachInvitationFunctions> logger)
        {
            _service = service;
            _authorizationService = authorizationService;
            _teamAuthorizationService = teamAuthorizationService;
            _emailService = emailService;
            _config = config;
            _logger = logger;
        }

        private sealed class CreateInviteRequest
        {
            public string? Email { get; set; }
        }

        private sealed class AcceptInviteRequest
        {
            public string? Token { get; set; }
            public string? Email { get; set; }
            public string? Password { get; set; }
            public string? FirstName { get; set; }
            public string? LastName { get; set; }
        }

        private static bool LooksLikeEmail(string? email)
        {
            if (string.IsNullOrWhiteSpace(email) || email.Length > 256) return false;
            var at = email.IndexOf('@');
            return at > 0 && at < email.Length - 3 && email.IndexOf('.', at) > at + 1 && !email.Contains(' ');
        }

        // =========================================================
        // POST teams/{teamId}/coach-invites  (admin)
        // =========================================================
        [Function("CreateCoachInvitation")]
        public async Task<HttpResponseData> Create(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "teams/{teamId:guid}/coach-invites")] HttpRequestData req,
            Guid teamId)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient role");

            var adminId = Guid.Parse(userId);
            if (!await _teamAuthorizationService.CanAdminInviteToTeamAsync(adminId, role, teamId))
                return await AuthorizationHelper.ForbiddenResponse(req, "Team is not in your organization and has no game against it");

            CreateInviteRequest? body;
            try { body = await req.ReadFromJsonAsync<CreateInviteRequest>(); }
            catch { return await AuthorizationHelper.BadRequestResponse(req, "Invalid JSON payload"); }

            if (!LooksLikeEmail(body?.Email))
                return await AuthorizationHelper.BadRequestResponse(req, "A valid email address is required");

            CreatedCoachInvitation invite;
            try
            {
                invite = await _service.CreateAsync(adminId, teamId, body!.Email!);
            }
            catch (InvalidOperationException ex)
            {
                return await AuthorizationHelper.BadRequestResponse(req, ex.Message);
            }

            var baseUrl = (_config["CoachApp:BaseUrl"] ?? "https://coach.tipinscoring.com").TrimEnd('/');
            // The token is in the URL fragment so it is not sent to servers or written to access logs
            var link = $"{baseUrl}/accept#token={invite.Token}";

            var emailSent = false;
            try
            {
                var settings = await _emailService.GetSettingsAsync();
                if (settings.Enabled)
                {
                    await _emailService.SendAsync(new EmailSendRequest
                    {
                        To = { invite.Email },
                        Subject = $"You're invited to coach {invite.TeamName} on TipIn Scoring",
                        BodyText =
                            $"You have been invited to manage the roster and game-day lineup for {invite.TeamName} on TipIn Scoring.\n\n" +
                            $"Accept your invitation: {link}\n\n" +
                            $"This link expires on {invite.ExpiresAtUtc:MMMM d, yyyy} and can be used once. " +
                            "If you were not expecting this invitation, you can ignore this email."
                    });
                    emailSent = true;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Coach invitation email failed for invitation {InvitationId}", invite.InvitationId);
            }

            var res = req.CreateResponse(HttpStatusCode.Created);
            await res.WriteAsJsonAsync(new
            {
                invitationId = invite.InvitationId,
                teamId = invite.TeamId,
                email = invite.Email,
                expiresAtUtc = invite.ExpiresAtUtc,
                link,
                emailSent
            });
            return res;
        }

        // =========================================================
        // GET teams/{teamId}/coach-invites  (admin)
        // =========================================================
        [Function("ListCoachInvitations")]
        public async Task<HttpResponseData> List(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "teams/{teamId:guid}/coach-invites")] HttpRequestData req,
            Guid teamId)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient role");

            if (!await _teamAuthorizationService.CanAdminInviteToTeamAsync(Guid.Parse(userId), role, teamId))
                return await AuthorizationHelper.ForbiddenResponse(req, "Team is not in your organization and has no game against it");

            var res = req.CreateResponse(HttpStatusCode.OK);
            await res.WriteAsJsonAsync(await _service.ListForTeamAsync(teamId));
            return res;
        }

        // =========================================================
        // POST coach-invites/{invitationId}/revoke  (admin)
        // =========================================================
        [Function("RevokeCoachInvitation")]
        public async Task<HttpResponseData> Revoke(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "coach-invites/{invitationId:guid}/revoke")] HttpRequestData req,
            Guid invitationId)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient role");

            var teamId = await _service.GetTeamIdAsync(invitationId);
            if (teamId == null || !await _teamAuthorizationService.CanAdminInviteToTeamAsync(Guid.Parse(userId), role, teamId.Value))
            {
                // Same answer whether the invite is missing or in another organization
                var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                await notFound.WriteAsJsonAsync(new { error = "Invitation not found" });
                return notFound;
            }

            var revoked = await _service.RevokeAsync(invitationId, Guid.Parse(userId));
            if (!revoked)
                return await AuthorizationHelper.BadRequestResponse(req, "Only pending invitations can be revoked");

            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        // =========================================================
        // POST coach-invites/accept  (anonymous; the token is the credential)
        // =========================================================
        [Function("AcceptCoachInvitation")]
        public async Task<HttpResponseData> Accept(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "coach-invites/accept")] HttpRequestData req)
        {
            AcceptInviteRequest? body;
            try { body = await req.ReadFromJsonAsync<AcceptInviteRequest>(); }
            catch { return await AuthorizationHelper.BadRequestResponse(req, "Invalid JSON payload"); }

            if (body == null || string.IsNullOrWhiteSpace(body.Token) || !LooksLikeEmail(body.Email))
                return await AuthorizationHelper.BadRequestResponse(req, "Invitation token and a valid email are required");

            AcceptInviteResult result;
            try
            {
                result = await _service.AcceptAsync(body.Token!, body.Email!, body.Password ?? "", body.FirstName, body.LastName);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Coach invitation acceptance failed");
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = "Could not accept the invitation. Please try again." });
                return error;
            }

            if (result.Status == AcceptInviteStatus.Accepted)
            {
                var ok = req.CreateResponse(HttpStatusCode.OK);
                await ok.WriteAsJsonAsync(new
                {
                    teamId = result.TeamId,
                    teamName = result.TeamName,
                    createdAccount = result.CreatedAccount
                });
                return ok;
            }

            var (status, code, message) = result.Status switch
            {
                AcceptInviteStatus.Expired => (HttpStatusCode.BadRequest, "expired", "This invitation has expired. Ask your administrator for a new one."),
                AcceptInviteStatus.Used => (HttpStatusCode.BadRequest, "used", "This invitation has already been used."),
                AcceptInviteStatus.Revoked => (HttpStatusCode.BadRequest, "revoked", "This invitation is no longer valid. Ask your administrator for a new one."),
                AcceptInviteStatus.WrongEmail => (HttpStatusCode.BadRequest, "wrong_email", "This invitation was sent to a different email address."),
                AcceptInviteStatus.InvalidCredentials => (HttpStatusCode.Unauthorized, "invalid_credentials", "The email or password is incorrect."),
                AcceptInviteStatus.WeakPassword => (HttpStatusCode.BadRequest, "weak_password", "Choose a password of at least 10 characters."),
                AcceptInviteStatus.MissingDetails => (HttpStatusCode.BadRequest, "missing_details", "First and last name are required."),
                _ => (HttpStatusCode.BadRequest, "invalid", "This invitation is not valid.")
            };

            var res = req.CreateResponse(status);
            await res.WriteAsJsonAsync(new { error = message, code });
            return res;
        }
    }
}
