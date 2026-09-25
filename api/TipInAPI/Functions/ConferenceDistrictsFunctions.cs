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
    public class ConferenceDistrictsFunctions
    {
        private readonly IDbConnection _db;
        private readonly IAuthorizationService _authorizationService;

        public ConferenceDistrictsFunctions(
            IDbConnection db,
            IAuthorizationService authorizationService)
        {
            _db = db;
            _authorizationService = authorizationService;
        }

        [Function("GetConferenceDistricts")]
        public async Task<HttpResponseData> GetConferenceDistricts(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "conferencedistricts")] HttpRequestData req)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, _, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view conference districts");

            var sql = @"
                SELECT
                    cd.Id,
                    cd.LeagueId,
                    l.Name AS LeagueName,
                    cd.Name,
                    cd.SortOrder,
                    cd.IsActive
                FROM ConferenceDistricts cd
                LEFT JOIN Leagues l ON cd.LeagueId = l.Id
                ORDER BY cd.SortOrder, cd.Name;";

            var items = await _db.QueryAsync<ConferenceDistrictDto>(sql);
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(items);
            return response;
        }
    }
}
