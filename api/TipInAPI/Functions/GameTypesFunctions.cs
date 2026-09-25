using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Dapper;
using System.Data;
using System.Net;
using TipInAPI.Services;
using TipInAPI.Infrastructure.Authorization;

namespace TipInAPI.Functions
{
    public class GameTypesFunctions
    {
        private readonly IDbConnection _db;
        private readonly IAuthorizationService _authorizationService;

        public GameTypesFunctions(IDbConnection db, IAuthorizationService authorizationService)
        {
            _db = db;
            _authorizationService = authorizationService;
        }

        [Function("GetGameTypes")]
        public async Task<HttpResponseData> GetGameTypes(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "gametypes")] HttpRequestData req)
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
                var sql = @"SELECT GameTypeId, Name FROM GameTypes ORDER BY GameTypeId;";
                var result = await _db.QueryAsync(sql);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(result);
                return response;
            }

            // Other roles need at least Viewer access
            if (!_authorizationService.HasAnyRole(role, "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view game types");

            var gameSql = @"SELECT GameTypeId, Name FROM GameTypes ORDER BY GameTypeId;";
            var gameResult = await _db.QueryAsync(gameSql);
            var gameResponse = req.CreateResponse(HttpStatusCode.OK);
            await gameResponse.WriteAsJsonAsync(gameResult);
            return gameResponse;
        }
    }
}
