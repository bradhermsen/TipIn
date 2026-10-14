using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Dapper;
using System.Data;
using System.Net;
using Microsoft.Data.SqlClient;
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
                var sql = @"
                    SELECT gt.GameTypeId, gt.Name,
                        (SELECT COUNT(1)
                         FROM dbo.Games g
                         WHERE g.GameTypeId = gt.GameTypeId
                            OR g.GameRoundId IN (
                                SELECT gr.GameRoundId
                                FROM dbo.GameRounds gr
                                WHERE gr.GameTypeId = gt.GameTypeId
                            )) AS GameCount
                    FROM dbo.GameTypes gt
                    ORDER BY gt.GameTypeId;";
                var result = await _db.QueryAsync(sql);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(result);
                return response;
            }

            // Other roles need at least Viewer access
            if (!_authorizationService.HasAnyRole(role, "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view game types");

            var gameSql = @"
                SELECT gt.GameTypeId, gt.Name,
                    (SELECT COUNT(1)
                     FROM dbo.Games g
                     WHERE g.GameTypeId = gt.GameTypeId
                        OR g.GameRoundId IN (
                            SELECT gr.GameRoundId
                            FROM dbo.GameRounds gr
                            WHERE gr.GameTypeId = gt.GameTypeId
                        )) AS GameCount
                FROM dbo.GameTypes gt
                ORDER BY gt.GameTypeId;";
            var gameResult = await _db.QueryAsync(gameSql);
            var gameResponse = req.CreateResponse(HttpStatusCode.OK);
            await gameResponse.WriteAsJsonAsync(gameResult);
            return gameResponse;
        }

        [Function("CreateGameType")]
        public async Task<HttpResponseData> CreateGameType(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "gametypes")] HttpRequestData req)
        {
            var authError = await RequireCatalogAdmin(req);
            if (authError != null) return authError;

            var body = await req.ReadFromJsonAsync<GameTypeRequest>();
            var name = body?.Name?.Trim();
            if (string.IsNullOrWhiteSpace(name))
            {
                var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                await badRequest.WriteStringAsync("Game type name is required.");
                return badRequest;
            }

            var duplicate = await _db.ExecuteScalarAsync<int>(@"
                SELECT COUNT(1)
                FROM dbo.GameTypes
                WHERE LOWER(LTRIM(RTRIM(Name))) = LOWER(@Name);", new { Name = name });
            if (duplicate > 0)
            {
                var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                await conflict.WriteStringAsync("That game type already exists.");
                return conflict;
            }

            try
            {
                var gameTypeId = await _db.ExecuteScalarAsync<int>(@"
                    INSERT INTO dbo.GameTypes (Name)
                    OUTPUT INSERTED.GameTypeId
                    VALUES (@Name);", new { Name = name });
                var response = req.CreateResponse(HttpStatusCode.Created);
                await response.WriteAsJsonAsync(new { gameTypeId, name });
                return response;
            }
            catch (SqlException ex) when (ex.Number == 2601 || ex.Number == 2627)
            {
                var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                await conflict.WriteStringAsync("That game type already exists.");
                return conflict;
            }
        }

        [Function("DeleteGameType")]
        public async Task<HttpResponseData> DeleteGameType(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "gametypes/{id:int}")] HttpRequestData req,
            int id)
        {
            var authError = await RequireCatalogAdmin(req);
            if (authError != null) return authError;

            if (_db.State != ConnectionState.Open) _db.Open();
            using var transaction = _db.BeginTransaction(IsolationLevel.Serializable);

            var exists = await _db.ExecuteScalarAsync<int>(@"
                SELECT COUNT(1)
                FROM dbo.GameTypes WITH (UPDLOCK, HOLDLOCK)
                WHERE GameTypeId = @Id;", new { Id = id }, transaction);
            if (exists == 0)
            {
                var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                await notFound.WriteStringAsync("Game type not found.");
                return notFound;
            }

            var gameCount = await _db.ExecuteScalarAsync<int>(@"
                SELECT COUNT(1)
                FROM dbo.Games g
                WHERE g.GameTypeId = @Id
                   OR g.GameRoundId IN (
                        SELECT gr.GameRoundId
                        FROM dbo.GameRounds gr
                        WHERE gr.GameTypeId = @Id
                   );", new { Id = id }, transaction);
            if (gameCount > 0)
            {
                var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                await conflict.WriteStringAsync("This game type is used by scheduled or historical games and cannot be removed.");
                return conflict;
            }

            await _db.ExecuteAsync("DELETE FROM dbo.GameRounds WHERE GameTypeId = @Id;", new { Id = id }, transaction);
            await _db.ExecuteAsync("DELETE FROM dbo.GameTypes WHERE GameTypeId = @Id;", new { Id = id }, transaction);
            transaction.Commit();

            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        private async Task<HttpResponseData?> RequireCatalogAdmin(HttpRequestData req)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, _, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin or OrgAdmin can manage game types");

            return null;
        }

        private sealed class GameTypeRequest
        {
            public string? Name { get; set; }
        }
    }
}
