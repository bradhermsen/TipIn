using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using Dapper;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using TipInAPI.DTOs;
using TipInAPI.Infrastructure.Authorization;
using TipInAPI.Infrastructure.Database;
using TipInAPI.Services;

namespace TipInAPI.Functions
{
    public class SeasonOrganizationsFunctions
    {
        private readonly ISqlConnectionFactory _connectionFactory;
        private readonly IAuthorizationService _authorizationService;

        public SeasonOrganizationsFunctions(
            ISqlConnectionFactory connectionFactory,
            IAuthorizationService authorizationService)
        {
            _connectionFactory = connectionFactory;
            _authorizationService = authorizationService;
        }

        [Function("GetSeasonOrganizations")]
        public async Task<HttpResponseData> GetSeasonOrganizations(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "seasons/{seasonId:guid}/organizations")] HttpRequestData req,
            Guid seasonId)
        {
            var denied = await ValidateAdminAccess(req);
            if (denied != null) return denied;

            using var connection = _connectionFactory.CreateConnection();
            if (!await SeasonExists(connection, seasonId))
                return req.CreateResponse(HttpStatusCode.NotFound);

            const string sql = @"
                SELECT
                    o.OrganizationId,
                    o.Name AS OrganizationName,
                    o.Abbreviation,
                    o.IsActive AS DirectoryIsActive,
                    o.OrganizationType,
                    CAST(CASE WHEN so.ParticipationType IS NOT NULL AND so.ParticipationType <> 'NotParticipating' THEN 1 ELSE 0 END AS bit) AS IsParticipating,
                    CASE WHEN so.ParticipationType IS NOT NULL AND so.ParticipationType <> 'NotParticipating'
                        THEN o.OrganizationType ELSE 'NotParticipating' END AS ParticipationType,
                    COUNT(t.Id) AS TeamCount
                FROM dbo.Organizations o
                LEFT JOIN dbo.SeasonOrganizations so
                    ON so.OrganizationId = o.OrganizationId
                   AND so.SeasonId = @SeasonId
                LEFT JOIN dbo.Teams t
                    ON t.OrganizationId = o.OrganizationId
                   AND t.SeasonId = @SeasonId
                GROUP BY
                    o.OrganizationId,
                    o.Name,
                    o.Abbreviation,
                    o.IsActive,
                    o.OrganizationType,
                    so.ParticipationType
                ORDER BY o.Name;";

            var organizations = await connection.QueryAsync<SeasonOrganizationDto>(sql, new { SeasonId = seasonId });
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(organizations);
            return response;
        }

        [Function("SaveSeasonOrganizations")]
        public async Task<HttpResponseData> SaveSeasonOrganizations(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "seasons/{seasonId:guid}/organizations")] HttpRequestData req,
            Guid seasonId)
        {
            var denied = await ValidateAdminAccess(req);
            if (denied != null) return denied;

            var body = await req.ReadFromJsonAsync<SaveSeasonOrganizationsRequestDto>();
            if (body?.Organizations == null)
                return await AuthorizationHelper.BadRequestResponse(req, "Organizations are required");

            var duplicateOrganization = body.Organizations
                .GroupBy(item => item.OrganizationId)
                .FirstOrDefault(group => group.Count() > 1);
            if (duplicateOrganization != null)
                return await AuthorizationHelper.BadRequestResponse(req, "Each organization can appear only once");

            using var connection = _connectionFactory.CreateConnection();
            if (!await SeasonExists(connection, seasonId))
                return req.CreateResponse(HttpStatusCode.NotFound);

            var organizationIds = body.Organizations.Select(item => item.OrganizationId).ToArray();
            var validOrganizations = organizationIds.Length == 0
                ? new List<SeasonOrganizationDirectoryRow>()
                : (await connection.QueryAsync<SeasonOrganizationDirectoryRow>(@"
                    SELECT OrganizationId, Name, OrganizationType
                    FROM dbo.Organizations
                    WHERE OrganizationId IN @OrganizationIds;",
                    new { OrganizationIds = organizationIds })).ToList();
            if (validOrganizations.Count != organizationIds.Length)
                return await AuthorizationHelper.BadRequestResponse(req, "One or more organizations do not exist");

            var organizationsById = validOrganizations.ToDictionary(item => item.OrganizationId);

            if (connection.State != ConnectionState.Open) connection.Open();
            using var transaction = connection.BeginTransaction();
            try
            {
                await connection.ExecuteAsync(
                    "DELETE FROM dbo.SeasonOrganizations WHERE SeasonId = @SeasonId;",
                    new { SeasonId = seasonId },
                    transaction);

                const string insertSql = @"
                    INSERT INTO dbo.SeasonOrganizations
                    (
                        SeasonId,
                        OrganizationId,
                        ParticipationType,
                        CreatedAt,
                        UpdatedAt
                    )
                    VALUES
                    (
                        @SeasonId,
                        @OrganizationId,
                        @ParticipationType,
                        SYSUTCDATETIME(),
                        SYSUTCDATETIME()
                    );";

                foreach (var item in body.Organizations)
                {
                    await connection.ExecuteAsync(insertSql, new
                    {
                        SeasonId = seasonId,
                        item.OrganizationId,
                        ParticipationType = IsParticipating(item)
                            ? NormalizeOrganizationType(organizationsById[item.OrganizationId].OrganizationType)
                            : "NotParticipating"
                    }, transaction);
                }

                transaction.Commit();
            }
            catch
            {
                transaction.Rollback();
                throw;
            }

            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        private async Task<HttpResponseData?> ValidateAdminAccess(HttpRequestData req)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrWhiteSpace(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "Token required");

            var (isValid, _, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid token");

            return _authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin")
                ? null
                : await AuthorizationHelper.ForbiddenResponse(req, "Insufficient role");
        }

        private static Task<bool> SeasonExists(IDbConnection connection, Guid seasonId)
        {
            return connection.ExecuteScalarAsync<bool>(@"
                SELECT CAST(CASE WHEN EXISTS
                (
                    SELECT 1 FROM dbo.Seasons WHERE SeasonId = @SeasonId
                ) THEN 1 ELSE 0 END AS bit);",
                new { SeasonId = seasonId });
        }

        private static bool IsParticipating(SaveSeasonOrganizationDto item)
        {
            return item.IsParticipating ??
                !string.Equals(item.ParticipationType, "NotParticipating", StringComparison.OrdinalIgnoreCase);
        }

        private static string NormalizeOrganizationType(string? organizationType)
        {
            return string.Equals(organizationType, "External", StringComparison.OrdinalIgnoreCase)
                ? "External"
                : "Managed";
        }

        private sealed class SeasonOrganizationDirectoryRow
        {
            public Guid OrganizationId { get; set; }
            public string Name { get; set; } = string.Empty;
            public string OrganizationType { get; set; } = "Managed";
        }
    }
}
