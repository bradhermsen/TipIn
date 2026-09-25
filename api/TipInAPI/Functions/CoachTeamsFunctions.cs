using System;
using System.Net;
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

        public CoachTeamsFunctions(ICoachTeamsService service, IAuthorizationService authorizationService)
        {
            _service = service;
            _authorizationService = authorizationService;
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

            var body = await req.ReadFromJsonAsync<dynamic>();
            Guid coachUserId = body.userId;
            Guid teamId = body.teamId;

            await _service.RemoveAsync(coachUserId, teamId);

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

            var data = await _service.GetCoachesForTeamAsync(teamId);
            var res = req.CreateResponse(HttpStatusCode.OK);
            await res.WriteAsJsonAsync(data);
            return res;
        }
    }
}
