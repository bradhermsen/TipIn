using System;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using TipInAPI.Services;
using TipInAPI.DTOs;
using TipInAPI.Infrastructure.Authorization;

namespace TipInAPI.Functions
{
    public class RosterEntryFunctions
    {
        private readonly IRosterEntriesService _service;
        private readonly ITeamsService _teamsService;
        private readonly IAuthorizationService _authorizationService;
        private readonly ITeamAuthorizationService _teamAuthorizationService;
        private readonly ICoachTeamsService _coachTeamsService;
        
        private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        };

        public RosterEntryFunctions(
            IRosterEntriesService service,
            ITeamsService teamsService,
            IAuthorizationService authorizationService,
            ITeamAuthorizationService teamAuthorizationService,
            ICoachTeamsService coachTeamsService)
        {
            _service = service;
            _teamsService = teamsService;
            _authorizationService = authorizationService;
            _teamAuthorizationService = teamAuthorizationService;
            _coachTeamsService = coachTeamsService;
        }

        // =========================================================
        // GET: /api/teams/{teamId}/roster
        // =========================================================
        [Function("GetRosterByTeam")]
        public async Task<HttpResponseData> GetRosterByTeam(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "teams/{teamId}/roster")]
            HttpRequestData req,
            Guid teamId)
        {
            var response = req.CreateResponse();

            try
            {
                // Validate authorization
                var token = AuthorizationHelper.ExtractBearerToken(req);
                if (string.IsNullOrEmpty(token))
                    return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

                var (isValid, userId, role) = _authorizationService.ValidateToken(token);
                if (!isValid)
                    return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

                // Only Coach and TeamManager can access roster (for their assigned teams)
                if (!_authorizationService.HasAnyRole(role, "Coach", "TeamManager", "SuperAdmin", "OrgAdmin"))
                    return await AuthorizationHelper.ForbiddenResponse(req, "Only Coach or TeamManager can access roster");

                // Coach/TeamManager must be assigned to this team
                if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                {
                    var isAssigned = await _teamAuthorizationService.IsUserAssignedToTeamAsync(Guid.Parse(userId), teamId, _coachTeamsService);
                    if (!isAssigned)
                        return await AuthorizationHelper.ForbiddenResponse(req, "You are not assigned to this team");
                }

                var roster = await _service.GetByTeamIdAsync(teamId);
                await response.WriteAsJsonAsync(roster);
            }
            catch (Exception ex)
            {
                response.StatusCode = System.Net.HttpStatusCode.BadRequest;
                await response.WriteAsJsonAsync(new { error = ex.Message });
            }

            return response;
        }

        // =========================================================
        // GET: /api/roster/{id}
        // =========================================================
        [Function("GetRosterEntryById")]
        public async Task<HttpResponseData> GetRosterEntryById(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "roster/{id}")]
            HttpRequestData req,
            Guid id)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // SuperAdmin bypass - full access
            if (role == "SuperAdmin")
            {
                var entry = await _service.GetByIdAsync(id);
                if (entry == null)
                {
                    var notFound = req.CreateResponse(System.Net.HttpStatusCode.NotFound);
                    await notFound.WriteAsJsonAsync(new { error = "Roster entry not found." });
                    return notFound;
                }
                var response = req.CreateResponse(System.Net.HttpStatusCode.OK);
                await response.WriteAsJsonAsync(entry);
                return response;
            }

            // Other roles can view roster entries
            if (!_authorizationService.HasAnyRole(role, "Coach", "TeamManager", "OrgAdmin", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view roster entry");

            var result = req.CreateResponse();
            var rosterEntry = await _service.GetByIdAsync(id);
            if (rosterEntry == null)
            {
                result.StatusCode = System.Net.HttpStatusCode.NotFound;
                await result.WriteAsJsonAsync(new { error = "Roster entry not found." });
                return result;
            }

            await result.WriteAsJsonAsync(rosterEntry);
            return result;
        }

        // =========================================================
        // POST: /api/roster
        // =========================================================
        [Function("CreateRosterEntry")]
        public async Task<HttpResponseData> CreateRosterEntry(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "roster")]
            HttpRequestData req)
        {
            var response = req.CreateResponse();

            try
            {
                // Validate authorization
                var token = AuthorizationHelper.ExtractBearerToken(req);
                if (string.IsNullOrEmpty(token))
                    return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

                var (isValid, userId, role) = _authorizationService.ValidateToken(token);
                if (!isValid)
                    return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

                // Only Coach and TeamManager can create roster entries
                if (!_authorizationService.HasAnyRole(role, "Coach", "TeamManager", "SuperAdmin", "OrgAdmin"))
                    return await AuthorizationHelper.ForbiddenResponse(req, "Only Coach or TeamManager can create roster entries");

                var dto = await JsonSerializer.DeserializeAsync<CreateRosterEntryDto>(req.Body, JsonOptions);

                if (dto == null)
                {
                    response.StatusCode = System.Net.HttpStatusCode.BadRequest;
                    await response.WriteAsJsonAsync(new { error = "Invalid request body." });
                    return response;
                }

                // Coach/TeamManager must be assigned to this team
                if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                {
                    var isAssigned = await _teamAuthorizationService.IsUserAssignedToTeamAsync(Guid.Parse(userId), dto.TeamId, _coachTeamsService);
                    if (!isAssigned)
                        return await AuthorizationHelper.ForbiddenResponse(req, "You are not assigned to this team");
                }

                var id = await _service.CreateAsync(dto);
                await response.WriteAsJsonAsync(new { id });
            }
            catch (Exception ex)
            {
                response.StatusCode = System.Net.HttpStatusCode.BadRequest;
                await response.WriteAsJsonAsync(new { error = ex.Message });
            }

            return response;
        }

        // =========================================================
        // PUT: /api/roster/{id}
        // =========================================================
        [Function("UpdateRosterEntry")]
        public async Task<HttpResponseData> UpdateRosterEntry(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "roster/{id}")]
            HttpRequestData req,
            Guid id)
        {
            var response = req.CreateResponse();

            try
            {
                // Validate authorization
                var token = AuthorizationHelper.ExtractBearerToken(req);
                if (string.IsNullOrEmpty(token))
                    return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

                var (isValid, userId, role) = _authorizationService.ValidateToken(token);
                if (!isValid)
                    return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

                // Only Coach and TeamManager can update roster entries
                if (!_authorizationService.HasAnyRole(role, "Coach", "TeamManager", "SuperAdmin", "OrgAdmin"))
                    return await AuthorizationHelper.ForbiddenResponse(req, "Only Coach or TeamManager can update roster entries");

                // Get the roster entry to check team assignment
                var rosterEntry = await _service.GetByIdAsync(id);
                if (rosterEntry != null && !_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                {
                    var isAssigned = await _teamAuthorizationService.IsUserAssignedToTeamAsync(Guid.Parse(userId), rosterEntry.TeamId, _coachTeamsService);
                    if (!isAssigned)
                        return await AuthorizationHelper.ForbiddenResponse(req, "You are not assigned to this team");
                }

                var dto = await JsonSerializer.DeserializeAsync<UpdateRosterEntryDto>(req.Body, JsonOptions);

                if (dto == null)
                {
                    response.StatusCode = System.Net.HttpStatusCode.BadRequest;
                    await response.WriteAsJsonAsync(new { error = "Invalid request body." });
                    return response;
                }

                await _service.UpdateAsync(id, dto);
                await response.WriteAsJsonAsync(new { success = true });
            }
            catch (Exception ex)
            {
                response.StatusCode = System.Net.HttpStatusCode.BadRequest;
                await response.WriteAsJsonAsync(new { error = ex.Message });
            }

            return response;
        }

        // =========================================================
        // DELETE: /api/roster/{id}
        // =========================================================
        [Function("DeleteRosterEntry")]
        public async Task<HttpResponseData> DeleteRosterEntry(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "roster/{id}")]
            HttpRequestData req,
            Guid id)
        {
            var response = req.CreateResponse();

            try
            {
                // Validate authorization
                var token = AuthorizationHelper.ExtractBearerToken(req);
                if (string.IsNullOrEmpty(token))
                    return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

                var (isValid, userId, role) = _authorizationService.ValidateToken(token);
                if (!isValid)
                    return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

                // Only Coach and TeamManager can delete roster entries
                if (!_authorizationService.HasAnyRole(role, "Coach", "TeamManager", "SuperAdmin", "OrgAdmin"))
                    return await AuthorizationHelper.ForbiddenResponse(req, "Only Coach or TeamManager can delete roster entries");

                // Get the roster entry to check team assignment
                var rosterEntry = await _service.GetByIdAsync(id);
                if (rosterEntry != null && !_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                {
                    var isAssigned = await _teamAuthorizationService.IsUserAssignedToTeamAsync(Guid.Parse(userId), rosterEntry.TeamId, _coachTeamsService);
                    if (!isAssigned)
                        return await AuthorizationHelper.ForbiddenResponse(req, "You are not assigned to this team");
                }

                await _service.DeleteAsync(id);
                await response.WriteAsJsonAsync(new { success = true });
            }
            catch (Exception ex)
            {
                response.StatusCode = System.Net.HttpStatusCode.BadRequest;
                await response.WriteAsJsonAsync(new { error = ex.Message });
            }

            return response;
        }

        // =========================================================
        // GET: /api/teams/{teamId}/available-players
        // =========================================================
        [Function("GetAvailablePlayersForTeam")]
        public async Task<HttpResponseData> GetAvailablePlayersForTeam(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "teams/{teamId}/available-players")]
            HttpRequestData req,
            Guid teamId)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            var response = req.CreateResponse();

            try
            {
                // SuperAdmin bypass - full access
                if (role == "SuperAdmin")
                {
                    var players = await _service.GetAvailablePlayersAsync(teamId);
                    await response.WriteAsJsonAsync(players);
                    return response;
                }

                // Other roles can view available players for teams
                if (!_authorizationService.HasAnyRole(role, "Coach", "TeamManager", "OrgAdmin", "Viewer"))
                    return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view available players");

                var availablePlayers = await _service.GetAvailablePlayersAsync(teamId);
                await response.WriteAsJsonAsync(availablePlayers);
            }
            catch (Exception ex)
            {
                response.StatusCode = System.Net.HttpStatusCode.BadRequest;
                await response.WriteAsJsonAsync(new { error = ex.Message });
            }

            return response;
        }
    }
}
