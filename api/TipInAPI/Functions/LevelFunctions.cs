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
    public class LevelFunctions
    {
        private readonly ILevelsService _service;
        private readonly IAuthorizationService _authorizationService;

        public LevelFunctions(ILevelsService service, IAuthorizationService authorizationService)
        {
            _service = service;
            _authorizationService = authorizationService;
        }

        [Function("GetLevels")]
        public async Task<HttpResponseData> GetLevels(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "levels")] HttpRequestData req)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // SuperAdmin bypass - full access to all levels
            if (role == "SuperAdmin")
            {
                var levels = await _service.GetAllAsync();
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(levels);
                return response;
            }

            // Other roles can view levels
            if (!_authorizationService.HasAnyRole(role, "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view levels");

            var allLevels = await _service.GetAllAsync();
            var result = req.CreateResponse(HttpStatusCode.OK);
            await result.WriteAsJsonAsync(allLevels);
            return result;
        }

        [Function("GetLevelById")]
        public async Task<HttpResponseData> GetLevelById(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "levels/{id:guid}")] HttpRequestData req,
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
                var level = await _service.GetByIdAsync(id);
                if (level == null)
                    return req.CreateResponse(HttpStatusCode.NotFound);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(level);
                return response;
            }

            // Other roles can view levels
            if (!_authorizationService.HasAnyRole(role, "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view level details");

            var levelData = await _service.GetByIdAsync(id);
            if (levelData == null)
                return req.CreateResponse(HttpStatusCode.NotFound);
            var result = req.CreateResponse(HttpStatusCode.OK);
            await result.WriteAsJsonAsync(levelData);
            return result;
        }

        [Function("CreateLevel")]
        public async Task<HttpResponseData> CreateLevel(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "levels")] HttpRequestData req)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "Token required");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient role");

            var dto = await req.ReadFromJsonAsync<CreateLevelDto>();
            var levelName = dto?.LevelName?.Trim();
            if (string.IsNullOrWhiteSpace(levelName))
            {
                var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                await badRequest.WriteStringAsync("Level name is required.");
                return badRequest;
            }

            var existingLevels = await _service.GetAllAsync();
            if (existingLevels.Any(level =>
                    string.Equals(level.LevelName?.Trim(), levelName, StringComparison.OrdinalIgnoreCase)))
            {
                var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                await conflict.WriteStringAsync("That level already exists.");
                return conflict;
            }

            dto!.LevelName = levelName;
            var id = await _service.CreateAsync(dto);
            var response = req.CreateResponse(HttpStatusCode.Created);
            await response.WriteAsJsonAsync(new { LevelId = id });
            return response;
        }

        [Function("UpdateLevel")]
        public async Task<HttpResponseData> UpdateLevel(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", "patch", Route = "levels/{id:guid}")] HttpRequestData req,
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

            var dto = await req.ReadFromJsonAsync<UpdateLevelDto>();
            if (dto == null)
                return req.CreateResponse(HttpStatusCode.BadRequest);

            await _service.UpdateAsync(id, dto);
            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        [Function("DeleteLevel")]
        public async Task<HttpResponseData> DeleteLevel(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "levels/{id:guid}")] HttpRequestData req,
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

            var deleteResult = await _service.DeleteAsync(id);
            if (deleteResult == 0)
                return req.CreateResponse(HttpStatusCode.NotFound);
            if (deleteResult < 0)
            {
                var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                await conflict.WriteStringAsync("Teams use this level. Reassign them before removing it.");
                return conflict;
            }
            return req.CreateResponse(HttpStatusCode.NoContent);
        }
    }
}
