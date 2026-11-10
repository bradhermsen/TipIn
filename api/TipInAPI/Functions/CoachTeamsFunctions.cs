using System;
using System.Net;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using TipInAPI.Services;
using TipInAPI.DTOs;
using TipInAPI.Infrastructure.Authorization;

namespace TipInAPI.Functions
{
    public class CoachTeamsFunctions
    {
        private readonly ICoachTeamsService _service;
        private readonly IAuthorizationService _authorizationService;
        private readonly ITeamAuthorizationService _teamAuthorizationService;

        public CoachTeamsFunctions(
            ICoachTeamsService service,
            IAuthorizationService authorizationService,
            ITeamAuthorizationService teamAuthorizationService)
        {
            _service = service;
            _authorizationService = authorizationService;
            _teamAuthorizationService = teamAuthorizationService;
        }

        // Host admins may also manage visiting coaches on teams they can invite to; the coach must be assigned to that team
        private async Task<bool> CanAdminTargetAsync(string adminUserId, string role, Guid teamId, Guid targetUserId)
        {
            var admin = Guid.Parse(adminUserId);
            if (await _teamAuthorizationService.CanAdminAccessTeamAsync(admin, role, teamId)
                && await _teamAuthorizationService.CanAdminAccessUserAsync(admin, role, targetUserId))
                return true;

            return await _teamAuthorizationService.CanAdminInviteToTeamAsync(admin, role, teamId)
                && (await _service.GetCoachesForTeamAsync(teamId)).Any(c => c.UserId == targetUserId);
        }

        [Function("AssignCoachToTeam")]
        public async Task<HttpResponseData> AssignCoachToTeam(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "coachteams/assign")] HttpRequestData req)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "Token required");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient role");

            AssignCoachDto? dto;

            try
            {
                dto = await req.ReadFromJsonAsync<AssignCoachDto>();
            }
            catch
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteStringAsync("Invalid JSON payload");
                return bad;
            }

            if (dto == null || dto.UserId == Guid.Empty || dto.TeamId == Guid.Empty)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteStringAsync("UserId and TeamId are required");
                return bad;
            }

            if (!await CanAdminTargetAsync(userId, role, dto.TeamId, dto.UserId))
                return await AuthorizationHelper.ForbiddenResponse(req, "Team and user must belong to your organization");

            await _service.AssignAsync(dto.UserId, dto.TeamId);

            return req.CreateResponse(HttpStatusCode.OK);
        }



        [Function("RemoveCoachFromTeam")]
        public async Task<HttpResponseData> RemoveCoachFromTeam(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "coachteams/remove")] HttpRequestData req)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "Token required");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient role");

            AssignCoachDto? body;
            try
            {
                body = await req.ReadFromJsonAsync<AssignCoachDto>();
            }
            catch
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteStringAsync("Invalid JSON payload");
                return bad;
            }

            if (body == null || body.UserId == Guid.Empty || body.TeamId == Guid.Empty)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteStringAsync("UserId and TeamId are required");
                return bad;
            }

            if (!await CanAdminTargetAsync(userId, role, body.TeamId, body.UserId))
                return await AuthorizationHelper.ForbiddenResponse(req, "Team and user must belong to your organization");

            await _service.RemoveAsync(body.UserId, body.TeamId);

            return req.CreateResponse(HttpStatusCode.OK);
        }

        [Function("GetTeamsForCoach")]
        public async Task<HttpResponseData> GetTeamsForCoach(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "coachteams/coach/{userId:guid}")] HttpRequestData req,
            Guid userId)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, user_id, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // SuperAdmin bypass - full access to see any coach's teams
            if (role == "SuperAdmin")
            {
                var result = await _service.GetTeamsForCoachAsync(userId);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(result);
                return response;
            }

            // Coaches can only view their own teams
            if (!_authorizationService.HasAnyRole(role, "Coach", "TeamManager", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view coach teams");

            if (Guid.Parse(user_id) != userId && !_authorizationService.HasAnyRole(role, "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "You can only view your own teams");

            if (role == "OrgAdmin" && Guid.Parse(user_id) != userId &&
                !await _teamAuthorizationService.CanAdminAccessUserAsync(Guid.Parse(user_id), role, userId))
                return await AuthorizationHelper.ForbiddenResponse(req, "User is not in your organization");

            var data = await _service.GetTeamsForCoachAsync(userId);
            var res = req.CreateResponse(HttpStatusCode.OK);
            await res.WriteAsJsonAsync(data);
            return res;
        }

        [Function("GetCoachesForTeam")]
        public async Task<HttpResponseData> GetCoachesForTeam(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "coachteams/team/{teamId:guid}")] HttpRequestData req,
            Guid teamId)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // SuperAdmin bypass - full access to view any team's coaches
            if (role == "SuperAdmin")
            {
                var result = await _service.GetCoachesForTeamAsync(teamId);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(result);
                return response;
            }

            // Other roles can view team coaches
            if (!_authorizationService.HasAnyRole(role, "Coach", "TeamManager", "OrgAdmin", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view team coaches");

            // Coaches and team managers can only view coaches of their own teams
            if (role == "OrgAdmin" &&
                !await _teamAuthorizationService.CanAdminInviteToTeamAsync(Guid.Parse(userId), role, teamId))
                return await AuthorizationHelper.ForbiddenResponse(req, "Team is not in your organization");
            if (_authorizationService.HasAnyRole(role, "Coach", "TeamManager"))
            {
                var assigned = await _teamAuthorizationService.IsUserAssignedToTeamAsync(Guid.Parse(userId), teamId, _service);
                if (!assigned)
                    return await AuthorizationHelper.ForbiddenResponse(req, "You are not assigned to this team");
            }

            var data = await _service.GetCoachesForTeamAsync(teamId);
            var res = req.CreateResponse(HttpStatusCode.OK);
            await res.WriteAsJsonAsync(data);
            return res;
        }
    }
}
