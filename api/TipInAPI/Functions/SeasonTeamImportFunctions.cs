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
    public class SeasonTeamImportFunctions
    {
        private readonly ISqlConnectionFactory _connectionFactory;
        private readonly IAuthorizationService _authorizationService;
        private readonly IAccessCodeService _accessCodeService;

        public SeasonTeamImportFunctions(
            ISqlConnectionFactory connectionFactory,
            IAuthorizationService authorizationService,
            IAccessCodeService accessCodeService)
        {
            _connectionFactory = connectionFactory;
            _authorizationService = authorizationService;
            _accessCodeService = accessCodeService;
        }

        [Function("GetSeasonTeamImportCandidates")]
        public async Task<HttpResponseData> GetCandidates(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "seasons/{targetSeasonId:guid}/team-import-candidates")] HttpRequestData req,
            Guid targetSeasonId)
        {
            var denied = await ValidateAdminAccess(req);
            if (denied != null) return denied;

            var query = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
            if (!Guid.TryParse(query["sourceSeasonId"], out var sourceSeasonId))
                return await AuthorizationHelper.BadRequestResponse(req, "A valid sourceSeasonId is required");
            if (sourceSeasonId == targetSeasonId)
                return await AuthorizationHelper.BadRequestResponse(req, "Source and target seasons must be different");

            using var connection = _connectionFactory.CreateConnection();
            if (!await SeasonExists(connection, sourceSeasonId) || !await SeasonExists(connection, targetSeasonId))
                return req.CreateResponse(HttpStatusCode.NotFound);

            var candidates = await connection.QueryAsync<SeasonTeamImportCandidateDto>(@"
                SELECT
                    source.Id AS SourceTeamId,
                    source.Name AS TeamName,
                    source.LevelId,
                    COALESCE(levels.Name, '') AS LevelName,
                    COALESCE(source.TeamType, '') AS TeamType,
                    source.OrganizationId,
                    COALESCE(org.Name, 'Organization') AS OrganizationName,
                    CAST(CASE WHEN org.OrganizationType = 'External' THEN 1 ELSE 0 END AS bit) AS IsExternal,
                    CAST(CASE WHEN target.Id IS NULL THEN 0 ELSE 1 END AS bit) AS AlreadyImported,
                    CAST(CASE
                        WHEN target.Id IS NOT NULL THEN 0
                        WHEN so.ParticipationType = org.OrganizationType THEN 1
                        ELSE 0
                    END AS bit) AS IsEligible,
                    CASE
                        WHEN target.Id IS NOT NULL THEN 'Already imported'
                        WHEN ISNULL(so.ParticipationType, '') <> org.OrganizationType THEN 'Organization is not participating in the target season'
                        ELSE NULL
                    END AS IneligibleReason
                FROM dbo.Teams source
                LEFT JOIN dbo.Organizations org ON org.OrganizationId = source.OrganizationId
                LEFT JOIN dbo.Levels levels ON levels.Id = source.LevelId
                LEFT JOIN dbo.SeasonOrganizations so
                    ON so.SeasonId = @TargetSeasonId
                   AND so.OrganizationId = source.OrganizationId
                LEFT JOIN dbo.Teams target
                    ON target.SeasonId = @TargetSeasonId
                   AND ((target.OrganizationId = source.OrganizationId) OR (target.OrganizationId IS NULL AND source.OrganizationId IS NULL))
                   AND target.LevelId = source.LevelId
                   AND ISNULL(target.TeamType, '') = ISNULL(source.TeamType, '')
                WHERE source.SeasonId = @SourceSeasonId
                ORDER BY COALESCE(org.Name, 'Organization'), source.Name, levels.Name, source.TeamType;",
                new { SourceSeasonId = sourceSeasonId, TargetSeasonId = targetSeasonId });

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(candidates);
            return response;
        }

        [Function("ImportSeasonTeams")]
        public async Task<HttpResponseData> ImportTeams(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "seasons/{targetSeasonId:guid}/teams/import")] HttpRequestData req,
            Guid targetSeasonId)
        {
            var denied = await ValidateAdminAccess(req);
            if (denied != null) return denied;

            var body = await req.ReadFromJsonAsync<ImportSeasonTeamsRequestDto>();
            var selectedIds = body?.TeamIds?.Where(id => id != Guid.Empty).Distinct().ToArray() ?? Array.Empty<Guid>();
            if (body == null || body.SourceSeasonId == Guid.Empty)
                return await AuthorizationHelper.BadRequestResponse(req, "A valid source season is required");
            if (body.SourceSeasonId == targetSeasonId)
                return await AuthorizationHelper.BadRequestResponse(req, "Source and target seasons must be different");
            if (selectedIds.Length == 0)
                return await AuthorizationHelper.BadRequestResponse(req, "Select at least one team to import");

            using var connection = _connectionFactory.CreateConnection();
            var targetIsActive = await connection.ExecuteScalarAsync<bool>(@"
                SELECT CAST(CASE WHEN EXISTS
                (
                    SELECT 1 FROM dbo.Seasons WHERE SeasonId = @TargetSeasonId AND IsActive = 1
                ) THEN 1 ELSE 0 END AS bit);",
                new { TargetSeasonId = targetSeasonId });
            if (!targetIsActive)
                return await AuthorizationHelper.BadRequestResponse(req, "Teams can only be imported into the active season");
            if (!await SeasonExists(connection, body.SourceSeasonId))
                return await AuthorizationHelper.BadRequestResponse(req, "Source season was not found");

            var sourceTeams = (await connection.QueryAsync<SourceTeamImportRow>(@"
                SELECT
                    source.Id AS SourceTeamId,
                    source.OrganizationId,
                    source.ConferenceDistrictId,
                    source.SectionRegionId,
                    source.LevelId,
                    source.Name,
                    source.Gender,
                    source.Abbreviation,
                    source.TeamType,
                    source.TeamMascot,
                    CASE WHEN org.OrganizationType = 'External' THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS IsExternal,
                    org.OrganizationType,
                    so.ParticipationType,
                    target.Id AS ExistingTargetTeamId
                FROM dbo.Teams source
                INNER JOIN dbo.Organizations org ON org.OrganizationId = source.OrganizationId
                LEFT JOIN dbo.SeasonOrganizations so
                    ON so.SeasonId = @TargetSeasonId
                   AND so.OrganizationId = source.OrganizationId
                LEFT JOIN dbo.Teams target
                    ON target.SeasonId = @TargetSeasonId
                   AND ((target.OrganizationId = source.OrganizationId) OR (target.OrganizationId IS NULL AND source.OrganizationId IS NULL))
                   AND target.LevelId = source.LevelId
                   AND ISNULL(target.TeamType, '') = ISNULL(source.TeamType, '')
                WHERE source.SeasonId = @SourceSeasonId
                  AND source.Id IN @SelectedIds;",
                new
                {
                    SourceSeasonId = body.SourceSeasonId,
                    TargetSeasonId = targetSeasonId,
                    SelectedIds = selectedIds
                })).ToList();

            if (sourceTeams.Count != selectedIds.Length)
                return await AuthorizationHelper.BadRequestResponse(req, "One or more selected teams were not found in the source season");

            var ineligible = sourceTeams.FirstOrDefault(team =>
                team.ExistingTargetTeamId.HasValue ||
                !string.Equals(team.ParticipationType, team.OrganizationType, StringComparison.OrdinalIgnoreCase));
            if (ineligible != null)
            {
                var reason = ineligible.ExistingTargetTeamId.HasValue
                    ? $"{ineligible.Name} has already been imported"
                    : $"{ineligible.Name}'s organization is not enabled for the target season";
                return await AuthorizationHelper.BadRequestResponse(req, reason);
            }

            if (connection.State != ConnectionState.Open) connection.Open();
            using var transaction = connection.BeginTransaction();
            try
            {
                const string insertSql = @"
                    INSERT INTO dbo.Teams
                    (
                        Id,
                        OrganizationId,
                        ConferenceDistrictId,
                        SectionRegionId,
                        LevelId,
                        SeasonId,
                        Name,
                        Gender,
                        Abbreviation,
                        TeamType,
                        TeamMascot,
                        HeadCoachName,
                        AssistantCoach1Name,
                        AssistantCoach2Name,
                        AssistantCoach3Name,
                        AssistantCoach4Name,
                        HeadCoachEmail,
                        AssistantCoach1Email,
                        AssistantCoach2Email,
                        AssistantCoach3Email,
                        AssistantCoach4Email,
                        AssistantCoach1HasLogin,
                        AssistantCoach2HasLogin,
                        AssistantCoach3HasLogin,
                        AssistantCoach4HasLogin,
                        ScorekeeperCode,
                        StatManagerCode,
                        IsActive,
                        IsExternal,
                        Notes
                    )
                    VALUES
                    (
                        @Id,
                        @OrganizationId,
                        @ConferenceDistrictId,
                        @SectionRegionId,
                        @LevelId,
                        @TargetSeasonId,
                        @Name,
                        @Gender,
                        @Abbreviation,
                        @TeamType,
                        @TeamMascot,
                        NULL, NULL, NULL, NULL, NULL,
                        NULL, NULL, NULL, NULL, NULL,
                        0, 0, 0, 0,
                        @GameManagerCode,
                        @StatManagerCode,
                        1,
                        @IsExternal,
                        NULL
                    );";

                foreach (var team in sourceTeams)
                {
                    await connection.ExecuteAsync(insertSql, new
                    {
                        Id = Guid.NewGuid(),
                        team.OrganizationId,
                        team.ConferenceDistrictId,
                        team.SectionRegionId,
                        team.LevelId,
                        TargetSeasonId = targetSeasonId,
                        team.Name,
                        team.Gender,
                        team.Abbreviation,
                        team.TeamType,
                        team.TeamMascot,
                        GameManagerCode = team.IsExternal ? null : _accessCodeService.GenerateGameManagerCode(),
                        StatManagerCode = team.IsExternal ? null : _accessCodeService.GenerateStatManagerCode(),
                        team.IsExternal
                    }, transaction);
                }

                transaction.Commit();
            }
            catch
            {
                transaction.Rollback();
                throw;
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new { importedCount = sourceTeams.Count });
            return response;
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

        private sealed class SourceTeamImportRow
        {
            public Guid SourceTeamId { get; set; }
            public Guid? OrganizationId { get; set; }
            public Guid? ConferenceDistrictId { get; set; }
            public Guid? SectionRegionId { get; set; }
            public Guid LevelId { get; set; }
            public string Name { get; set; } = string.Empty;
            public string? Gender { get; set; }
            public string? Abbreviation { get; set; }
            public string? TeamType { get; set; }
            public string? TeamMascot { get; set; }
            public bool IsExternal { get; set; }
            public string OrganizationType { get; set; } = "Managed";
            public string? ParticipationType { get; set; }
            public Guid? ExistingTargetTeamId { get; set; }
        }
    }
}
