using System.Net;
using System.Threading.Tasks;
using System.Data;
using Dapper;
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
                    sr.IsActive
                FROM SectionRegions sr
                LEFT JOIN Leagues l ON sr.LeagueId = l.Id
                ORDER BY sr.SortOrder, sr.Name;";

            var items = await _db.QueryAsync<SectionRegionDto>(sql);
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(items);
            return response;
        }
    }
}
