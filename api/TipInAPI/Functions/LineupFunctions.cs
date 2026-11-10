using System;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using System.Threading;
using Dapper;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using TipInAPI.Infrastructure.Authorization;
using TipInAPI.Infrastructure.Database;
using TipInAPI.Services;

namespace TipInAPI.Functions
{
    public class LineupFunctions
    {
        private readonly ILineupService _service;
        private readonly IAuthorizationService _authorizationService;
        private readonly ITeamAuthorizationService _teamAuthorizationService;
        private readonly ICoachTeamsService _coachTeamsService;
        private readonly ISqlConnectionFactory _db;
        private readonly IAccessCodeService _accessCodeService;

        public LineupFunctions(
            ILineupService service,
            IAuthorizationService authorizationService,
            ITeamAuthorizationService teamAuthorizationService,
            ICoachTeamsService coachTeamsService,
            ISqlConnectionFactory db,
            IAccessCodeService accessCodeService)
        {
            _service = service;
            _authorizationService = authorizationService;
            _teamAuthorizationService = teamAuthorizationService;
            _coachTeamsService = coachTeamsService;
            _db = db;
            _accessCodeService = accessCodeService;
        }

        private sealed class Caller
        {
            public Guid UserId { get; set; }
            public string Label { get; set; } = "";
        }

        private async Task<(Caller? Caller, HttpResponseData? Error)> AuthorizeCoachAsync(HttpRequestData req, Guid teamId, bool adminOnly)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return (null, await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided"));

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return (null, await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token"));

            var admin = _authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin", "OrgOwner");
            var allowedRoles = adminOnly
                ? new[] { "SuperAdmin", "OrgAdmin", "OrgOwner" }
                : new[] { "Coach", "TeamManager", "SuperAdmin", "OrgAdmin", "OrgOwner" };
            if (!_authorizationService.HasAnyRole(role, allowedRoles))
                return (null, await AuthorizationHelper.ForbiddenResponse(req, "Insufficient role"));

            var actorId = Guid.Parse(userId);
            var allowed = admin
                ? await _teamAuthorizationService.CanAdminInviteToTeamAsync(actorId, role, teamId)
                : await _teamAuthorizationService.IsUserAssignedToTeamAsync(actorId, teamId, _coachTeamsService);
            if (!allowed)
                return (null, await AuthorizationHelper.ForbiddenResponse(req, "You do not have access to this team"));

            return (new Caller { UserId = actorId, Label = "coach:" + userId }, null);
        }

        // Game Manager code check, same rules as gateway-mobile
        private async Task<HttpResponseData?> AuthorizeTabletAsync(HttpRequestData req, Guid gameId)
        {
            var accessCode = req.Headers.TryGetValues("x-TipIn-access-code", out var values)
                ? values.FirstOrDefault()?.Trim().ToUpperInvariant()
                : null;
            if (string.IsNullOrWhiteSpace(accessCode) || !accessCode.StartsWith("GM-", StringComparison.OrdinalIgnoreCase))
                return await Json(req, HttpStatusCode.Unauthorized, new { error = "A valid Game Manager access code is required." });

            using var conn = _db.CreateConnection();
            var gameDate = await conn.QueryFirstOrDefaultAsync<DateTime?>(@"
                SELECT TOP 1 g.GameDateTime
                FROM dbo.Games g
                INNER JOIN dbo.Teams t ON t.Id IN (g.HomeTeamId, g.AwayTeamId)
                WHERE g.GameId = @GameId
                  AND (UPPER(ISNULL(t.ScorekeeperCode, '')) = @Code
                       OR UPPER(ISNULL(t.ScorekeeperCode, '')) = @Stripped
                       OR 'GM-' + UPPER(ISNULL(t.ScorekeeperCode, '')) = @Code);",
                new { GameId = gameId, Code = accessCode, Stripped = accessCode[3..] });

            if (gameDate == null || !_accessCodeService.IsValidGameDay(gameDate.Value))
                return await Json(req, HttpStatusCode.Forbidden, new { error = "The access code is not valid for this game." });
            return null;
        }

        private static async Task<HttpResponseData> Json(HttpRequestData req, HttpStatusCode status, object body)
        {
            var response = req.CreateResponse(status);
            await response.WriteAsJsonAsync(body, status);
            return response;
        }

        private static async Task<HttpResponseData> ToResponseAsync(HttpRequestData req, CoachRosterResult result)
        {
            return result.Outcome switch
            {
                CoachRosterOutcome.Ok => await Json(req, HttpStatusCode.OK, result.Data ?? new { ok = true }),
                CoachRosterOutcome.NotFound => await Json(req, HttpStatusCode.NotFound, new { error = result.Message }),
                CoachRosterOutcome.Warning => await Json(req, HttpStatusCode.Conflict, new { error = result.Message, details = result.Data }),
                _ => await Json(req, HttpStatusCode.BadRequest, new { error = result.Message }),
            };
        }

        private static async Task<T?> ReadBodyAsync<T>(HttpRequestData req) where T : class
        {
            try { return await req.ReadFromJsonAsync<T>(); }
            catch { return null; }
        }

        private sealed class UnlockRequest
        {
            public string? Reason { get; set; }
        }

        // Coach / admin

        [Function("CoachListTeamGames")]
        public async Task<HttpResponseData> CoachListGames(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "coach/teams/{teamId:guid}/games")] HttpRequestData req,
            Guid teamId)
        {
            var (_, error) = await AuthorizeCoachAsync(req, teamId, false);
            if (error != null) return error;
            return await Json(req, HttpStatusCode.OK, await _service.ListGamesForTeamAsync(teamId));
        }

        [Function("CoachGetLineup")]
        public async Task<HttpResponseData> CoachGet(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "coach/games/{gameId:guid}/teams/{teamId:guid}/lineup")] HttpRequestData req,
            Guid gameId, Guid teamId)
        {
            var (_, error) = await AuthorizeCoachAsync(req, teamId, false);
            if (error != null) return error;
            return await ToResponseAsync(req, await _service.GetAsync(gameId, teamId));
        }

        [Function("CoachGetGameManagerAccess")]
        public async Task<HttpResponseData> CoachGetGameManagerAccess(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "coach/games/{gameId:guid}/teams/{teamId:guid}/game-manager-access")] HttpRequestData req,
            Guid gameId, Guid teamId, CancellationToken cancellationToken)
        {
            var (caller, error) = await AuthorizeCoachAsync(req, teamId, false);
            if (error != null) return error;
            var result = await _service.GetGameManagerAccessAsync(gameId, teamId, caller!.UserId, cancellationToken);
            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add("Cache-Control", "no-store");
            await response.WriteAsJsonAsync(result, cancellationToken);
            return response;
        }

        [Function("CoachSaveLineup")]
        public async Task<HttpResponseData> CoachSave(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "coach/games/{gameId:guid}/teams/{teamId:guid}/lineup")] HttpRequestData req,
            Guid gameId, Guid teamId)
        {
            var (caller, error) = await AuthorizeCoachAsync(req, teamId, false);
            if (error != null) return error;
            var body = await ReadBodyAsync<SaveLineupRequest>(req);
            if (body == null) return await AuthorizationHelper.BadRequestResponse(req, "Invalid JSON payload");
            var actor = new LineupActor { UserId = caller!.UserId, Label = caller.Label, Verified = true };
            return await ToResponseAsync(req, await _service.SaveAsync(gameId, teamId, actor, body));
        }

        [Function("CoachSignLineup")]
        public async Task<HttpResponseData> CoachSign(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "coach/games/{gameId:guid}/teams/{teamId:guid}/lineup/sign")] HttpRequestData req,
            Guid gameId, Guid teamId)
        {
            var (caller, error) = await AuthorizeCoachAsync(req, teamId, false);
            if (error != null) return error;
            var body = await ReadBodyAsync<SignLineupRequest>(req);
            if (body == null) return await AuthorizationHelper.BadRequestResponse(req, "Invalid JSON payload");
            var actor = new LineupActor { UserId = caller!.UserId, Label = caller.Label, Verified = true };
            return await ToResponseAsync(req, await _service.SignAsync(gameId, teamId, actor, body));
        }

        [Function("AdminUnlockLineup")]
        public async Task<HttpResponseData> AdminUnlock(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "admin/games/{gameId:guid}/teams/{teamId:guid}/lineup/unlock")] HttpRequestData req,
            Guid gameId, Guid teamId)
        {
            var (caller, error) = await AuthorizeCoachAsync(req, teamId, true);
            if (error != null) return error;
            var body = await ReadBodyAsync<UnlockRequest>(req);
            if (body == null) return await AuthorizationHelper.BadRequestResponse(req, "Invalid JSON payload");
            return await ToResponseAsync(req, await _service.UnlockAsync(gameId, teamId, caller!.UserId, body.Reason));
        }

        // Tablet

        [Function("TabletGetLineup")]
        public async Task<HttpResponseData> TabletGet(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "games/{gameId:guid}/teams/{teamId:guid}/lineup-mobile")] HttpRequestData req,
            Guid gameId, Guid teamId)
        {
            var denied = await AuthorizeTabletAsync(req, gameId);
            if (denied != null) return denied;
            return await ToResponseAsync(req, await _service.GetAsync(gameId, teamId));
        }

        [Function("TabletSaveLineup")]
        public async Task<HttpResponseData> TabletSave(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "games/{gameId:guid}/teams/{teamId:guid}/lineup-mobile")] HttpRequestData req,
            Guid gameId, Guid teamId)
        {
            var denied = await AuthorizeTabletAsync(req, gameId);
            if (denied != null) return denied;
            var body = await ReadBodyAsync<SaveLineupRequest>(req);
            if (body == null) return await AuthorizationHelper.BadRequestResponse(req, "Invalid JSON payload");
            return await ToResponseAsync(req, await _service.SaveAsync(gameId, teamId, new LineupActor { Label = "tablet" }, body));
        }

        [Function("TabletSignLineup")]
        public async Task<HttpResponseData> TabletSign(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "games/{gameId:guid}/teams/{teamId:guid}/lineup-mobile/sign")] HttpRequestData req,
            Guid gameId, Guid teamId)
        {
            var denied = await AuthorizeTabletAsync(req, gameId);
            if (denied != null) return denied;
            var body = await ReadBodyAsync<SignLineupRequest>(req);
            if (body == null) return await AuthorizationHelper.BadRequestResponse(req, "Invalid JSON payload");
            return await ToResponseAsync(req, await _service.SignAsync(gameId, teamId, new LineupActor { Label = "tablet", Verified = false }, body));
        }
    }
}
