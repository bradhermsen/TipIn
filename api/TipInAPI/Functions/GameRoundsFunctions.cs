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
    public class GameRoundsFunctions
    {
        private readonly IDbConnection _db;
        private readonly IAuthorizationService _authorizationService;

        public GameRoundsFunctions(IDbConnection db, IAuthorizationService authorizationService)
        {
            _db = db;
            _authorizationService = authorizationService;
        }

        [Function("GetGameRounds")]
        public async Task<HttpResponseData> GetGameRounds(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "gamerounds")] HttpRequestData req)
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
                var sql = @"
                    SELECT 
                        GameRoundId,
                        GameTypeId,
                        RoundName,
                        SortOrder
                    FROM GameRounds
                    ORDER BY GameTypeId, SortOrder;
                ";
                var result = await _db.QueryAsync(sql);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(result);
                return response;
            }

            // Other roles need at least Viewer access
            if (!_authorizationService.HasAnyRole(role, "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view game rounds");

            var gameSql = @"
                SELECT 
                    GameRoundId,
                    GameTypeId,
                    RoundName,
                    SortOrder
                FROM GameRounds
                ORDER BY GameTypeId, SortOrder;
            ";
            var gameResult = await _db.QueryAsync(gameSql);
            var gameResponse = req.CreateResponse(HttpStatusCode.OK);
            await gameResponse.WriteAsJsonAsync(gameResult);
            return gameResponse;
        }
    }
}
