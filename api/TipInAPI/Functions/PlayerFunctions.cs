using System;
using System.Net;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using TipInAPI.DTOs;
using TipInAPI.Services;
using TipInAPI.Infrastructure.Authorization;

namespace TipInAPI.Functions
{
    public class PlayersFunctions
    {
        private readonly IPlayersService _service;
        private readonly IAuthorizationService _authorizationService;
        private readonly ITeamAuthorizationService _teamAuthorizationService;
        private readonly ICoachTeamsService _coachTeamsService;

        public PlayersFunctions(
            IPlayersService service,
            IAuthorizationService authorizationService,
            ITeamAuthorizationService teamAuthorizationService,
            ICoachTeamsService coachTeamsService)
        {
            _service = service;
            _authorizationService = authorizationService;
            _teamAuthorizationService = teamAuthorizationService;
            _coachTeamsService = coachTeamsService;
        }

        // =========================================================
        // GET ALL PLAYERS (DTO VERSION)
        // =========================================================
        [Function("GetPlayersDto")]
        public async Task<HttpResponseData> GetPlayersDto(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "players/dto")] HttpRequestData req)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // SuperAdmin bypass - full access to all players
            if (role == "SuperAdmin")
            {
                var players = await _service.GetAllDtosAsync();
                var res = req.CreateResponse(HttpStatusCode.OK);
                await res.WriteAsJsonAsync(players);
                return res;
            }

            // Other roles can view their assigned players
            if (!_authorizationService.HasAnyRole(role, "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view players");

            var allPlayers = await _service.GetAllDtosAsync();
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(allPlayers);
            return response;
        }

        // =========================================================
        // GET PLAYER BY ID
        // =========================================================
        // GET PLAYER BY ID
        // =========================================================
        [Function("GetPlayerById")]
        public async Task<HttpResponseData> GetPlayerById(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "players/{id:guid}")] HttpRequestData req,
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
                var player = await _service.GetByIdAsync(id);
                if (player == null)
                {
                    var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                    await notFound.WriteStringAsync("Player not found");
                    return notFound;
                }
                var res = req.CreateResponse(HttpStatusCode.OK);
                await res.WriteAsJsonAsync(player);
                return res;
            }

            // Other roles can view their assigned players
            if (!_authorizationService.HasAnyRole(role, "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view player details");

            var playerData = await _service.GetByIdAsync(id);
            if (playerData == null)
            {
                var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                await notFound.WriteStringAsync("Player not found");
                return notFound;
            }
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(playerData);
            return response;
        }

        // =========================================================
        // CREATE PLAYER
        // =========================================================
        [Function("CreatePlayer")]
        public async Task<HttpResponseData> CreatePlayer(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "players")] HttpRequestData req)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // Only SuperAdmin and OrgAdmin can create players
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin or OrgAdmin can create players");

            var dto = await req.ReadFromJsonAsync<CreatePlayerDto>();

            if (dto == null)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteStringAsync("Invalid payload");
                return bad;
            }

            var id = await _service.CreateAsync(dto);

            var res = req.CreateResponse(HttpStatusCode.Created);
            await res.WriteAsJsonAsync(new { id });
            return res;
        }

        // =========================================================
        // UPDATE PLAYER
        // =========================================================
        [Function("UpdatePlayer")]
        public async Task<HttpResponseData> UpdatePlayer(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "players/{id:guid}")] HttpRequestData req,
            Guid id)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // Only SuperAdmin, OrgAdmin, Coach, and TeamManager can update players
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin", "Coach", "TeamManager"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to update players");

            var dto = await req.ReadFromJsonAsync<UpdatePlayerDto>();

            if (dto == null)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteStringAsync("Invalid payload");
                return bad;
            }

            try
            {
                await _service.UpdateAsync(id, dto);
                return req.CreateResponse(HttpStatusCode.NoContent);
            }
            catch (Exception ex)
            {
                var error = req.CreateResponse(HttpStatusCode.InternalServerError);
                await error.WriteAsJsonAsync(new { error = ex.Message, innerError = ex.InnerException?.Message });
                return error;
            }
        }

        // =========================================================
        // DELETE PLAYER
        // =========================================================
        [Function("DeletePlayer")]
        public async Task<HttpResponseData> DeletePlayer(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "players/{id:guid}")] HttpRequestData req,
            Guid id)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // Only SuperAdmin and OrgAdmin can delete players
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin or OrgAdmin can delete players");

            await _service.DeleteAsync(id);
            return req.CreateResponse(HttpStatusCode.NoContent);
        }
    }
}
