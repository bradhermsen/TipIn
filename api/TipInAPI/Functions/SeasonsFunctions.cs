using System;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using TipInAPI.DTOs;
using TipInAPI.Services;
using TipInAPI.Infrastructure.Authorization;

namespace TipInAPI.Functions
{
    public class SeasonsFunctions
    {
        private readonly ISeasonsService _service;
        private readonly IAuthorizationService _authorizationService;

        public SeasonsFunctions(ISeasonsService service, IAuthorizationService authorizationService)
        {
            _service = service;
            _authorizationService = authorizationService;
        }

        [Function("GetSeasons")]
        public async Task<HttpResponseData> GetSeasons(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "seasons")] HttpRequestData req)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // SuperAdmin bypass - full access to all seasons
            if (role == "SuperAdmin")
            {
                var seasons = await _service.GetAllAsync();
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(seasons);
                return response;
            }

            // Other roles can view seasons
            if (!_authorizationService.HasAnyRole(role, "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view seasons");

            var allSeasons = await _service.GetAllAsync();
            var result = req.CreateResponse(HttpStatusCode.OK);
            await result.WriteAsJsonAsync(allSeasons);
            return result;
        }

        [Function("GetSeasonById")]
        public async Task<HttpResponseData> GetSeasonById(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "seasons/{id:guid}")] HttpRequestData req,
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
                var season = await _service.GetByIdAsync(id);
                if (season == null)
                    return req.CreateResponse(HttpStatusCode.NotFound);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(season);
                return response;
            }

            // Other roles can view seasons
            if (!_authorizationService.HasAnyRole(role, "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view season details");

            var seasonData = await _service.GetByIdAsync(id);
            if (seasonData == null)
                return req.CreateResponse(HttpStatusCode.NotFound);
            var result = req.CreateResponse(HttpStatusCode.OK);
            await result.WriteAsJsonAsync(seasonData);
            return result;
        }

        [Function("CreateSeason")]
        public async Task<HttpResponseData> CreateSeason(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "seasons")] HttpRequestData req)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "Token required");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient role");

            var dto = await req.ReadFromJsonAsync<CreateSeasonDto>();

            if (dto == null || string.IsNullOrWhiteSpace(dto.SeasonName))
                return await AuthorizationHelper.BadRequestResponse(req, "Season name is required");

            if (dto.StartDate >= dto.EndDate)
                return await AuthorizationHelper.BadRequestResponse(req, "Season end date must be after the start date");

            var existingSeasons = await _service.GetAllAsync();
            if (existingSeasons.Any(season => string.Equals(season.SeasonName?.Trim(), dto.SeasonName.Trim(), StringComparison.OrdinalIgnoreCase)))
                return await AuthorizationHelper.BadRequestResponse(req, "A season with this name already exists");

            await _service.CreateAsync(dto);

            return req.CreateResponse(HttpStatusCode.Created);
        }

        [Function("UpdateSeason")]
        public async Task<HttpResponseData> UpdateSeason(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "seasons/{id:guid}")] HttpRequestData req,
            Guid id)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "Token required");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient role");

            var dto = await req.ReadFromJsonAsync<UpdateSeasonDto>();

            if (dto == null || string.IsNullOrWhiteSpace(dto.SeasonName))
                return await AuthorizationHelper.BadRequestResponse(req, "Season name is required");

            if (dto.StartDate >= dto.EndDate)
                return await AuthorizationHelper.BadRequestResponse(req, "Season end date must be after the start date");

            var existingSeasons = await _service.GetAllAsync();
            if (existingSeasons.Any(season => season.SeasonId != id && string.Equals(season.SeasonName?.Trim(), dto.SeasonName.Trim(), StringComparison.OrdinalIgnoreCase)))
                return await AuthorizationHelper.BadRequestResponse(req, "A season with this name already exists");

            await _service.UpdateAsync(id, dto);

            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        [Function("DeleteSeason")]
        public async Task<HttpResponseData> DeleteSeason(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "seasons/{id:guid}")] HttpRequestData req,
            Guid id)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "Token required");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient role");

            var season = await _service.GetByIdAsync(id);
            if (season == null)
                return req.CreateResponse(HttpStatusCode.NotFound);
            if (season.IsActive)
                return await AuthorizationHelper.BadRequestResponse(req, "Deactivate the season before deleting it");

            await _service.DeleteAsync(id);

            return req.CreateResponse(HttpStatusCode.NoContent);
        }
    }
}
