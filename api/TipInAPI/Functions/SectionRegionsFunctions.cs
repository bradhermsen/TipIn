using System;
using System.Net;
using System.Threading.Tasks;
using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using TipInAPI.DTOs;
using TipInAPI.Infrastructure.Authorization;
using TipInAPI.Services;

namespace TipInAPI.Functions
{
    public class SectionRegionsFunctions
    {
        private readonly IDbConnection _db;
        private readonly IAuthorizationService _authorizationService;

        public SectionRegionsFunctions(
            IDbConnection db,
            IAuthorizationService authorizationService)
        {
            _db = db;
            _authorizationService = authorizationService;
        }

        [Function("GetSectionRegions")]
        public async Task<HttpResponseData> GetSectionRegions(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "sectionregions")] HttpRequestData req)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, _, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view section regions");

            var sql = @"
                SELECT
                    sr.Id,
                    sr.LeagueId,
                    l.Name AS LeagueName,
                    sr.Name,
                    sr.SortOrder,
                    sr.IsActive,
                    COUNT(t.Id) AS TeamCount
                FROM dbo.SectionRegions sr
                LEFT JOIN dbo.Leagues l ON sr.LeagueId = l.Id
                LEFT JOIN dbo.Teams t ON t.SectionRegionId = sr.Id
                GROUP BY sr.Id, sr.LeagueId, l.Name, sr.Name, sr.SortOrder, sr.IsActive
                ORDER BY l.Name, sr.SortOrder, sr.Name;";

            var items = await _db.QueryAsync<SectionRegionDto>(sql);
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(items);
            return response;
        }

        [Function("CreateSectionRegion")]
        public async Task<HttpResponseData> CreateSectionRegion(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "sectionregions")] HttpRequestData req)
        {
            var authError = await RequireCatalogAdmin(req);
            if (authError != null) return authError;

            var body = await req.ReadFromJsonAsync<CatalogRequest>();
            var name = body?.Name?.Trim();
            if (body == null || body.LeagueId == Guid.Empty || string.IsNullOrWhiteSpace(name))
            {
                var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                await badRequest.WriteStringAsync("League and section name are required.");
                return badRequest;
            }

            if (_db.State != ConnectionState.Open) _db.Open();
            using var transaction = _db.BeginTransaction(IsolationLevel.Serializable);

            var leagueExists = await _db.ExecuteScalarAsync<int>(
                "SELECT COUNT(1) FROM dbo.Leagues WITH (UPDLOCK, HOLDLOCK) WHERE Id = @LeagueId;",
                new { body.LeagueId }, transaction);
            if (leagueExists == 0)
            {
                var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                await badRequest.WriteStringAsync("The selected league does not exist.");
                return badRequest;
            }

            var duplicate = await _db.ExecuteScalarAsync<int>(@"
                SELECT COUNT(1)
                FROM dbo.SectionRegions WITH (UPDLOCK, HOLDLOCK)
                WHERE LeagueId = @LeagueId
                  AND LOWER(LTRIM(RTRIM(Name))) = LOWER(@Name);",
                new { body.LeagueId, Name = name }, transaction);
            if (duplicate > 0)
            {
                var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                await conflict.WriteStringAsync("That section already exists for this league.");
                return conflict;
            }

            var id = Guid.NewGuid();
            try
            {
                await _db.ExecuteAsync(@"
                    INSERT INTO dbo.SectionRegions (Id, LeagueId, Name, SortOrder, IsActive)
                    VALUES (@Id, @LeagueId, @Name, @SortOrder, @IsActive);",
                    new { Id = id, body.LeagueId, Name = name, body.SortOrder, body.IsActive }, transaction);
                transaction.Commit();
            }
            catch (SqlException ex) when (ex.Number == 2601 || ex.Number == 2627)
            {
                var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                await conflict.WriteStringAsync("That section already exists for this league.");
                return conflict;
            }

            var response = req.CreateResponse(HttpStatusCode.Created);
            await response.WriteAsJsonAsync(new { id, body.LeagueId, Name = name });
            return response;
        }

        [Function("DeleteSectionRegion")]
        public async Task<HttpResponseData> DeleteSectionRegion(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "sectionregions/{id:guid}")] HttpRequestData req,
            Guid id)
        {
            var authError = await RequireCatalogAdmin(req);
            if (authError != null) return authError;

            if (_db.State != ConnectionState.Open) _db.Open();
            using var transaction = _db.BeginTransaction(IsolationLevel.Serializable);
            var exists = await _db.ExecuteScalarAsync<int>(@"
                SELECT COUNT(1) FROM dbo.SectionRegions WITH (UPDLOCK, HOLDLOCK) WHERE Id = @Id;",
                new { Id = id }, transaction);
            if (exists == 0) return req.CreateResponse(HttpStatusCode.NotFound);

            var teamCount = await _db.ExecuteScalarAsync<int>(@"
                SELECT COUNT(1) FROM dbo.Teams WITH (UPDLOCK, HOLDLOCK) WHERE SectionRegionId = @Id;",
                new { Id = id }, transaction);
            if (teamCount > 0)
            {
                var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                await conflict.WriteStringAsync("Teams use this section. Reassign them before removing it.");
                return conflict;
            }

            await _db.ExecuteAsync("DELETE FROM dbo.SectionRegions WHERE Id = @Id;", new { Id = id }, transaction);
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
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin or OrgAdmin can manage sections");
            return null;
        }

        private sealed class CatalogRequest
        {
            public Guid LeagueId { get; set; }
            public string? Name { get; set; }
            public int SortOrder { get; set; }
            public bool IsActive { get; set; } = true;
        }
    }
}
