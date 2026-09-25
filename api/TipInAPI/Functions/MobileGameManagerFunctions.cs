using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using Dapper;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using TipInAPI.Infrastructure.Database;
using TipInAPI.Services;

namespace TipInAPI.Functions
{
    public class MobileGameManagerFunctions
    {
        private readonly ISqlConnectionFactory _connectionFactory;
        private readonly IEmailService _emailService;
        private readonly IGameSummaryReportService _gameSummaryReportService;
        private readonly IGatewaySecretProtector _gatewaySecretProtector;
        private readonly IAccessCodeService _accessCodeService;

        public MobileGameManagerFunctions(
            ISqlConnectionFactory connectionFactory,
            IEmailService emailService,
            IGameSummaryReportService gameSummaryReportService,
            IGatewaySecretProtector gatewaySecretProtector,
            IAccessCodeService accessCodeService)
        {
            _connectionFactory = connectionFactory;
            _emailService = emailService;
            _gameSummaryReportService = gameSummaryReportService;
            _gatewaySecretProtector = gatewaySecretProtector;
            _accessCodeService = accessCodeService;
        }

        [Function("GetUserTeamsForMobile")]
        public async Task<HttpResponseData> GetUserTeamsForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "users/{userId}/teams")] HttpRequestData req,
            string userId)
        {
            using var conn = _connectionFactory.CreateConnection();

            var normalized = (userId ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(normalized))
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "userId is required." });
                return bad;
            }

            IEnumerable<MobileTeamDto> teams;

            if (Guid.TryParse(normalized, out var parsedUserId))
            {
                const string byUserSql = @"
                    SELECT DISTINCT
                        t.Id AS TeamId,
                        t.Name
                    FROM CoachTeams ct
                    INNER JOIN Teams t ON t.Id = ct.TeamId
                    WHERE ct.UserId = @UserId
                      AND t.IsActive = 1
                    ORDER BY t.Name;";

                teams = await conn.QueryAsync<MobileTeamDto>(byUserSql, new { UserId = parsedUserId });
            }
            else
            {
                var normalizedAccessCode = normalized.ToUpperInvariant();
                var accessCodeNoPrefix = normalizedAccessCode;
                var codeScope = "ANY";
                if (accessCodeNoPrefix.StartsWith("GM-") || accessCodeNoPrefix.StartsWith("SM-"))
                {
                    codeScope = accessCodeNoPrefix.StartsWith("GM-") ? "GM" : "SM";
                    accessCodeNoPrefix = accessCodeNoPrefix.Substring(3);
                }

                const string byCodeSql = @"
                    SELECT
                        t.Id AS TeamId,
                        t.Name
                    FROM Teams t
                    WHERE t.IsActive = 1
                      AND (
                        (
                            @CodeScope = 'GM'
                            AND (
                                UPPER(ISNULL(t.ScorekeeperCode, '')) = @AccessCode
                                OR UPPER(ISNULL(t.ScorekeeperCode, '')) = @AccessCodeNoPrefix
                                OR ('GM-' + UPPER(ISNULL(t.ScorekeeperCode, ''))) = @AccessCode
                            )
                        )
                        OR (
                            @CodeScope = 'SM'
                            AND (
                                UPPER(ISNULL(t.StatManagerCode, '')) = @AccessCode
                                OR UPPER(ISNULL(t.StatManagerCode, '')) = @AccessCodeNoPrefix
                                OR ('SM-' + UPPER(ISNULL(t.StatManagerCode, ''))) = @AccessCode
                            )
                        )
                        OR (
                            @CodeScope = 'ANY'
                            AND (
                                UPPER(ISNULL(t.ScorekeeperCode, '')) = @AccessCode
                                OR UPPER(ISNULL(t.StatManagerCode, '')) = @AccessCode
                                OR UPPER(ISNULL(t.ScorekeeperCode, '')) = @AccessCodeNoPrefix
                                OR UPPER(ISNULL(t.StatManagerCode, '')) = @AccessCodeNoPrefix
                                OR ('GM-' + UPPER(ISNULL(t.ScorekeeperCode, ''))) = @AccessCode
                                OR ('SM-' + UPPER(ISNULL(t.StatManagerCode, ''))) = @AccessCode
                            )
                        )
                      )
                    ORDER BY t.Name;";

                teams = await conn.QueryAsync<MobileTeamDto>(byCodeSql, new
                {
                    AccessCode = normalizedAccessCode,
                    AccessCodeNoPrefix = accessCodeNoPrefix,
                    CodeScope = codeScope
                });

                var matchedTeams = teams.ToList();
                if ((codeScope == "GM" || codeScope == "SM") && matchedTeams.Count > 1)
                {
                    const string chooseBestTeamSql = @"
                        SELECT TOP 1
                            t.Id AS TeamId
                        FROM Teams t
                        OUTER APPLY (
                            SELECT TOP 1
                                g.GameDateTime AS StartTime
                            FROM Games g
                                                        WHERE g.HomeTeamId = t.Id
                              AND UPPER(ISNULL(g.Status, 'SCHEDULED')) NOT IN (
                                    'COMPLETED',
                                    'CLOSED',
                                    'FINAL',
                                    'CANCELLED',
                                    'CANCELED',
                                    'POSTPONED',
                                    'PPD'
                              )
                                AND (
                                    UPPER(ISNULL(g.Status, 'SCHEDULED')) IN ('IN PROGRESS', 'IN_PROGRESS', 'ACTIVE')
                                    OR g.GameDateTime BETWEEN DATEADD(HOUR, -6, SYSUTCDATETIME()) AND DATEADD(HOUR, 48, SYSUTCDATETIME())
                                )
                            ORDER BY
                                CASE
                                    WHEN CAST(g.GameDateTime AS date) = CAST(SYSDATETIME() AS date) THEN 0
                                    ELSE 1
                                END,
                                CASE
                                    WHEN CAST(g.GameDateTime AS date) = CAST(SYSDATETIME() AS date)
                                         AND g.GameDateTime >= SYSDATETIME() THEN 0
                                    WHEN CAST(g.GameDateTime AS date) = CAST(SYSDATETIME() AS date) THEN 1
                                    ELSE 0
                                END,
                                CASE
                                    WHEN CAST(g.GameDateTime AS date) = CAST(SYSDATETIME() AS date)
                                        THEN ABS(DATEDIFF(MINUTE, SYSDATETIME(), g.GameDateTime))
                                    ELSE DATEDIFF(MINUTE, SYSUTCDATETIME(), g.GameDateTime)
                                END,
                                g.GameDateTime ASC
                        ) ng
                        WHERE t.Id IN @TeamIds
                        ORDER BY
                            CASE WHEN ng.StartTime IS NULL THEN 1 ELSE 0 END,
                            CASE
                                WHEN ng.StartTime IS NOT NULL
                                     AND CAST(ng.StartTime AS date) = CAST(SYSDATETIME() AS date) THEN 0
                                ELSE 1
                            END,
                            CASE
                                WHEN ng.StartTime IS NOT NULL
                                     AND CAST(ng.StartTime AS date) = CAST(SYSDATETIME() AS date)
                                     AND ng.StartTime >= SYSDATETIME() THEN 0
                                WHEN ng.StartTime IS NOT NULL
                                     AND CAST(ng.StartTime AS date) = CAST(SYSDATETIME() AS date) THEN 1
                                ELSE 0
                            END,
                            CASE
                                WHEN ng.StartTime IS NULL THEN 2147483647
                                WHEN CAST(ng.StartTime AS date) = CAST(SYSDATETIME() AS date)
                                    THEN ABS(DATEDIFF(MINUTE, SYSDATETIME(), ng.StartTime))
                                ELSE DATEDIFF(MINUTE, SYSUTCDATETIME(), ng.StartTime)
                            END,
                            t.Name ASC;";

                    var bestTeamId = await conn.QueryFirstOrDefaultAsync<Guid?>(
                        chooseBestTeamSql,
                        new { TeamIds = matchedTeams.Select(t => t.TeamId).ToArray() });

                    if (bestTeamId.HasValue)
                    {
                        teams = matchedTeams.Where(t => t.TeamId == bestTeamId.Value).ToArray();
                    }
                    else
                    {
                        teams = matchedTeams.Take(1).ToArray();
                    }
                }
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(teams.ToArray());
            return response;
        }

        [Function("GetTeamNextGame")]
        public async Task<HttpResponseData> GetTeamNextGame(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "teams/{teamId:guid}/nextgame")] HttpRequestData req,
            Guid teamId)
        {
            using var conn = _connectionFactory.CreateConnection();

            const string sql = @"
                SELECT TOP 1
                    g.GameId,
                    g.HomeTeamId,
                    ht.Name AS HomeTeamName,
                    COALESCE(NULLIF(ht.TeamMascot, ''), ho.Mascot) AS HomeTeamMascot,
                    g.AwayTeamId,
                    at.Name AS AwayTeamName,
                    COALESCE(NULLIF(at.TeamMascot, ''), ao.Mascot) AS AwayTeamMascot,
                    CASE
                        WHEN g.HomeTeamId = @TeamId THEN at.Name
                        ELSE ht.Name
                    END AS OpponentName,
                    g.GameDateTime AS StartTime,
                    g.Status,
                    g.ArenaId,
                    g.RinkId,
                    g.ArenaName,
                    g.RinkName,
                    CAST(CASE WHEN EXISTS (
                        SELECT 1 FROM dbo.ScoreboardGateways sg
                        WHERE sg.RinkId = g.RinkId AND sg.IsPrimary = 1 AND sg.IsActive = 1
                    ) THEN 1 ELSE 0 END AS bit) AS GatewayAvailable,
                    gt.Name AS GameTypeName,
                    g.PeriodLengthMinutes,
                    l.Name AS LevelName,
                    t.TeamType,
                    cd.Name AS ConferenceDistrictName,
                    sr.Name AS SectionRegionName
                FROM Games g
                LEFT JOIN Teams ht ON g.HomeTeamId = ht.Id
                LEFT JOIN Teams at ON g.AwayTeamId = at.Id
                LEFT JOIN Teams t ON t.Id = @TeamId
                LEFT JOIN Organizations ho ON ho.OrganizationId = ht.OrganizationId
                LEFT JOIN Organizations ao ON ao.OrganizationId = at.OrganizationId
                LEFT JOIN Levels l ON t.LevelId = l.Id
                LEFT JOIN GameTypes gt ON g.GameTypeId = gt.GameTypeId
                LEFT JOIN ConferenceDistricts cd ON t.ConferenceDistrictId = cd.Id
                LEFT JOIN SectionRegions sr ON t.SectionRegionId = sr.Id
                WHERE (g.HomeTeamId = @TeamId OR g.AwayTeamId = @TeamId)
                                    AND UPPER(ISNULL(g.Status, 'SCHEDULED')) NOT IN (
                                                'COMPLETED',
                                                'CLOSED',
                                                'FINAL',
                                                'CANCELLED',
                                                'CANCELED',
                                                'POSTPONED',
                                                'PPD'
                                    )
                                            AND (
                                                UPPER(ISNULL(g.Status, 'SCHEDULED')) IN ('IN PROGRESS', 'IN_PROGRESS', 'ACTIVE')
                                                OR g.GameDateTime BETWEEN DATEADD(HOUR, -6, SYSUTCDATETIME()) AND DATEADD(HOUR, 48, SYSUTCDATETIME())
                                            )
                                ORDER BY
                                            CASE
                                                WHEN UPPER(ISNULL(g.Status, 'SCHEDULED')) IN ('IN PROGRESS', 'IN_PROGRESS', 'ACTIVE') THEN 0
                                                ELSE 1
                                            END,
                                        CASE
                                                WHEN CAST(g.GameDateTime AS date) = CAST(SYSDATETIME() AS date) THEN 0
                                                ELSE 1
                                        END,
                                        CASE
                                                WHEN CAST(g.GameDateTime AS date) = CAST(SYSDATETIME() AS date)
                                                         AND g.GameDateTime >= SYSDATETIME() THEN 0
                                                WHEN CAST(g.GameDateTime AS date) = CAST(SYSDATETIME() AS date) THEN 1
                                                ELSE 0
                                        END,
                                        CASE
                                                WHEN CAST(g.GameDateTime AS date) = CAST(SYSDATETIME() AS date)
                                                        THEN ABS(DATEDIFF(MINUTE, SYSDATETIME(), g.GameDateTime))
                                                ELSE DATEDIFF(MINUTE, SYSUTCDATETIME(), g.GameDateTime)
                                        END,
                                        g.GameDateTime ASC;";

            var nextGame = await conn.QueryFirstOrDefaultAsync<MobileNextGameDto>(sql, new { TeamId = teamId });
            if (nextGame == null)
            {
                const string closedSql = @"
                    SELECT TOP 1
                        g.GameId,
                        g.GameDateTime AS StartTime,
                        g.Status,
                        CASE
                            WHEN g.HomeTeamId = @TeamId THEN at.Name
                            ELSE ht.Name
                        END AS OpponentName
                    FROM Games g
                    LEFT JOIN Teams ht ON g.HomeTeamId = ht.Id
                    LEFT JOIN Teams at ON g.AwayTeamId = at.Id
                                        WHERE (g.HomeTeamId = @TeamId OR g.AwayTeamId = @TeamId)
                      AND UPPER(ISNULL(g.Status, '')) IN ('COMPLETED', 'CLOSED', 'FINAL')
                    ORDER BY g.GameDateTime DESC;";

                var closedGame = await conn.QueryFirstOrDefaultAsync<MobileClosedGameDto>(closedSql, new { TeamId = teamId });
                if (closedGame != null)
                {
                    var gone = req.CreateResponse(HttpStatusCode.Gone);
                    await gone.WriteAsJsonAsync(new
                    {
                        IsClosed = true,
                        Message = $"The scheduled game vs {closedGame.OpponentName} is closed.",
                        closedGame.GameId,
                        closedGame.StartTime,
                        closedGame.Status
                    });
                    return gone;
                }

                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            var normalizedStatus = (nextGame.Status ?? "SCHEDULED").Trim().ToUpperInvariant();
            var isActive = normalizedStatus is "IN PROGRESS" or "IN_PROGRESS" or "ACTIVE";
            if (!isActive && nextGame.StartTime > DateTime.UtcNow.AddHours(4))
            {
                var tooEarly = req.CreateResponse((HttpStatusCode)425);
                await tooEarly.WriteAsJsonAsync(new
                {
                    error = "login_too_early",
                    message = $"Login opens four hours before the scheduled game time ({nextGame.StartTime:u}).",
                    nextGame.StartTime
                });
                return tooEarly;
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(nextGame);
            return response;
        }

        [Function("GetGameGatewayForMobile")]
        public async Task<HttpResponseData> GetGameGatewayForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "games/{gameId:guid}/gateway-mobile")] HttpRequestData req,
            Guid gameId)
        {
            var accessCode = req.Headers.TryGetValues("x-TipIn-access-code", out var values)
                ? values.FirstOrDefault()?.Trim().ToUpperInvariant()
                : null;
            if (string.IsNullOrWhiteSpace(accessCode) || !accessCode.StartsWith("GM-", StringComparison.OrdinalIgnoreCase))
            {
                var unauthorized = req.CreateResponse(HttpStatusCode.Unauthorized);
                await unauthorized.WriteAsJsonAsync(new { error = "A valid Game Manager access code is required." });
                return unauthorized;
            }

            var codeWithoutPrefix = accessCode[3..];
            using var conn = _connectionFactory.CreateConnection();
                        var authorization = await conn.QueryFirstOrDefaultAsync<MobileGatewayAuthorizationRow>(@"
                                SELECT TOP 1 g.GameDateTime
                                FROM dbo.Games g
                                INNER JOIN dbo.Teams t ON t.Id IN (g.HomeTeamId, g.AwayTeamId)
                                WHERE g.GameId = @GameId
                                    AND (UPPER(ISNULL(t.ScorekeeperCode, '')) = @AccessCode
                                             OR UPPER(ISNULL(t.ScorekeeperCode, '')) = @CodeWithoutPrefix
                                             OR 'GM-' + UPPER(ISNULL(t.ScorekeeperCode, '')) = @AccessCode);",
                new { GameId = gameId, AccessCode = accessCode, CodeWithoutPrefix = codeWithoutPrefix });
                        if (authorization == null || !_accessCodeService.IsValidGameDay(authorization.GameDateTime))
            {
                var forbidden = req.CreateResponse(HttpStatusCode.Forbidden);
                await forbidden.WriteAsJsonAsync(new { error = "The access code is not valid for this game." });
                return forbidden;
            }

            var gateway = await conn.QueryFirstOrDefaultAsync<MobileGatewayRow>(@"
                SELECT TOP 1 sg.GatewayId, sg.Name, sg.Host, sg.Port, sg.WebSocketSecretEncrypted
                FROM dbo.Games g
                INNER JOIN dbo.ScoreboardGateways sg ON sg.RinkId = g.RinkId
                WHERE g.GameId = @GameId AND sg.IsPrimary = 1 AND sg.IsActive = 1
                ORDER BY sg.UpdatedAt DESC;", new { GameId = gameId });

            var response = req.CreateResponse(HttpStatusCode.OK);
            if (gateway == null)
            {
                await response.WriteAsJsonAsync(new { mode = "manual", gatewayAvailable = false });
                return response;
            }

            await response.WriteAsJsonAsync(new
            {
                mode = "gateway",
                gatewayAvailable = true,
                gateway.GatewayId,
                gateway.Name,
                gateway.Host,
                gateway.Port,
                tokenSecret = _gatewaySecretProtector.Unprotect(gateway.WebSocketSecretEncrypted)
            });
            return response;
        }

        [Function("GetGameSummaryForMobile")]
        public async Task<HttpResponseData> GetGameSummaryForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "games/{gameId:guid}/summary-mobile")] HttpRequestData req,
            Guid gameId)
        {
            using var conn = _connectionFactory.CreateConnection();

            const string goalsSql = @"
                SELECT
                    ge.Id AS EventId,
                    gg.GameId,
                    gg.Period,
                    gg.TimeInPeriod,
                    gg.Strength,
                    t.Name AS TeamName,
                    p.FullName AS ScorerName,
                    a1.FullName AS Assist1Name,
                    a2.FullName AS Assist2Name
                FROM dbo.GameGoals gg
                INNER JOIN dbo.GameEvents ge ON ge.Id = gg.EventId
                INNER JOIN dbo.Teams t ON t.Id = gg.ScoringTeamId
                INNER JOIN dbo.Players p ON p.PlayerId = gg.ScorerId
                LEFT JOIN dbo.Players a1 ON a1.PlayerId = gg.Assist1Id
                LEFT JOIN dbo.Players a2 ON a2.PlayerId = gg.Assist2Id
                WHERE gg.GameId = @GameId
                ORDER BY gg.Period, gg.TimeInPeriod, gg.CreatedAt;";

            const string penaltiesSql = @"
                SELECT
                    ge.Id AS EventId,
                    gp.GameId,
                    gp.Period,
                    gp.TimeInPeriod,
                    gp.DurationMinutes,
                    gp.Infraction,
                    JSON_VALUE(ge.Details, '$.PenaltyType') AS PenaltyType,
                    gp.Notes,
                    t.Name AS TeamName,
                    p.FullName AS PlayerName
                FROM dbo.GamePenalties gp
                INNER JOIN dbo.GameEvents ge ON ge.Id = gp.EventId
                INNER JOIN dbo.Teams t ON t.Id = gp.TeamId
                INNER JOIN dbo.Players p ON p.PlayerId = gp.PlayerId
                WHERE gp.GameId = @GameId
                ORDER BY gp.Period, gp.TimeInPeriod, gp.CreatedAt;";

                        const string shotEventsSql = @"
                                SELECT
                                        ge.Id AS EventId,
                                        ge.GameId,
                                        ge.Period,
                                        ge.TimeInPeriod,
                                        ge.TeamId,
                                        t.Name AS TeamName,
                                        ge.CreatedAt
                                FROM dbo.GameEvents ge
                                INNER JOIN dbo.Teams t ON t.Id = ge.TeamId
                                WHERE ge.GameId = @GameId
                                    AND ge.EventType = 'Shot'
                                ORDER BY ge.Period, ge.TimeInPeriod, ge.CreatedAt;";

            const string shotsSql = @"
                IF OBJECT_ID('dbo.GameStatsSnapshots', 'U') IS NULL
                BEGIN
                    SELECT
                        CAST(NULL AS INT) AS HomeShotsP1,
                        CAST(NULL AS INT) AS HomeShotsP2,
                        CAST(NULL AS INT) AS HomeShotsP3,
                        CAST(NULL AS INT) AS HomeShotsOT,
                        CAST(NULL AS INT) AS HomeShotsTotal,
                        CAST(NULL AS INT) AS AwayShotsP1,
                        CAST(NULL AS INT) AS AwayShotsP2,
                        CAST(NULL AS INT) AS AwayShotsP3,
                        CAST(NULL AS INT) AS AwayShotsOT,
                        CAST(NULL AS INT) AS AwayShotsTotal;
                END
                ELSE
                BEGIN
                    SELECT TOP 1
                        HomeShotsP1,
                        HomeShotsP2,
                        HomeShotsP3,
                        HomeShotsOT,
                        HomeShotsTotal,
                        AwayShotsP1,
                        AwayShotsP2,
                        AwayShotsP3,
                        AwayShotsOT,
                        AwayShotsTotal
                    FROM dbo.GameStatsSnapshots
                    WHERE GameId = @GameId;
                END";

            var goals = (await conn.QueryAsync<MobileSummaryGoalRow>(goalsSql, new { GameId = gameId }))
                .Select(goal => new
                {
                    goal.EventId,
                    goal.GameId,
                    goal.Period,
                    goal.TimeInPeriod,
                    goal.TeamName,
                    goal.ScorerName,
                    goal.Assist1Name,
                    goal.Assist2Name,
                    StrengthCode = goal.Strength,
                    StrengthLabel = ToGoalStrengthDisplayLabel(goal.Strength)
                })
                .ToArray();

            var penalties = (await conn.QueryAsync<MobileSummaryPenaltyRow>(penaltiesSql, new { GameId = gameId }))
                .Select(penalty => new
                {
                    penalty.EventId,
                    penalty.GameId,
                    penalty.Period,
                    penalty.TimeInPeriod,
                    penalty.TeamName,
                    penalty.PlayerName,
                    penalty.Infraction,
                    penalty.DurationMinutes,
                    PenaltyType = string.IsNullOrWhiteSpace(penalty.PenaltyType) ? "Minor" : penalty.PenaltyType,
                    DurationLabel = ToPenaltyDurationDisplayLabel(penalty.PenaltyType, penalty.Infraction, penalty.DurationMinutes),
                    penalty.Notes
                })
                .ToArray();

            var shotEvents = (await conn.QueryAsync<MobileSummaryShotRow>(shotEventsSql, new { GameId = gameId }))
                .ToArray();

            var shotTotals = await conn.QueryFirstOrDefaultAsync<MobileShotTotalsRow>(shotsSql, new { GameId = gameId });
            var homeShotsP1 = shotTotals?.HomeShotsP1;
            var homeShotsP2 = shotTotals?.HomeShotsP2;
            var homeShotsP3 = shotTotals?.HomeShotsP3;
            var homeShotsOT = shotTotals?.HomeShotsOT;
            var homeShotsTotal = shotTotals?.HomeShotsTotal;
            var awayShotsP1 = shotTotals?.AwayShotsP1;
            var awayShotsP2 = shotTotals?.AwayShotsP2;
            var awayShotsP3 = shotTotals?.AwayShotsP3;
            var awayShotsOT = shotTotals?.AwayShotsOT;
            var awayShotsTotal = shotTotals?.AwayShotsTotal;

            bool? homeOnPowerPlay = null;
            bool? awayOnPowerPlay = null;
            int? homeSkatersOnIce = null;
            int? awaySkatersOnIce = null;
            string? homeStartersJson = null;
            string? awayStartersJson = null;
            if (ObjectExistsInDb(conn, "GameLiveStatus"))
            {
                // Ensure new columns exist on tables created by earlier deployments.
                try
                {
                    await conn.ExecuteAsync(@"
                        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.GameLiveStatus') AND name = 'HomeSkatersOnIce')
                            ALTER TABLE dbo.GameLiveStatus ADD HomeSkatersOnIce INT NULL;
                        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.GameLiveStatus') AND name = 'AwaySkatersOnIce')
                            ALTER TABLE dbo.GameLiveStatus ADD AwaySkatersOnIce INT NULL;
                        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.GameLiveStatus') AND name = 'HomeStartersJson')
                            ALTER TABLE dbo.GameLiveStatus ADD HomeStartersJson NVARCHAR(MAX) NULL;
                        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.GameLiveStatus') AND name = 'AwayStartersJson')
                            ALTER TABLE dbo.GameLiveStatus ADD AwayStartersJson NVARCHAR(MAX) NULL;");
                }
                catch { /* Non-fatal; columns may already exist or may be unavailable. */ }

                try
                {
                    var liveStatus = await conn.QueryFirstOrDefaultAsync<MobileLiveStatusRow>(
                        "SELECT HomeOnPowerPlay, AwayOnPowerPlay, HomeSkatersOnIce, AwaySkatersOnIce, HomeStartersJson, AwayStartersJson FROM dbo.GameLiveStatus WHERE GameId = @GameId;",
                        new { GameId = gameId });
                    if (liveStatus != null)
                    {
                        homeOnPowerPlay = liveStatus.HomeOnPowerPlay;
                        awayOnPowerPlay = liveStatus.AwayOnPowerPlay;
                        homeSkatersOnIce = liveStatus.HomeSkatersOnIce;
                        awaySkatersOnIce = liveStatus.AwaySkatersOnIce;
                        homeStartersJson = liveStatus.HomeStartersJson;
                        awayStartersJson = liveStatus.AwayStartersJson;
                    }
                }
                catch { /* Fall through with null values; GameView falls back to penalty heuristic. */ }
            }

            // Deserialize starter ID arrays for the response
            static List<string>? ParseIdList(string? json)
            {
                if (string.IsNullOrWhiteSpace(json)) return null;
                try { return System.Text.Json.JsonSerializer.Deserialize<List<string>>(json); } catch { return null; }
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                GameId = gameId,
                Goals = goals,
                Penalties = penalties,
                Shots = shotEvents,
                HomeShotsP1 = homeShotsP1,
                HomeShotsP2 = homeShotsP2,
                HomeShotsP3 = homeShotsP3,
                HomeShotsOT = homeShotsOT,
                HomeShots = homeShotsTotal,
                AwayShotsP1 = awayShotsP1,
                AwayShotsP2 = awayShotsP2,
                AwayShotsP3 = awayShotsP3,
                AwayShotsOT = awayShotsOT,
                AwayShots = awayShotsTotal,
                HomeOnPowerPlay = homeOnPowerPlay,
                AwayOnPowerPlay = awayOnPowerPlay,
                HomeSkatersOnIce = homeSkatersOnIce,
                AwaySkatersOnIce = awaySkatersOnIce,
                HomeStarterIds = ParseIdList(homeStartersJson),
                AwayStarterIds = ParseIdList(awayStartersJson),
            });
            return response;
        }

        private static bool ObjectExistsInDb(System.Data.IDbConnection conn, string tableName)
        {
            return conn.QueryFirstOrDefault<int>(
                "SELECT COUNT(1) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @TableName;",
                new { TableName = tableName }) > 0;
        }

        [Function("UpsertGameShotsForMobile")]
        public async Task<HttpResponseData> UpsertGameShotsForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "games/{gameId:guid}/shots-mobile")] HttpRequestData req,
            Guid gameId)
        {
            var payload = await req.ReadFromJsonAsync<MobileShotSummaryRequest>();
            using var conn = _connectionFactory.CreateConnection();

            const string ensureSnapshotTableSql = @"
                IF OBJECT_ID('dbo.GameStatsSnapshots', 'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.GameStatsSnapshots
                    (
                        GameId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
                        HomeShotsP1 INT NULL,
                        HomeShotsP2 INT NULL,
                        HomeShotsP3 INT NULL,
                        HomeShotsOT INT NULL,
                        AwayShotsP1 INT NULL,
                        AwayShotsP2 INT NULL,
                        AwayShotsP3 INT NULL,
                        AwayShotsOT INT NULL,
                        HomeShotsTotal INT NULL,
                        AwayShotsTotal INT NULL,
                        GoalieSummaryJson NVARCHAR(MAX) NULL,
                        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_GameStatsSnapshots_CreatedAt DEFAULT SYSUTCDATETIME(),
                        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_GameStatsSnapshots_UpdatedAt DEFAULT SYSUTCDATETIME()
                    );

                    ALTER TABLE dbo.GameStatsSnapshots
                    ADD CONSTRAINT FK_GameStatsSnapshots_Games
                    FOREIGN KEY (GameId) REFERENCES dbo.Games (GameId);
                END;";

            const string upsertSnapshotSql = @"
                MERGE dbo.GameStatsSnapshots AS target
                USING (SELECT @GameId AS GameId) AS source
                ON target.GameId = source.GameId
                WHEN MATCHED THEN
                    UPDATE SET
                        HomeShotsP1 = @HomeShotsP1,
                        HomeShotsP2 = @HomeShotsP2,
                        HomeShotsP3 = @HomeShotsP3,
                        HomeShotsOT = @HomeShotsOT,
                        AwayShotsP1 = @AwayShotsP1,
                        AwayShotsP2 = @AwayShotsP2,
                        AwayShotsP3 = @AwayShotsP3,
                        AwayShotsOT = @AwayShotsOT,
                        HomeShotsTotal = @HomeShotsTotal,
                        AwayShotsTotal = @AwayShotsTotal,
                        UpdatedAt = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN
                    INSERT
                    (
                        GameId,
                        HomeShotsP1,
                        HomeShotsP2,
                        HomeShotsP3,
                        HomeShotsOT,
                        AwayShotsP1,
                        AwayShotsP2,
                        AwayShotsP3,
                        AwayShotsOT,
                        HomeShotsTotal,
                        AwayShotsTotal,
                        CreatedAt,
                        UpdatedAt
                    )
                    VALUES
                    (
                        @GameId,
                        @HomeShotsP1,
                        @HomeShotsP2,
                        @HomeShotsP3,
                        @HomeShotsOT,
                        @AwayShotsP1,
                        @AwayShotsP2,
                        @AwayShotsP3,
                        @AwayShotsOT,
                        @HomeShotsTotal,
                        @AwayShotsTotal,
                        SYSUTCDATETIME(),
                        SYSUTCDATETIME()
                    );";

            await conn.ExecuteAsync(ensureSnapshotTableSql);
            await conn.ExecuteAsync(upsertSnapshotSql, new
            {
                GameId = gameId,
                HomeShotsP1 = payload?.HomeByPeriod?.P1,
                HomeShotsP2 = payload?.HomeByPeriod?.P2,
                HomeShotsP3 = payload?.HomeByPeriod?.P3,
                HomeShotsOT = payload?.HomeByPeriod?.OT,
                AwayShotsP1 = payload?.AwayByPeriod?.P1,
                AwayShotsP2 = payload?.AwayByPeriod?.P2,
                AwayShotsP3 = payload?.AwayByPeriod?.P3,
                AwayShotsOT = payload?.AwayByPeriod?.OT,
                HomeShotsTotal = payload?.HomeTotal,
                AwayShotsTotal = payload?.AwayTotal,
            });

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                GameId = gameId,
                Saved = true
            });
            return response;
        }

        [Function("PutGameLiveStatus")]
        public async Task<HttpResponseData> PutGameLiveStatus(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "games/{gameId:guid}/live-status")] HttpRequestData req,
            Guid gameId)
        {
            var payload = await req.ReadFromJsonAsync<MobileLiveStatusRequest>();
            if (payload == null)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "Invalid live-status payload." });
                return bad;
            }

            using var conn = _connectionFactory.CreateConnection();

            const string ensureTableSql = @"
                IF OBJECT_ID('dbo.GameLiveStatus', 'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.GameLiveStatus
                    (
                        GameId            UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
                        HomeOnPowerPlay   BIT NOT NULL CONSTRAINT DF_GameLiveStatus_HomeOnPowerPlay DEFAULT 0,
                        AwayOnPowerPlay   BIT NOT NULL CONSTRAINT DF_GameLiveStatus_AwayOnPowerPlay DEFAULT 0,
                        CurrentPeriod     INT NULL,
                        HomeSkatersOnIce  INT NULL,
                        AwaySkatersOnIce  INT NULL,
                        HomeStartersJson  NVARCHAR(MAX) NULL,
                        AwayStartersJson  NVARCHAR(MAX) NULL,
                        UpdatedAt         DATETIME2 NOT NULL CONSTRAINT DF_GameLiveStatus_UpdatedAt DEFAULT SYSUTCDATETIME()
                    );
                END;

                IF COL_LENGTH('dbo.GameLiveStatus', 'CurrentPeriod') IS NULL
                BEGIN
                    ALTER TABLE dbo.GameLiveStatus ADD CurrentPeriod INT NULL;
                END;

                IF COL_LENGTH('dbo.GameLiveStatus', 'HomeStartersJson') IS NULL
                BEGIN
                    ALTER TABLE dbo.GameLiveStatus ADD HomeStartersJson NVARCHAR(MAX) NULL;
                END;

                IF COL_LENGTH('dbo.GameLiveStatus', 'AwayStartersJson') IS NULL
                BEGIN
                    ALTER TABLE dbo.GameLiveStatus ADD AwayStartersJson NVARCHAR(MAX) NULL;
                END;";

            const string upsertSql = @"
                MERGE dbo.GameLiveStatus AS target
                USING (SELECT @GameId AS GameId) AS source ON target.GameId = source.GameId
                WHEN MATCHED THEN
                    UPDATE SET
                        HomeOnPowerPlay  = @HomeOnPowerPlay,
                        AwayOnPowerPlay  = @AwayOnPowerPlay,
                        CurrentPeriod    = @CurrentPeriod,
                        HomeSkatersOnIce = @HomeSkatersOnIce,
                        AwaySkatersOnIce = @AwaySkatersOnIce,
                        HomeStartersJson = @HomeStartersJson,
                        AwayStartersJson = @AwayStartersJson,
                        UpdatedAt        = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN
                    INSERT (GameId, HomeOnPowerPlay, AwayOnPowerPlay, CurrentPeriod, HomeSkatersOnIce, AwaySkatersOnIce, HomeStartersJson, AwayStartersJson)
                    VALUES (@GameId, @HomeOnPowerPlay, @AwayOnPowerPlay, @CurrentPeriod, @HomeSkatersOnIce, @AwaySkatersOnIce, @HomeStartersJson, @AwayStartersJson);";

            await conn.ExecuteAsync(ensureTableSql);
            await conn.ExecuteAsync(upsertSql, new
            {
                GameId = gameId,
                HomeOnPowerPlay = payload.HomeOnPowerPlay ? 1 : 0,
                AwayOnPowerPlay = payload.AwayOnPowerPlay ? 1 : 0,
                CurrentPeriod = payload.CurrentPeriod,
                HomeSkatersOnIce = payload.HomeSkatersOnIce,
                AwaySkatersOnIce = payload.AwaySkatersOnIce,
                HomeStartersJson = payload.HomeStarterIds == null ? null : System.Text.Json.JsonSerializer.Serialize(payload.HomeStarterIds),
                AwayStartersJson = payload.AwayStarterIds == null ? null : System.Text.Json.JsonSerializer.Serialize(payload.AwayStarterIds),
            });

            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteAsJsonAsync(new { GameId = gameId, payload.HomeOnPowerPlay, payload.AwayOnPowerPlay, payload.CurrentPeriod });
            return ok;
        }

        [Function("StartGameForMobile")]
        public async Task<HttpResponseData> StartGameForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "games/{gameId:guid}/start-mobile")] HttpRequestData req,
            Guid gameId)
        {
            using var conn = _connectionFactory.CreateConnection();

            const string sql = @"
                UPDATE dbo.Games
                SET
                    Status = 'In Progress',
                    UpdatedAt = SYSUTCDATETIME()
                WHERE GameId = @GameId
                  AND UPPER(ISNULL(Status, 'SCHEDULED')) NOT IN ('FINAL', 'COMPLETED', 'CLOSED');";

            var updated = await conn.ExecuteAsync(sql, new { GameId = gameId });
            if (updated == 0)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                GameId = gameId,
                Status = "In Progress"
            });
            return response;
        }

        [Function("GetTeamRosterForMobile")]
        public async Task<HttpResponseData> GetTeamRosterForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "teams/{teamId:guid}/roster-mobile")] HttpRequestData req,
            Guid teamId)
        {
            using var conn = _connectionFactory.CreateConnection();

            const string sql = @"
                SELECT
                    r.PlayerId,
                    COALESCE(NULLIF(p.FullName, ''), CONCAT(p.FirstName, ' ', p.LastName)) AS FullName,
                    COALESCE(r.JerseyNumber, p.JerseyNumber) AS JerseyNumber,
                    COALESCE(NULLIF(r.Position, ''), p.Position) AS Position,
                    COALESCE(r.Grade, p.Grade) AS Grade,
                    r.IsGoalie,
                    r.IsActive
                FROM RosterEntries r
                INNER JOIN Players p ON p.PlayerId = r.PlayerId
                WHERE r.TeamId = @TeamId
                ORDER BY r.JerseyNumber ASC, p.LastName ASC, p.FirstName ASC;";

            var players = await conn.QueryAsync<MobileRosterPlayerDto>(sql, new { TeamId = teamId });

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(players.ToArray());
            return response;
        }

        [Function("GetTeamCoachesForMobile")]
        public async Task<HttpResponseData> GetTeamCoachesForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "teams/{teamId:guid}/coaches-mobile")] HttpRequestData req,
            Guid teamId)
        {
            using var conn = _connectionFactory.CreateConnection();

            const string sql = @"
                SELECT
                    t.HeadCoachName,
                    t.HeadCoachEmail,
                    t.AssistantCoach1Name,
                    t.AssistantCoach1Email,
                    t.AssistantCoach2Name,
                    t.AssistantCoach2Email,
                    t.AssistantCoach3Name,
                    t.AssistantCoach3Email,
                    t.AssistantCoach4Name,
                    t.AssistantCoach4Email
                FROM Teams t
                WHERE t.Id = @TeamId;";

            var team = await conn.QueryFirstOrDefaultAsync<MobileTeamCoachNamesDto>(sql, new { TeamId = teamId });

            if (team == null)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            var coaches = new List<MobileCoachDto>();
            AddCoachIfPresent(coaches, "Head Coach", team.HeadCoachName, team.HeadCoachEmail);
            AddCoachIfPresent(coaches, "Asst Coach 1", team.AssistantCoach1Name, team.AssistantCoach1Email);
            AddCoachIfPresent(coaches, "Asst Coach 2", team.AssistantCoach2Name, team.AssistantCoach2Email);
            AddCoachIfPresent(coaches, "Asst Coach 3", team.AssistantCoach3Name, team.AssistantCoach3Email);
            AddCoachIfPresent(coaches, "Asst Coach 4", team.AssistantCoach4Name, team.AssistantCoach4Email);

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(coaches.ToArray());
            return response;
        }

        [Function("GetMediaOutletsForMobile")]
        public async Task<HttpResponseData> GetMediaOutletsForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "email/media-outlets-mobile")] HttpRequestData req)
        {
            var outlets = await _emailService.GetMediaOutletsAsync();

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(outlets.Select(outlet => new
            {
                outlet.Name,
                outlet.Email
            }));
            return response;
        }

        [Function("CreateGameGoalForMobile")]
        public async Task<HttpResponseData> CreateGameGoalForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "games/{gameId:guid}/goals")] HttpRequestData req,
            Guid gameId)
        {
            var payload = await req.ReadFromJsonAsync<MobileCreateGoalRequest>();
            if (payload == null || payload.TeamId == Guid.Empty || payload.ScorerId == Guid.Empty || payload.Period <= 0 || string.IsNullOrWhiteSpace(payload.TimeInPeriod))
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "Invalid goal payload." });
                return bad;
            }

            var createdAt = DateTime.UtcNow;
            var eventId = Guid.NewGuid();
            var goalId = Guid.NewGuid();

            var details = JsonSerializer.Serialize(new
            {
                ClientEventId = string.IsNullOrWhiteSpace(payload.ClientEventId) ? null : payload.ClientEventId,
                GoalStrength = payload.Strength,
                Source = "mobile"
            });

            using var conn = _connectionFactory.CreateConnection();

            const string insertEventSql = @"
                INSERT INTO dbo.GameEvents
                (
                    Id,
                    GameId,
                    EventType,
                    Period,
                    TimeInPeriod,
                    TeamId,
                    PlayerId,
                    SecondaryPlayerId,
                    Zone,
                    Details,
                    CreatedAt
                )
                VALUES
                (
                    @Id,
                    @GameId,
                    @EventType,
                    @Period,
                    @TimeInPeriod,
                    @TeamId,
                    @PlayerId,
                    @SecondaryPlayerId,
                    @Zone,
                    @Details,
                    @CreatedAt
                );";

            const string insertGoalSql = @"
                INSERT INTO dbo.GameGoals
                (
                    Id,
                    GameId,
                    EventId,
                    ScoringTeamId,
                    ScorerId,
                    Assist1Id,
                    Assist2Id,
                    GoalieId,
                    Strength,
                    ShotType,
                    Zone,
                    Period,
                    TimeInPeriod,
                    CreatedAt
                )
                VALUES
                (
                    @Id,
                    @GameId,
                    @EventId,
                    @ScoringTeamId,
                    @ScorerId,
                    @Assist1Id,
                    @Assist2Id,
                    @GoalieId,
                    @Strength,
                    @ShotType,
                    @Zone,
                    @Period,
                    @TimeInPeriod,
                    @CreatedAt
                );";

            using var tx = conn.BeginTransaction();
            await conn.ExecuteAsync(
                insertEventSql,
                new
                {
                    Id = eventId,
                    GameId = gameId,
                    EventType = "Goal",
                    payload.Period,
                    payload.TimeInPeriod,
                    TeamId = payload.TeamId,
                    PlayerId = payload.ScorerId,
                    SecondaryPlayerId = payload.Assist1Id,
                    Zone = (string?)null,
                    Details = details,
                    CreatedAt = createdAt
                },
                tx);

            await conn.ExecuteAsync(
                insertGoalSql,
                new
                {
                    Id = goalId,
                    GameId = gameId,
                    EventId = eventId,
                    ScoringTeamId = payload.TeamId,
                    ScorerId = payload.ScorerId,
                    payload.Assist1Id,
                    payload.Assist2Id,
                    GoalieId = (Guid?)null,
                    Strength = NormalizeGoalStrength(payload.Strength),
                    ShotType = (string?)null,
                    Zone = (string?)null,
                    payload.Period,
                    payload.TimeInPeriod,
                    CreatedAt = createdAt
                },
                tx);

            tx.Commit();

            var created = req.CreateResponse(HttpStatusCode.Created);
            await created.WriteAsJsonAsync(new { EventId = eventId });
            return created;
        }

        [Function("CreateGameShotForMobile")]
        public async Task<HttpResponseData> CreateGameShotForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "games/{gameId:guid}/shots/events")] HttpRequestData req,
            Guid gameId)
        {
            var payload = await req.ReadFromJsonAsync<MobileCreateShotRequest>();
            if (payload == null || payload.TeamId == Guid.Empty || payload.Period <= 0 || string.IsNullOrWhiteSpace(payload.TimeInPeriod))
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "Invalid shot payload." });
                return bad;
            }

            using var conn = _connectionFactory.CreateConnection();
            if (!string.IsNullOrWhiteSpace(payload.ClientEventId))
            {
                var existingEventId = await conn.QueryFirstOrDefaultAsync<Guid?>(@"
                    SELECT TOP 1 ge.Id
                    FROM dbo.GameEvents ge
                    WHERE ge.GameId = @GameId
                      AND ge.EventType = 'Shot'
                      AND JSON_VALUE(ge.Details, '$.ClientEventId') = @ClientEventId;",
                    new { GameId = gameId, payload.ClientEventId });

                if (existingEventId.HasValue)
                {
                    var existing = req.CreateResponse(HttpStatusCode.OK);
                    await existing.WriteAsJsonAsync(new { EventId = existingEventId.Value });
                    return existing;
                }
            }

            var eventId = Guid.NewGuid();
            var createdAt = DateTime.UtcNow;
            var details = JsonSerializer.Serialize(new
            {
                ClientEventId = string.IsNullOrWhiteSpace(payload.ClientEventId) ? null : payload.ClientEventId,
                Source = "mobile",
                Kind = "manual-shot"
            });

            await conn.ExecuteAsync(@"
                INSERT INTO dbo.GameEvents
                (
                    Id, GameId, EventType, Period, TimeInPeriod, TeamId,
                    PlayerId, SecondaryPlayerId, Zone, Details, CreatedAt
                )
                VALUES
                (
                    @Id, @GameId, 'Shot', @Period, @TimeInPeriod, @TeamId,
                    NULL, NULL, NULL, @Details, @CreatedAt
                );",
                new
                {
                    Id = eventId,
                    GameId = gameId,
                    payload.Period,
                    payload.TimeInPeriod,
                    payload.TeamId,
                    Details = details,
                    CreatedAt = createdAt
                });

            var created = req.CreateResponse(HttpStatusCode.Created);
            await created.WriteAsJsonAsync(new { EventId = eventId });
            return created;
        }

        [Function("CreateGamePenaltyForMobile")]
        public async Task<HttpResponseData> CreateGamePenaltyForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "games/{gameId:guid}/penalties")] HttpRequestData req,
            Guid gameId)
        {
            var payload = await req.ReadFromJsonAsync<MobileCreatePenaltyRequest>();
            if (payload == null || payload.TeamId == Guid.Empty || payload.PlayerId == Guid.Empty || payload.Period <= 0 || string.IsNullOrWhiteSpace(payload.TimeInPeriod))
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "Invalid penalty payload." });
                return bad;
            }

            var createdAt = DateTime.UtcNow;
            var eventId = Guid.NewGuid();
            var penaltyId = Guid.NewGuid();

            var details = JsonSerializer.Serialize(new
            {
                PenaltyType = string.IsNullOrWhiteSpace(payload.PenaltyType) ? "Minor" : payload.PenaltyType,
                SuspensionBehavior = string.IsNullOrWhiteSpace(payload.SuspensionBehavior) ? null : payload.SuspensionBehavior,
                RequiresRefereeNotes = payload.RequiresRefereeNotes,
                ReviewRequired = payload.ReviewRequired,
                ClientEventId = string.IsNullOrWhiteSpace(payload.ClientEventId) ? null : payload.ClientEventId,
                Source = "mobile"
            });

            using var conn = _connectionFactory.CreateConnection();

            const string insertEventSql = @"
                INSERT INTO dbo.GameEvents
                (
                    Id,
                    GameId,
                    EventType,
                    Period,
                    TimeInPeriod,
                    TeamId,
                    PlayerId,
                    SecondaryPlayerId,
                    Zone,
                    Details,
                    CreatedAt
                )
                VALUES
                (
                    @Id,
                    @GameId,
                    @EventType,
                    @Period,
                    @TimeInPeriod,
                    @TeamId,
                    @PlayerId,
                    @SecondaryPlayerId,
                    @Zone,
                    @Details,
                    @CreatedAt
                );";

            const string insertPenaltySql = @"
                INSERT INTO dbo.GamePenalties
                (
                    Id,
                    GameId,
                    EventId,
                    TeamId,
                    PlayerId,
                    ServedByPlayerId,
                    Infraction,
                    DurationMinutes,
                    Period,
                    TimeInPeriod,
                    Notes,
                    CreatedAt
                )
                VALUES
                (
                    @Id,
                    @GameId,
                    @EventId,
                    @TeamId,
                    @PlayerId,
                    @ServedByPlayerId,
                    @Infraction,
                    @DurationMinutes,
                    @Period,
                    @TimeInPeriod,
                    @Notes,
                    @CreatedAt
                );";

            using var tx = conn.BeginTransaction();
            await conn.ExecuteAsync(
                insertEventSql,
                new
                {
                    Id = eventId,
                    GameId = gameId,
                    EventType = "Penalty",
                    payload.Period,
                    payload.TimeInPeriod,
                    TeamId = payload.TeamId,
                    PlayerId = payload.PlayerId,
                    SecondaryPlayerId = (Guid?)null,
                    Zone = (string?)null,
                    Details = details,
                    CreatedAt = createdAt
                },
                tx);

            await conn.ExecuteAsync(
                insertPenaltySql,
                new
                {
                    Id = penaltyId,
                    GameId = gameId,
                    EventId = eventId,
                    TeamId = payload.TeamId,
                    PlayerId = payload.PlayerId,
                    ServedByPlayerId = (Guid?)null,
                    Infraction = string.IsNullOrWhiteSpace(payload.Infraction) ? "Other" : payload.Infraction,
                    DurationMinutes = payload.DurationMinutes < 0 ? 0 : payload.DurationMinutes,
                    payload.Period,
                    payload.TimeInPeriod,
                    Notes = (string?)null,
                    CreatedAt = createdAt
                },
                tx);

            tx.Commit();

            var created = req.CreateResponse(HttpStatusCode.Created);
            await created.WriteAsJsonAsync(new { EventId = eventId });
            return created;
        }

        [Function("CreateGameGoalieEventForMobile")]
        public async Task<HttpResponseData> CreateGameGoalieEventForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "games/{gameId:guid}/goalies")] HttpRequestData req,
            Guid gameId)
        {
            var payload = await req.ReadFromJsonAsync<MobileCreateGoalieEventRequest>();
            if (payload == null || payload.TeamId == Guid.Empty || payload.Period <= 0 || string.IsNullOrWhiteSpace(payload.TimeInPeriod))
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "Invalid goalie event payload." });
                return bad;
            }

            var createdAt = DateTime.UtcNow;
            var eventId = Guid.NewGuid();
            var goalieChangeKind = string.IsNullOrWhiteSpace(payload.GoalieChangeKind) ? "change" : payload.GoalieChangeKind.Trim().ToLowerInvariant();

            var details = JsonSerializer.Serialize(new
            {
                GoalieChangeKind = goalieChangeKind,
                GoalieOldName = string.IsNullOrWhiteSpace(payload.GoalieOldName) ? null : payload.GoalieOldName.Trim(),
                GoalieNewName = string.IsNullOrWhiteSpace(payload.GoalieNewName) ? null : payload.GoalieNewName.Trim(),
                ClientEventId = string.IsNullOrWhiteSpace(payload.ClientEventId) ? null : payload.ClientEventId,
                Source = "mobile"
            });

            using var conn = _connectionFactory.CreateConnection();

            const string insertEventSql = @"
                INSERT INTO dbo.GameEvents
                (
                    Id,
                    GameId,
                    EventType,
                    Period,
                    TimeInPeriod,
                    TeamId,
                    PlayerId,
                    SecondaryPlayerId,
                    Zone,
                    Details,
                    CreatedAt
                )
                VALUES
                (
                    @Id,
                    @GameId,
                    @EventType,
                    @Period,
                    @TimeInPeriod,
                    @TeamId,
                    @PlayerId,
                    @SecondaryPlayerId,
                    @Zone,
                    @Details,
                    @CreatedAt
                );";

            await conn.ExecuteAsync(
                insertEventSql,
                new
                {
                    Id = eventId,
                    GameId = gameId,
                    EventType = "Goalie",
                    payload.Period,
                    payload.TimeInPeriod,
                    TeamId = payload.TeamId,
                    PlayerId = (Guid?)null,
                    SecondaryPlayerId = (Guid?)null,
                    Zone = (string?)null,
                    Details = details,
                    CreatedAt = createdAt
                });

            var created = req.CreateResponse(HttpStatusCode.Created);
            await created.WriteAsJsonAsync(new { EventId = eventId });
            return created;
        }

        [Function("DeleteGameGoalForMobile")]
        public async Task<HttpResponseData> DeleteGameGoalForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "games/{gameId:guid}/goals/{eventRef}")] HttpRequestData req,
            Guid gameId,
            string eventRef)
        {
            var deleted = await DeleteGameEventByRef(gameId, eventRef, "Goal", "dbo.GameGoals");
            if (!deleted)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        [Function("DeleteGameShotForMobile")]
        public async Task<HttpResponseData> DeleteGameShotForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "games/{gameId:guid}/shots/events/{eventRef}")] HttpRequestData req,
            Guid gameId,
            string eventRef)
        {
            var deleted = await DeleteGameEventByRef(gameId, eventRef, "Shot", null);
            if (!deleted)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        [Function("DeleteGamePenaltyForMobile")]
        public async Task<HttpResponseData> DeleteGamePenaltyForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "games/{gameId:guid}/penalties/{eventRef}")] HttpRequestData req,
            Guid gameId,
            string eventRef)
        {
            var deleted = await DeleteGameEventByRef(gameId, eventRef, "Penalty", "dbo.GamePenalties");
            if (!deleted)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        [Function("UpdateGameGoalieEventForMobile")]
        public async Task<HttpResponseData> UpdateGameGoalieEventForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "games/{gameId:guid}/goalies/{eventRef}")] HttpRequestData req,
            Guid gameId,
            string eventRef)
        {
            var payload = await req.ReadFromJsonAsync<MobileUpdateGoalieEventRequest>();
            if (payload == null || payload.TeamId == Guid.Empty || payload.Period <= 0 || string.IsNullOrWhiteSpace(payload.TimeInPeriod))
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "Invalid goalie event payload." });
                return bad;
            }

            using var conn = _connectionFactory.CreateConnection();
            var eventId = await ResolveEventIdByRef(conn, gameId, eventRef, "Goalie");
            if (eventId == null || eventId == Guid.Empty)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            var goalieChangeKind = string.IsNullOrWhiteSpace(payload.GoalieChangeKind) ? "change" : payload.GoalieChangeKind.Trim().ToLowerInvariant();
            var details = JsonSerializer.Serialize(new
            {
                GoalieChangeKind = goalieChangeKind,
                GoalieOldName = string.IsNullOrWhiteSpace(payload.GoalieOldName) ? null : payload.GoalieOldName.Trim(),
                GoalieNewName = string.IsNullOrWhiteSpace(payload.GoalieNewName) ? null : payload.GoalieNewName.Trim(),
                ClientEventId = string.IsNullOrWhiteSpace(payload.ClientEventId) ? eventRef : payload.ClientEventId,
                Source = "mobile"
            });

            const string updateSql = @"
                UPDATE dbo.GameEvents
                SET
                    Period = @Period,
                    TimeInPeriod = @TimeInPeriod,
                    TeamId = @TeamId,
                    Details = @Details
                WHERE GameId = @GameId
                  AND Id = @EventId
                  AND EventType = 'Goalie';";

            var updated = await conn.ExecuteAsync(updateSql, new
            {
                GameId = gameId,
                EventId = eventId,
                payload.Period,
                payload.TimeInPeriod,
                TeamId = payload.TeamId,
                Details = details
            });

            if (updated == 0)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new { EventId = eventId });
            return response;
        }

        [Function("UpdateGameEventTimingForMobile")]
        public async Task<HttpResponseData> UpdateGameEventTimingForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "games/{gameId:guid}/events/{eventRef}/timing")] HttpRequestData req,
            Guid gameId,
            string eventRef)
        {
            var payload = await req.ReadFromJsonAsync<MobileUpdateEventTimingRequest>();
            if (payload == null || payload.Period <= 0 || string.IsNullOrWhiteSpace(payload.TimeInPeriod)
                || (payload.EventType != "Goal" && payload.EventType != "Penalty" && payload.EventType != "Goalie"))
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { error = "Invalid event timing payload." });
                return bad;
            }

            using var conn = _connectionFactory.CreateConnection();
            var eventId = await ResolveEventIdByRef(conn, gameId, eventRef, payload.EventType);
            if (eventId == null || eventId == Guid.Empty) return req.CreateResponse(HttpStatusCode.NotFound);

            using var transaction = conn.BeginTransaction();
            var updated = await conn.ExecuteAsync(@"
                UPDATE dbo.GameEvents SET Period = @Period, TimeInPeriod = @TimeInPeriod
                WHERE GameId = @GameId AND Id = @EventId AND EventType = @EventType;",
                new { GameId = gameId, EventId = eventId, payload.EventType, payload.Period, TimeInPeriod = payload.TimeInPeriod.Trim() }, transaction);
            if (updated == 0)
            {
                transaction.Rollback();
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            var detailTable = payload.EventType == "Goal"
                ? "dbo.GameGoals"
                : payload.EventType == "Penalty" ? "dbo.GamePenalties" : null;
            if (detailTable != null)
            {
                await conn.ExecuteAsync($@"
                    UPDATE {detailTable} SET Period = @Period, TimeInPeriod = @TimeInPeriod
                    WHERE GameId = @GameId AND EventId = @EventId;",
                    new { GameId = gameId, EventId = eventId, payload.Period, TimeInPeriod = payload.TimeInPeriod.Trim() }, transaction);
            }
            transaction.Commit();
            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        [Function("DeleteGameGoalieEventForMobile")]
        public async Task<HttpResponseData> DeleteGameGoalieEventForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "games/{gameId:guid}/goalies/{eventRef}")] HttpRequestData req,
            Guid gameId,
            string eventRef)
        {
            var deleted = await DeleteGameEventByRef(gameId, eventRef, "Goalie", null);
            if (!deleted)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        [Function("CompleteGameForMobile")]
        public async Task<HttpResponseData> CompleteGameForMobile(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "games/{gameId:guid}/complete")] HttpRequestData req,
            Guid gameId)
        {
            var payload = await req.ReadFromJsonAsync<MobileCompleteGameRequest>();
            using var conn = _connectionFactory.CreateConnection();

            const string sql = @"
                UPDATE dbo.Games
                SET
                    Status = 'Final',
                    Notes = CASE
                        WHEN @Notes IS NULL OR LTRIM(RTRIM(@Notes)) = '' THEN Notes
                        WHEN Notes IS NULL OR LTRIM(RTRIM(Notes)) = '' THEN @Notes
                        ELSE CONCAT(Notes, CHAR(10), @Notes)
                    END,
                    UpdatedAt = SYSUTCDATETIME()
                WHERE GameId = @GameId;";

            const string ensureSnapshotTableSql = @"
                IF OBJECT_ID('dbo.GameStatsSnapshots', 'U') IS NULL
                BEGIN
                    CREATE TABLE dbo.GameStatsSnapshots
                    (
                        GameId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
                        HomeShotsP1 INT NULL,
                        HomeShotsP2 INT NULL,
                        HomeShotsP3 INT NULL,
                        HomeShotsOT INT NULL,
                        AwayShotsP1 INT NULL,
                        AwayShotsP2 INT NULL,
                        AwayShotsP3 INT NULL,
                        AwayShotsOT INT NULL,
                        HomeShotsTotal INT NULL,
                        AwayShotsTotal INT NULL,
                        GoalieSummaryJson NVARCHAR(MAX) NULL,
                        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_GameStatsSnapshots_CreatedAt DEFAULT SYSUTCDATETIME(),
                        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_GameStatsSnapshots_UpdatedAt DEFAULT SYSUTCDATETIME()
                    );

                    ALTER TABLE dbo.GameStatsSnapshots
                    ADD CONSTRAINT FK_GameStatsSnapshots_Games
                    FOREIGN KEY (GameId) REFERENCES dbo.Games (GameId);
                END;";

            const string upsertSnapshotSql = @"
                MERGE dbo.GameStatsSnapshots AS target
                USING (SELECT @GameId AS GameId) AS source
                ON target.GameId = source.GameId
                WHEN MATCHED THEN
                    UPDATE SET
                        HomeShotsP1 = @HomeShotsP1,
                        HomeShotsP2 = @HomeShotsP2,
                        HomeShotsP3 = @HomeShotsP3,
                        HomeShotsOT = @HomeShotsOT,
                        AwayShotsP1 = @AwayShotsP1,
                        AwayShotsP2 = @AwayShotsP2,
                        AwayShotsP3 = @AwayShotsP3,
                        AwayShotsOT = @AwayShotsOT,
                        HomeShotsTotal = @HomeShotsTotal,
                        AwayShotsTotal = @AwayShotsTotal,
                        GoalieSummaryJson = @GoalieSummaryJson,
                        UpdatedAt = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN
                    INSERT
                    (
                        GameId,
                        HomeShotsP1,
                        HomeShotsP2,
                        HomeShotsP3,
                        HomeShotsOT,
                        AwayShotsP1,
                        AwayShotsP2,
                        AwayShotsP3,
                        AwayShotsOT,
                        HomeShotsTotal,
                        AwayShotsTotal,
                        GoalieSummaryJson,
                        CreatedAt,
                        UpdatedAt
                    )
                    VALUES
                    (
                        @GameId,
                        @HomeShotsP1,
                        @HomeShotsP2,
                        @HomeShotsP3,
                        @HomeShotsOT,
                        @AwayShotsP1,
                        @AwayShotsP2,
                        @AwayShotsP3,
                        @AwayShotsOT,
                        @HomeShotsTotal,
                        @AwayShotsTotal,
                        @GoalieSummaryJson,
                        SYSUTCDATETIME(),
                        SYSUTCDATETIME()
                    );";

            var updated = await conn.ExecuteAsync(sql, new
            {
                GameId = gameId,
                Notes = payload?.Notes
            });

            if (updated == 0)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            await conn.ExecuteAsync(ensureSnapshotTableSql);

            if (payload?.SuspensionNotes != null && payload.SuspensionNotes.Count > 0)
            {
                const string updatePenaltyNotesSql = @"
                    UPDATE gp
                    SET gp.Notes = @Notes
                    FROM dbo.GamePenalties gp
                    INNER JOIN dbo.GameEvents ge ON ge.Id = gp.EventId
                    WHERE gp.GameId = @GameId
                      AND ge.EventType = 'Penalty'
                      AND ge.Details LIKE @ClientPattern;";

                foreach (var noteEntry in payload.SuspensionNotes)
                {
                    var note = noteEntry?.Notes?.Trim();
                    var eventRef = noteEntry?.EventRef?.Trim();
                    if (string.IsNullOrWhiteSpace(note) || string.IsNullOrWhiteSpace(eventRef))
                    {
                        continue;
                    }

                    var pattern = $"%\"ClientEventId\":\"{eventRef.Replace("\"", "\"\"")}\"%";
                    await conn.ExecuteAsync(updatePenaltyNotesSql, new
                    {
                        GameId = gameId,
                        Notes = note,
                        ClientPattern = pattern
                    });
                }
            }

            var goalieSummaryJson = payload?.GoalieSummaries == null
                ? null
                : JsonSerializer.Serialize(payload.GoalieSummaries);

            await conn.ExecuteAsync(upsertSnapshotSql, new
            {
                GameId = gameId,
                HomeShotsP1 = payload?.ShotSummary?.HomeByPeriod?.P1,
                HomeShotsP2 = payload?.ShotSummary?.HomeByPeriod?.P2,
                HomeShotsP3 = payload?.ShotSummary?.HomeByPeriod?.P3,
                HomeShotsOT = payload?.ShotSummary?.HomeByPeriod?.OT,
                AwayShotsP1 = payload?.ShotSummary?.AwayByPeriod?.P1,
                AwayShotsP2 = payload?.ShotSummary?.AwayByPeriod?.P2,
                AwayShotsP3 = payload?.ShotSummary?.AwayByPeriod?.P3,
                AwayShotsOT = payload?.ShotSummary?.AwayByPeriod?.OT,
                HomeShotsTotal = payload?.ShotSummary?.HomeTotal,
                AwayShotsTotal = payload?.ShotSummary?.AwayTotal,
                GoalieSummaryJson = goalieSummaryJson
            });

            var requestedRecipients = (payload?.EmailDispatch?.To ?? new List<string>())
                .Where(email => !string.IsNullOrWhiteSpace(email))
                .Select(email => email.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var emailSent = false;
            string? emailError = null;

            if (requestedRecipients.Count > 0)
            {
                try
                {
                    var summary = await _gameSummaryReportService.BuildReportAsync(gameId);
                    var attachments = new List<EmailAttachment>();
                    var bodyText = summary != null
                        ? _gameSummaryReportService.BuildEmailBody(summary)
                        : (payload?.Notes ?? "Game finalized.");

                    if (summary != null)
                    {
                        attachments.Add(new EmailAttachment
                        {
                            FileName = $"TipIn-GameSummary-{summary.GameDateTime:yyyyMMdd-HHmm}-{summary.GameId}.pdf",
                            ContentType = "application/pdf",
                            Content = _gameSummaryReportService.BuildPdf(summary)
                        });
                    }

                    await _emailService.SendAsync(new EmailSendRequest
                    {
                        To = requestedRecipients,
                        Subject = string.IsNullOrWhiteSpace(payload?.EmailDispatch?.Subject)
                            ? "TipIn Scoring Game Finalized"
                            : payload.EmailDispatch.Subject,
                        BodyText = bodyText,
                        Attachments = attachments
                    });
                    emailSent = true;
                }
                catch (Exception ex)
                {
                    emailError = ex.Message;
                }
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                GameId = gameId,
                Status = "Final",
                EmailRequested = requestedRecipients.Count > 0,
                EmailSent = emailSent,
                EmailError = emailError
            });
            return response;
        }

        private async Task<bool> DeleteGameEventByRef(Guid gameId, string eventRef, string eventType, string? detailTable)
        {
            using var conn = _connectionFactory.CreateConnection();

            var eventId = await ResolveEventIdByRef(conn, gameId, eventRef, eventType);

            if (eventId == null || eventId == Guid.Empty)
            {
                return false;
            }

            using var tx = conn.BeginTransaction();
            if (!string.IsNullOrWhiteSpace(detailTable))
            {
                var deleteDetailSql = $@"
                    DELETE FROM {detailTable}
                    WHERE GameId = @GameId
                      AND EventId = @EventId;";

                await conn.ExecuteAsync(deleteDetailSql, new { GameId = gameId, EventId = eventId }, tx);
            }

            var deletedEvents = await conn.ExecuteAsync(
                @"
                DELETE FROM dbo.GameEvents
                WHERE GameId = @GameId
                  AND Id = @EventId
                  AND EventType = @EventType;",
                new
                {
                    GameId = gameId,
                    EventId = eventId,
                    EventType = eventType
                },
                tx);

            tx.Commit();
            return deletedEvents > 0;
        }

        private async Task<Guid?> ResolveEventIdByRef(IDbConnection conn, Guid gameId, string eventRef, string eventType)
        {
            if (Guid.TryParse(eventRef, out var parsed))
            {
                return parsed;
            }

            const string findByClientIdSql = @"
                SELECT TOP 1 ge.Id
                FROM dbo.GameEvents ge
                WHERE ge.GameId = @GameId
                  AND ge.EventType = @EventType
                  AND ge.Details LIKE @ClientPattern
                ORDER BY ge.CreatedAt DESC;";

            var safeClientRef = eventRef?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(safeClientRef))
            {
                return null;
            }

            var pattern = $"%\"ClientEventId\":\"{safeClientRef}\"%";
            return await conn.QueryFirstOrDefaultAsync<Guid?>(
                findByClientIdSql,
                new
                {
                    GameId = gameId,
                    EventType = eventType,
                    ClientPattern = pattern
                });
        }

        private static void AddCoachIfPresent(List<MobileCoachDto> coaches, string roleName, string? coachName, string? coachEmail)
        {
            if (string.IsNullOrWhiteSpace(coachName))
            {
                return;
            }

            coaches.Add(new MobileCoachDto
            {
                RoleName = roleName,
                CoachName = coachName.Trim(),
                CoachEmail = string.IsNullOrWhiteSpace(coachEmail) ? null : coachEmail.Trim(),
            });
        }

        private static string NormalizeGoalStrength(string? strength)
        {
            var raw = (strength ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(raw)) return "EV";

            var normalized = raw.ToUpperInvariant().Replace("-", " ");
            while (normalized.Contains("  "))
            {
                normalized = normalized.Replace("  ", " ");
            }

            return normalized switch
            {
                "EVEN STRENGTH" => "EV",
                "POWER PLAY" => "PP",
                "SHORT HANDED" => "SH",
                "EMPTY NET" => "EN",
                "PENALTY SHOT" => "PS",
                _ => raw.Length <= 10 ? raw : raw[..10],
            };
        }

        private static string ToGoalStrengthDisplayLabel(string? strengthCode)
        {
            var code = (strengthCode ?? string.Empty).Trim().ToUpperInvariant();
            return code switch
            {
                "EV" => "Even Strength",
                "PP" => "Power Play",
                "SH" => "Short-Handed",
                "EN" => "Empty Net",
                "PS" => "Penalty Shot",
                _ => string.IsNullOrWhiteSpace(strengthCode) ? "Even Strength" : strengthCode
            };
        }

        private static bool IsDisqualificationPenalty(string? penaltyType, string? infraction)
        {
            var type = (penaltyType ?? string.Empty).Trim().ToLowerInvariant();
            var inf = (infraction ?? string.Empty).Trim().ToLowerInvariant();

            if (type == "disqualification" || type == "dq" || type.Contains("ejection") || type.Contains("dq"))
            {
                return true;
            }

            return inf == "disqualification" || inf == "dq";
        }

        private static string ToPenaltyDurationDisplayLabel(string? penaltyType, string? infraction, int durationMinutes)
        {
            if (IsDisqualificationPenalty(penaltyType, infraction))
            {
                return "DQ";
            }

            return $"{Math.Max(0, durationMinutes)} Min";
        }

        private class MobileTeamDto
        {
            public Guid TeamId { get; set; }
            public string Name { get; set; } = string.Empty;
        }

        private class MobileNextGameDto
        {
            public Guid GameId { get; set; }
            public Guid HomeTeamId { get; set; }
            public string HomeTeamName { get; set; } = string.Empty;
            public string? HomeTeamMascot { get; set; }
            public Guid AwayTeamId { get; set; }
            public string AwayTeamName { get; set; } = string.Empty;
            public string? AwayTeamMascot { get; set; }
            public string OpponentName { get; set; } = string.Empty;
            public DateTime StartTime { get; set; }
            public string? Status { get; set; }
            public Guid? ArenaId { get; set; }
            public Guid? RinkId { get; set; }
            public string ArenaName { get; set; } = string.Empty;
            public string RinkName { get; set; } = string.Empty;
            public bool GatewayAvailable { get; set; }
            public string? GameTypeName { get; set; }
            public int? PeriodLengthMinutes { get; set; }
            public string? LevelName { get; set; }
            public string? TeamType { get; set; }
            public string? SectionRegionName { get; set; }
            public string? ConferenceDistrictName { get; set; }
        }

        private class MobileClosedGameDto
        {
            public Guid GameId { get; set; }
            public DateTime StartTime { get; set; }
            public string Status { get; set; } = string.Empty;
            public string OpponentName { get; set; } = "Opponent";
        }

        private class MobileGatewayRow
        {
            public Guid GatewayId { get; set; }
            public string Name { get; set; } = string.Empty;
            public string Host { get; set; } = string.Empty;
            public int Port { get; set; }
            public string WebSocketSecretEncrypted { get; set; } = string.Empty;
        }

        private class MobileGatewayAuthorizationRow
        {
            public DateTime GameDateTime { get; set; }
        }

        private class MobileSummaryGoalRow
        {
            public Guid EventId { get; set; }
            public Guid GameId { get; set; }
            public int Period { get; set; }
            public string TimeInPeriod { get; set; } = string.Empty;
            public string Strength { get; set; } = string.Empty;
            public string TeamName { get; set; } = string.Empty;
            public string ScorerName { get; set; } = string.Empty;
            public string? Assist1Name { get; set; }
            public string? Assist2Name { get; set; }
        }

        private class MobileSummaryPenaltyRow
        {
            public Guid EventId { get; set; }
            public Guid GameId { get; set; }
            public int Period { get; set; }
            public string TimeInPeriod { get; set; } = string.Empty;
            public int DurationMinutes { get; set; }
            public string Infraction { get; set; } = string.Empty;
            public string? PenaltyType { get; set; }
            public string TeamName { get; set; } = string.Empty;
            public string PlayerName { get; set; } = string.Empty;
            public string? Notes { get; set; }
        }

        private class MobileSummaryShotRow
        {
            public Guid EventId { get; set; }
            public Guid GameId { get; set; }
            public Guid TeamId { get; set; }
            public int Period { get; set; }
            public string TimeInPeriod { get; set; } = string.Empty;
            public string TeamName { get; set; } = string.Empty;
            public DateTime CreatedAt { get; set; }
        }

        private class MobileShotTotalsRow
        {
            public int? HomeShotsP1 { get; set; }
            public int? HomeShotsP2 { get; set; }
            public int? HomeShotsP3 { get; set; }
            public int? HomeShotsOT { get; set; }
            public int? HomeShotsTotal { get; set; }
            public int? AwayShotsP1 { get; set; }
            public int? AwayShotsP2 { get; set; }
            public int? AwayShotsP3 { get; set; }
            public int? AwayShotsOT { get; set; }
            public int? AwayShotsTotal { get; set; }
        }

        private class MobileRosterPlayerDto
        {
            public Guid PlayerId { get; set; }
            public string FullName { get; set; } = string.Empty;
            public int? JerseyNumber { get; set; }
            public string? Position { get; set; }
            public int? Grade { get; set; }
            public bool IsGoalie { get; set; }
            public bool IsActive { get; set; }
        }

        private class MobileTeamCoachNamesDto
        {
            public string? HeadCoachName { get; set; }
            public string? HeadCoachEmail { get; set; }
            public string? AssistantCoach1Name { get; set; }
            public string? AssistantCoach1Email { get; set; }
            public string? AssistantCoach2Name { get; set; }
            public string? AssistantCoach2Email { get; set; }
            public string? AssistantCoach3Name { get; set; }
            public string? AssistantCoach3Email { get; set; }
            public string? AssistantCoach4Name { get; set; }
            public string? AssistantCoach4Email { get; set; }
        }

        private class MobileCoachDto
        {
            public string RoleName { get; set; } = string.Empty;
            public string CoachName { get; set; } = string.Empty;
            public string? CoachEmail { get; set; }
        }

        private class MobileCreateGoalRequest
        {
            public Guid TeamId { get; set; }
            public Guid ScorerId { get; set; }
            public Guid? Assist1Id { get; set; }
            public Guid? Assist2Id { get; set; }
            public int Period { get; set; }
            public string TimeInPeriod { get; set; } = string.Empty;
            public string Strength { get; set; } = "Even Strength";
            public string? ClientEventId { get; set; }
        }

        private class MobileCreateShotRequest
        {
            public Guid TeamId { get; set; }
            public int Period { get; set; }
            public string TimeInPeriod { get; set; } = string.Empty;
            public string? ClientEventId { get; set; }
        }

        private class MobileCreatePenaltyRequest
        {
            public Guid TeamId { get; set; }
            public Guid PlayerId { get; set; }
            public string Infraction { get; set; } = string.Empty;
            public int DurationMinutes { get; set; }
            public string PenaltyType { get; set; } = "Minor";
            public string? SuspensionBehavior { get; set; }
            public bool RequiresRefereeNotes { get; set; }
            public bool ReviewRequired { get; set; }
            public int Period { get; set; }
            public string TimeInPeriod { get; set; } = string.Empty;
            public string? ClientEventId { get; set; }
        }

        private class MobileCreateGoalieEventRequest
        {
            public Guid TeamId { get; set; }
            public int Period { get; set; }
            public string TimeInPeriod { get; set; } = string.Empty;
            public string GoalieChangeKind { get; set; } = "change";
            public string? GoalieOldName { get; set; }
            public string? GoalieNewName { get; set; }
            public string? ClientEventId { get; set; }
        }

        private class MobileUpdateGoalieEventRequest
        {
            public Guid TeamId { get; set; }
            public int Period { get; set; }
            public string TimeInPeriod { get; set; } = string.Empty;
            public string GoalieChangeKind { get; set; } = "change";
            public string? GoalieOldName { get; set; }
            public string? GoalieNewName { get; set; }
            public string? ClientEventId { get; set; }
        }

        private class MobileUpdateEventTimingRequest
        {
            public string EventType { get; set; } = string.Empty;
            public int Period { get; set; }
            public string TimeInPeriod { get; set; } = string.Empty;
        }

        private class MobileCompleteGameRequest
        {
            public string? Notes { get; set; }
            public List<MobileSuspensionNoteRequest>? SuspensionNotes { get; set; }
            public MobileShotSummaryRequest? ShotSummary { get; set; }
            public List<MobileGoalieSummaryRequest>? GoalieSummaries { get; set; }
            public MobileEmailDispatchRequest? EmailDispatch { get; set; }
        }

        private class MobileSuspensionNoteRequest
        {
            public string? EventRef { get; set; }
            public string? Notes { get; set; }
        }

        private class MobileShotSummaryRequest
        {
            public MobilePeriodShotsRequest? HomeByPeriod { get; set; }
            public MobilePeriodShotsRequest? AwayByPeriod { get; set; }
            public int? HomeTotal { get; set; }
            public int? AwayTotal { get; set; }
        }

        private class MobilePeriodShotsRequest
        {
            public int? P1 { get; set; }
            public int? P2 { get; set; }
            public int? P3 { get; set; }
            public int? OT { get; set; }
        }

        private class MobileGoalieSummaryRequest
        {
            public string? GoalieTeamId { get; set; }
            public string? GoalieTeamName { get; set; }
            public string? GoalieName { get; set; }
            public MobilePeriodShotsRequest? ShotsAgainstByPeriod { get; set; }
            public int? ShotsAgainst { get; set; }
            public int? TimeInNetSeconds { get; set; }
            public decimal? GoalsAgainstEstimate { get; set; }
            public decimal? SavesEstimate { get; set; }
            public decimal? SavePctEstimate { get; set; }
        }

        private class MobileEmailDispatchRequest
        {
            public List<string>? To { get; set; }
            public string? Subject { get; set; }
            public string? Body { get; set; }
        }

        private class MobileLiveStatusRequest
        {
            public bool HomeOnPowerPlay { get; set; }
            public bool AwayOnPowerPlay { get; set; }
            public int? CurrentPeriod { get; set; }
            public int? HomeSkatersOnIce { get; set; }
            public int? AwaySkatersOnIce { get; set; }
            public List<string>? HomeStarterIds { get; set; }
            public List<string>? AwayStarterIds { get; set; }
        }

        private class MobileLiveStatusRow
        {
            public bool HomeOnPowerPlay { get; set; }
            public bool AwayOnPowerPlay { get; set; }
            public int? CurrentPeriod { get; set; }
            public int? HomeSkatersOnIce { get; set; }
            public int? AwaySkatersOnIce { get; set; }
            public string? HomeStartersJson { get; set; }
            public string? AwayStartersJson { get; set; }
        }
    }
}
