using System;
using System.Net;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using TipInAPI.Infrastructure.Authorization;
using TipInAPI.Services;
using TipInAPI.DTOs;

namespace TipInAPI.Functions
{
    // Per-instance, in-memory sliding window; limits player-search scraping by a single user
    public static class SearchLimiter
    {
        private const int MaxPerWindow = 30;
        private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<Guid, System.Collections.Generic.Queue<DateTime>> Hits = new();

        public static bool TryAcquire(Guid userId, DateTime? now = null)
        {
            var t = now ?? DateTime.UtcNow;
            var q = Hits.GetOrAdd(userId, _ => new System.Collections.Generic.Queue<DateTime>());
            lock (q)
            {
                while (q.Count > 0 && t - q.Peek() > Window) q.Dequeue();
                if (q.Count >= MaxPerWindow) return false;
                q.Enqueue(t);
                return true;
            }
        }
    }

    public class CoachRosterFunctions
    {
        private readonly ICoachRosterService _service;
        private readonly IAuthorizationService _authorizationService;
        private readonly ITeamAuthorizationService _teamAuthorizationService;
        private readonly ICoachTeamsService _coachTeamsService;

        public CoachRosterFunctions(
            ICoachRosterService service,
            IAuthorizationService authorizationService,
            ITeamAuthorizationService teamAuthorizationService,
            ICoachTeamsService coachTeamsService)
        {
            _service = service;
            _authorizationService = authorizationService;
            _teamAuthorizationService = teamAuthorizationService;
            _coachTeamsService = coachTeamsService;
        }

        // Returns the actor id, or an error response when the caller may not manage this team's roster
        private async Task<(Guid? ActorId, HttpResponseData? Error)> AuthorizeAsync(HttpRequestData req, Guid teamId)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return (null, await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided"));

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return (null, await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token"));

            if (!_authorizationService.HasAnyRole(role, "Coach", "TeamManager", "SuperAdmin", "OrgAdmin"))
                return (null, await AuthorizationHelper.ForbiddenResponse(req, "Insufficient role"));

            var actorId = Guid.Parse(userId);
            var allowed = _authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin")
                ? await _teamAuthorizationService.CanAdminAccessTeamAsync(actorId, role, teamId)
                : await _teamAuthorizationService.IsUserAssignedToTeamAsync(actorId, teamId, _coachTeamsService);

            if (!allowed)
                return (null, await AuthorizationHelper.ForbiddenResponse(req, "You do not have access to this team"));

            return (actorId, null);
        }

        private static async Task<HttpResponseData> ToResponseAsync(HttpRequestData req, CoachRosterResult result)
        {
            var response = req.CreateResponse();
            switch (result.Outcome)
            {
                case CoachRosterOutcome.Ok:
                    response.StatusCode = HttpStatusCode.OK;
                    await response.WriteAsJsonAsync(result.Data ?? new { ok = true });
                    break;
                case CoachRosterOutcome.NotFound:
                    response.StatusCode = HttpStatusCode.NotFound;
                    await response.WriteAsJsonAsync(new { error = result.Message }, HttpStatusCode.NotFound);
                    break;
                case CoachRosterOutcome.Warning:
                    response.StatusCode = HttpStatusCode.Conflict;
                    await response.WriteAsJsonAsync(new { error = result.Message, details = result.Data }, HttpStatusCode.Conflict);
                    break;
                default:
                    response.StatusCode = HttpStatusCode.BadRequest;
                    await response.WriteAsJsonAsync(new { error = result.Message }, HttpStatusCode.BadRequest);
                    break;
            }
            return response;
        }

        [Function("CoachGetRoster")]
        public async Task<HttpResponseData> GetRoster(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "coach/teams/{teamId:guid}/roster")] HttpRequestData req,
            Guid teamId)
        {
            var (_, error) = await AuthorizeAsync(req, teamId);
            if (error != null) return error;

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(await _service.GetRosterAsync(teamId));
            return response;
        }

        [Function("CoachGetStaff")]
        public async Task<HttpResponseData> GetStaff(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "coach/teams/{teamId:guid}/staff")] HttpRequestData req,
            Guid teamId)
        {
            var (_, error) = await AuthorizeAsync(req, teamId);
            if (error != null) return error;
            return await ToResponseAsync(req, await _service.GetStaffAsync(teamId));
        }

        [Function("CoachUpdateAssistant")]
        public async Task<HttpResponseData> UpdateAssistant(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "coach/teams/{teamId:guid}/staff/assistants/{slot:int}")] HttpRequestData req,
            Guid teamId, int slot)
        {
            var (_, error) = await AuthorizeAsync(req, teamId);
            if (error != null) return error;
            UpdateAssistantRequest? body;
            try { body = await req.ReadFromJsonAsync<UpdateAssistantRequest>(); }
            catch (System.Text.Json.JsonException) { return await AuthorizationHelper.BadRequestResponse(req, "Invalid JSON payload"); }
            if (body == null) return await AuthorizationHelper.BadRequestResponse(req, "Request body is required");
            return await ToResponseAsync(req, await _service.UpdateAssistantAsync(teamId, slot, body));
        }

        [Function("CoachSearchPlayers")]
        public async Task<HttpResponseData> Search(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "coach/teams/{teamId:guid}/player-search")] HttpRequestData req,
            Guid teamId)
        {
            var (actorId, error) = await AuthorizeAsync(req, teamId);
            if (error != null) return error;

            if (!SearchLimiter.TryAcquire(actorId!.Value))
            {
                var limited = req.CreateResponse(HttpStatusCode.TooManyRequests);
                limited.Headers.Add("Retry-After", "60");
                await limited.WriteAsJsonAsync(new { error = "Too many searches. Please wait a minute and try again." }, HttpStatusCode.TooManyRequests);
                return limited;
            }

            var query = System.Web.HttpUtility.ParseQueryString(req.Url.Query)["q"] ?? "";
            return await ToResponseAsync(req, await _service.SearchPlayersAsync(teamId, query));
        }

        [Function("CoachAddRosterPlayer")]
        public async Task<HttpResponseData> Add(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "coach/teams/{teamId:guid}/roster")] HttpRequestData req,
            Guid teamId)
        {
            var (actorId, error) = await AuthorizeAsync(req, teamId);
            if (error != null) return error;

            AddRosterPlayerRequest? body;
            try { body = await req.ReadFromJsonAsync<AddRosterPlayerRequest>(); }
            catch { return await AuthorizationHelper.BadRequestResponse(req, "Invalid JSON payload"); }
            if (body == null) return await AuthorizationHelper.BadRequestResponse(req, "Request body is required");

            return await ToResponseAsync(req, await _service.AddPlayerAsync(actorId!.Value, teamId, body));
        }

        [Function("CoachUpdateRosterPlayer")]
        public async Task<HttpResponseData> Update(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "coach/teams/{teamId:guid}/roster/{rosterEntryId:guid}")] HttpRequestData req,
            Guid teamId, Guid rosterEntryId)
        {
            var (actorId, error) = await AuthorizeAsync(req, teamId);
            if (error != null) return error;

            UpdateRosterPlayerRequest? body;
            try { body = await req.ReadFromJsonAsync<UpdateRosterPlayerRequest>(); }
            catch { return await AuthorizationHelper.BadRequestResponse(req, "Invalid JSON payload"); }
            if (body == null) return await AuthorizationHelper.BadRequestResponse(req, "Request body is required");

            return await ToResponseAsync(req, await _service.UpdatePlayerAsync(actorId!.Value, teamId, rosterEntryId, body));
        }

        [Function("CoachRemoveRosterPlayer")]
        public async Task<HttpResponseData> Remove(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "coach/teams/{teamId:guid}/roster/{rosterEntryId:guid}")] HttpRequestData req,
            Guid teamId, Guid rosterEntryId)
        {
            var (actorId, error) = await AuthorizeAsync(req, teamId);
            if (error != null) return error;

            return await ToResponseAsync(req, await _service.RemovePlayerAsync(actorId!.Value, teamId, rosterEntryId));
        }
    }
}
