using System;
using System.IO;
using System.Net;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using TipInAPI.DTOs;
using TipInAPI.Services;
using TipInAPI.Infrastructure.Authorization;

namespace TipInAPI.Functions
{
    public class GamesFunctions
    {
        private readonly IGameService _service;
        private readonly IAuthorizationService _authorizationService;
        private readonly ITeamAuthorizationService _teamAuthorizationService;
        private readonly ICoachTeamsService _coachTeamsService;
        private readonly IAccessCodeValidator _accessCodeValidator;
        private readonly IGameSummaryReportService _gameSummaryReportService;

        public GamesFunctions(
            IGameService service,
            IAuthorizationService authorizationService,
            ITeamAuthorizationService teamAuthorizationService,
            ICoachTeamsService coachTeamsService,
            IAccessCodeValidator accessCodeValidator,
            IGameSummaryReportService gameSummaryReportService)
        {
            _service = service;
            _authorizationService = authorizationService;
            _teamAuthorizationService = teamAuthorizationService;
            _coachTeamsService = coachTeamsService;
            _accessCodeValidator = accessCodeValidator;
            _gameSummaryReportService = gameSummaryReportService;
        }

        [Function("GetGames")]
        public async Task<HttpResponseData> GetGames(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "games")] HttpRequestData req)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // SuperAdmin and OrgAdmin can view all games; other roles can view their team's games
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin", "OrgOwner", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view games");

            var games = await _service.GetAllAsync();
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(games);
            return response;
        }

        [Function("GetGameById")]
        public async Task<HttpResponseData> GetGameById(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "games/{id:guid}")] HttpRequestData req,
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
                var game = await _service.GetByIdAsync(id);
                if (game == null)
                    return req.CreateResponse(HttpStatusCode.NotFound);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(game);
                return response;
            }

            // Other roles can view games
            if (!_authorizationService.HasAnyRole(role, "OrgAdmin", "OrgOwner", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view game details");

            var gameData = await _service.GetByIdAsync(id);
            if (gameData == null)
                return req.CreateResponse(HttpStatusCode.NotFound);
            var result = req.CreateResponse(HttpStatusCode.OK);
            await result.WriteAsJsonAsync(gameData);
            return result;
        }

        [Function("CreateGame")]
        public async Task<HttpResponseData> CreateGame(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "games")] HttpRequestData req)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // Only SuperAdmin and OrgAdmin can create games
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin", "OrgOwner"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin or OrgAdmin can create games");

            var dto = await req.ReadFromJsonAsync<GameCreateUpdateDto>();
            if (dto == null)
            {
                var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                await badRequest.WriteAsJsonAsync(new { error = "Game details are required." });
                return badRequest;
            }
            try
            {
                await _service.CreateAsync(dto);
                return req.CreateResponse(HttpStatusCode.Created);
            }
            catch (ArgumentException ex)
            {
                var response = req.CreateResponse(HttpStatusCode.BadRequest);
                await response.WriteAsJsonAsync(new { error = ex.Message });
                return response;
            }
        }

        [Function("UpdateGame")]
        public async Task<HttpResponseData> UpdateGame(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "games/{id:guid}")] HttpRequestData req,
            Guid id)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // SuperAdmin/OrgAdmin can update any game; Coach/TeamManager must be assigned to a team
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin", "OrgOwner"))
            {
                if (!_authorizationService.HasAnyRole(role, "Coach", "TeamManager"))
                    return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to update games");
            }

            var dto = await req.ReadFromJsonAsync<GameCreateUpdateDto>();
            if (dto == null)
            {
                var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                await badRequest.WriteAsJsonAsync(new { error = "Game details are required." });
                return badRequest;
            }
            try
            {
                await _service.UpdateAsync(id, dto);
                return req.CreateResponse(HttpStatusCode.NoContent);
            }
            catch (ArgumentException ex)
            {
                var response = req.CreateResponse(HttpStatusCode.BadRequest);
                await response.WriteAsJsonAsync(new { error = ex.Message });
                return response;
            }
        }

        [Function("DeleteGame")]
        public async Task<HttpResponseData> DeleteGame(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "games/{id:guid}")] HttpRequestData req,
            Guid id)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // Only SuperAdmin and OrgAdmin can delete games
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin", "OrgOwner"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin or OrgAdmin can delete games");

            await _service.DeleteAsync(id);
            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        [Function("DownloadGameSummaryPdf")]
        public async Task<HttpResponseData> DownloadGameSummaryPdf(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "games/{id:guid}/summary-pdf")] HttpRequestData req,
            Guid id)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, _, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to download game summary");

            var report = await _gameSummaryReportService.BuildReportAsync(id);
            if (report == null)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            var pdfBytes = _gameSummaryReportService.BuildPdf(report);
            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add("Content-Type", "application/pdf");
            response.Headers.Add("Content-Disposition", $"attachment; filename=TipIn-GameSummary-{report.GameDateTime:yyyyMMdd-HHmm}-{report.GameId}.pdf");
            await response.Body.WriteAsync(pdfBytes, 0, pdfBytes.Length);
            await response.Body.FlushAsync();
            return response;
        }

        [Function("GetGameSummaryReport")]
        public async Task<HttpResponseData> GetGameSummaryReport(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "games/{id:guid}/summary-report")] HttpRequestData req,
            Guid id)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, _, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view game summary report");

            var report = await _gameSummaryReportService.BuildReportAsync(id);
            if (report == null)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(report);
            return response;
        }
    }
}
