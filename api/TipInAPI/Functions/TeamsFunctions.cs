using System;
using System.Net;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using TipInAPI.DTOs;
using TipInAPI.Services;
using TipInAPI.Infrastructure.Authorization;

namespace TipInAPI.Functions
{
    public class TeamsFunctions
    {
        private static readonly Dictionary<string, string> AllowedTeamTypes =
            new(StringComparer.OrdinalIgnoreCase)
            {
                ["boys"] = "Boys",
                ["girls"] = "Girls",
                ["co-ed"] = "Co-Ed",
                ["coed"] = "Co-Ed",
                ["men"] = "Men",
                ["women"] = "Women"
            };

        private readonly ITeamsService _service;
        private readonly IAccessCodeService _accessCodeService;
        private readonly IAccessCodeValidator _accessCodeValidator;
        private readonly IAuthorizationService _authorizationService;
        private readonly ITeamAuthorizationService _teamAuthorizationService;
        private readonly ICoachTeamsService _coachTeamsService;

        public TeamsFunctions(
            ITeamsService service,
            IAccessCodeService accessCodeService,
            IAccessCodeValidator accessCodeValidator,
            IAuthorizationService authorizationService,
            ITeamAuthorizationService teamAuthorizationService,
            ICoachTeamsService coachTeamsService)
        {
            _service = service;
            _accessCodeService = accessCodeService;
            _accessCodeValidator = accessCodeValidator;
            _authorizationService = authorizationService;
            _teamAuthorizationService = teamAuthorizationService;
            _coachTeamsService = coachTeamsService;
        }

        [Function("GetTeams")]
        public async Task<HttpResponseData> GetTeams(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "teams")] HttpRequestData req)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // SuperAdmin and OrgAdmin can view all teams; other roles can view their assigned teams
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view teams");

            var teams = await _service.GetAllAsync();
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(teams);
            return response;
        }

        [Function("GetTeamById")]
        public async Task<HttpResponseData> GetTeamById(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "teams/{id:guid}")] HttpRequestData req,
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
                var team = await _service.GetByIdAsync(id);
                if (team == null)
                    return req.CreateResponse(HttpStatusCode.NotFound);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(team);
                return response;
            }

            // Other roles can view teams
            if (!_authorizationService.HasAnyRole(role, "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view team details");

            var teamData = await _service.GetByIdAsync(id);
            if (teamData == null)
                return req.CreateResponse(HttpStatusCode.NotFound);
            var result = req.CreateResponse(HttpStatusCode.OK);
            await result.WriteAsJsonAsync(teamData);
            return result;
        }

        [Function("CreateTeam")]
        public async Task<HttpResponseData> CreateTeam(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "teams")] HttpRequestData req)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // Only SuperAdmin and OrgAdmin can create teams
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin or OrgAdmin can create teams");

            TeamCreateUpdateDto? dto;
            try
            {
                dto = await req.ReadFromJsonAsync<TeamCreateUpdateDto>();
            }
            catch (Exception ex) when (ex is JsonException || ex is InvalidOperationException || ex is FormatException || ex is AggregateException)
            {
                var badPayload = req.CreateResponse();
                await badPayload.WriteAsJsonAsync(new { error = "Invalid team payload format." }, HttpStatusCode.BadRequest);
                return badPayload;
            }

            if (dto == null)
            {
                var badPayload = req.CreateResponse();
                await badPayload.WriteAsJsonAsync(new { error = "Invalid team payload." }, HttpStatusCode.BadRequest);
                return badPayload;
            }

            var normalizedTeamType = NormalizeTeamType(dto.TeamType);
            if (normalizedTeamType == null)
            {
                var bad = req.CreateResponse();
                await bad.WriteAsJsonAsync(new { error = "Team type is required and must be one of: Boys, Girls, Co-Ed, Men, Women." }, HttpStatusCode.BadRequest);
                return bad;
            }

            dto.TeamType = normalizedTeamType;
            dto.TeamMascot = string.IsNullOrWhiteSpace(dto.TeamMascot) ? null : dto.TeamMascot.Trim();

            Guid teamId;
            try
            {
                teamId = await _service.CreateAsync(dto);
            }
            catch (Exception ex) when (ex is ArgumentException || ex is InvalidOperationException)
            {
                var bad = req.CreateResponse();
                await bad.WriteAsJsonAsync(new { error = ex.Message }, HttpStatusCode.BadRequest);
                return bad;
            }

            var response = req.CreateResponse(HttpStatusCode.Created);
            await response.WriteAsJsonAsync(new { teamId });
            return response;
        }

        [Function("UpdateTeam")]
        public async Task<HttpResponseData> UpdateTeam(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "teams/{id:guid}")] HttpRequestData req,
            Guid id)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // SuperAdmin/OrgAdmin can update any team; TeamManager/Coach must be assigned
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
            {
                if (!_authorizationService.HasAnyRole(role, "TeamManager", "Coach"))
                    return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to update teams");

                // Check if user is assigned to this team
                var isAssigned = await _teamAuthorizationService.CanUserManageTeamAsync(Guid.Parse(userId), role, id, _coachTeamsService);
                if (!isAssigned)
                    return await AuthorizationHelper.ForbiddenResponse(req, "You are not assigned to this team");
            }

            var dto = await req.ReadFromJsonAsync<TeamCreateUpdateDto>();
            if (dto == null)
            {
                var badPayload = req.CreateResponse(HttpStatusCode.BadRequest);
                await badPayload.WriteAsJsonAsync(new { error = "Invalid team payload." });
                return badPayload;
            }

            try
            {
                await _service.UpdateAsync(id, dto);
            }
            catch (Exception ex) when (ex is ArgumentException || ex is InvalidOperationException)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = ex.Message });
                return bad;
            }

            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        private static string? NormalizeTeamType(string? value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return null;
            }

            var key = value.Trim().ToLowerInvariant();
            return AllowedTeamTypes.TryGetValue(key, out var normalized)
                ? normalized
                : null;
        }

        [Function("DeleteTeam")]
        public async Task<HttpResponseData> DeleteTeam(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "teams/{id:guid}")] HttpRequestData req,
            Guid id)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // Only SuperAdmin and OrgAdmin can delete teams
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin or OrgAdmin can delete teams");

            await _service.DeleteAsync(id);
            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        // NEW: FILTER TEAMS BY ORGANIZATION
        [Function("GetTeamsByOrganization")]
        public async Task<HttpResponseData> GetTeamsByOrganization(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "teams/by-organization/{organizationId}")]
            HttpRequestData req,
            string organizationId)
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
                var teams = await _service.GetTeamsByOrganizationAsync(Guid.Parse(organizationId));
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(teams);
                return response;
            }

            // Other roles can view org teams
            if (!_authorizationService.HasAnyRole(role, "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view organization teams");

            var allTeams = await _service.GetTeamsByOrganizationAsync(Guid.Parse(organizationId));
            var result = req.CreateResponse(HttpStatusCode.OK);
            await result.WriteAsJsonAsync(allTeams);
            return result;
        }

        [Function("GenerateAccessCodes")]
        public async Task<HttpResponseData> GenerateAccessCodes(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "teams/{id:guid}/generate-codes")] HttpRequestData req,
            Guid id)
        {
            try
            {
                // Validate authorization
                var token = AuthorizationHelper.ExtractBearerToken(req);
                if (string.IsNullOrEmpty(token))
                    return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

                var (isValid, userId, role) = _authorizationService.ValidateToken(token);
                if (!isValid)
                    return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

                // Only Team Manager and OrgAdmin can generate access codes
                if (!_authorizationService.HasAnyRole(role, "OrgAdmin", "TeamManager", "SuperAdmin"))
                    return await AuthorizationHelper.ForbiddenResponse(req, "Only OrgAdmin or TeamManager can generate access codes");

                // Team Manager must be assigned to the team
                if (_authorizationService.HasAnyRole(role, "TeamManager"))
                {
                    var isAssigned = await _teamAuthorizationService.IsUserAssignedToTeamAsync(Guid.Parse(userId), id, _coachTeamsService);
                    if (!isAssigned)
                        return await AuthorizationHelper.ForbiddenResponse(req, "You are not assigned to this team");
                }

                var team = await _service.GetByIdAsync(id);
                if (team == null)
                    return req.CreateResponse(HttpStatusCode.NotFound);
                if (string.Equals(team.OrganizationType, "External", StringComparison.OrdinalIgnoreCase))
                    return await AuthorizationHelper.BadRequestResponse(req, "Access codes are available only for Managed Organizations");

                // Generate new access codes
                var gameManagerCode = _accessCodeService.GenerateGameManagerCode();
                var statManagerCode = _accessCodeService.GenerateStatManagerCode();

                // Initialize expiration times (null until game is marked final)
                DateTime? gmCodeExpiresAt = null;
                DateTime? smCodeExpiresAt = null;

                // Update team with new codes
                var updateDto = new TeamCreateUpdateDto
                {
                    OrganizationId = team.OrganizationId,
                    LevelId = team.LevelId,
                    SeasonId = team.SeasonId,
                    Name = team.Name,
                    Gender = team.Gender,
                    Abbreviation = team.Abbreviation,
                    TeamType = team.TeamType,
                    TeamMascot = team.TeamMascot,

                    HeadCoachName = team.HeadCoachName,
                    AssistantCoach1Name = team.AssistantCoach1Name,
                    AssistantCoach2Name = team.AssistantCoach2Name,
                    AssistantCoach3Name = team.AssistantCoach3Name,
                    AssistantCoach4Name = team.AssistantCoach4Name,

                    HeadCoachEmail = team.HeadCoachEmail,
                    AssistantCoach1Email = team.AssistantCoach1Email,
                    AssistantCoach2Email = team.AssistantCoach2Email,
                    AssistantCoach3Email = team.AssistantCoach3Email,
                    AssistantCoach4Email = team.AssistantCoach4Email,

                    AssistantCoach1HasLogin = team.AssistantCoach1HasLogin,
                    AssistantCoach2HasLogin = team.AssistantCoach2HasLogin,
                    AssistantCoach3HasLogin = team.AssistantCoach3HasLogin,
                    AssistantCoach4HasLogin = team.AssistantCoach4HasLogin,

                    Notes = team.Notes,
                    GameManagerCode = gameManagerCode,
                    GameManagerCodeExpiresAt = gmCodeExpiresAt,
                    StatManagerCode = statManagerCode,
                    StatManagerCodeExpiresAt = smCodeExpiresAt,
                    IsActive = team.IsActive,
                    IsExternal = team.IsExternal
                };

                await _service.UpdateAsync(id, updateDto);

                var updatedTeam = await _service.GetByIdAsync(id);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new
                {
                    gameManagerCode = updatedTeam.GameManagerCode,
                    gameManagerCodeExpiresAt = updatedTeam.GameManagerCodeExpiresAt,
                    statManagerCode = updatedTeam.StatManagerCode,
                    statManagerCodeExpiresAt = updatedTeam.StatManagerCodeExpiresAt
                });
                return response;
            }
            catch (Exception ex)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { error = ex.Message });
                return response;
            }
        }

        [Function("ValidateAccessCode")]
        public async Task<HttpResponseData> ValidateAccessCode(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "teams/{teamId:guid}/validate-code")] HttpRequestData req,
            Guid teamId)
        {
            try
            {
                // Read request body
                var body = await req.ReadAsStringAsync();
                if (string.IsNullOrEmpty(body))
                    return req.CreateResponse(HttpStatusCode.BadRequest);

                var payload = System.Text.Json.JsonSerializer.Deserialize<ValidateCodeRequest>(body, 
                    new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });

                if (payload == null || string.IsNullOrEmpty(payload.AccessCode))
                    return req.CreateResponse(HttpStatusCode.BadRequest);

                // Get team with game info
                var team = await _service.GetByIdAsync(teamId);
                if (team == null)
                    return req.CreateResponse(HttpStatusCode.NotFound);

                // Get game info from request (for game day validation)
                if (!DateTime.TryParse(payload.GameDateTime, out var gameDateTime))
                    return req.CreateResponse(HttpStatusCode.BadRequest);

                // Determine if it's a Game Manager or Stat Manager code
                bool isGameManagerCode = payload.AccessCode.StartsWith("GM-", StringComparison.OrdinalIgnoreCase);
                bool isStatManagerCode = payload.AccessCode.StartsWith("SM-", StringComparison.OrdinalIgnoreCase);

                string? storedCode = null;
                DateTime? expiresAt = null;

                if (isGameManagerCode)
                {
                    storedCode = team.GameManagerCode;
                    expiresAt = team.GameManagerCodeExpiresAt;
                }
                else if (isStatManagerCode)
                {
                    storedCode = team.StatManagerCode;
                    expiresAt = team.StatManagerCodeExpiresAt;
                }
                else
                {
                    var response = req.CreateResponse(HttpStatusCode.BadRequest);
                    await response.WriteAsJsonAsync(new { isValid = false, message = "Invalid access code format" });
                    return response;
                }

                // Validate the code
                var validationResult = _accessCodeValidator.GetValidationResult(payload.AccessCode, storedCode, expiresAt, gameDateTime);

                var result = req.CreateResponse(validationResult.IsValid ? HttpStatusCode.OK : HttpStatusCode.Unauthorized);
                await result.WriteAsJsonAsync(new
                {
                    isValid = validationResult.IsValid,
                    message = validationResult.Message
                });
                return result;
            }
            catch (Exception ex)
            {
                var response = req.CreateResponse(HttpStatusCode.InternalServerError);
                await response.WriteAsJsonAsync(new { isValid = false, message = ex.Message });
                return response;
            }
        }
    }

    public class ValidateCodeRequest
    {
        public string AccessCode { get; set; }
        public string GameDateTime { get; set; }
    }
}
