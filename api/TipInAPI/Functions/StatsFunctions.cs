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
using TipInAPI.Infrastructure.Authorization;
using TipInAPI.Infrastructure.Database;
using TipInAPI.Services;

namespace TipInAPI.Functions
{
    public class StatsFunctions
    {
        private readonly ISqlConnectionFactory _connectionFactory;
        private readonly IAuthorizationService _authorizationService;

        public StatsFunctions(
            ISqlConnectionFactory connectionFactory,
            IAuthorizationService authorizationService)
        {
            _connectionFactory = connectionFactory;
            _authorizationService = authorizationService;
        }

        [Function("GetTeamStats")]
        public async Task<HttpResponseData> GetTeamStats(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "stats/team")] HttpRequestData req)
        {
            var denied = await ValidateStatsAccess(req);
            if (denied != null) return denied;

            var query = ParseQuery(req.Url.Query);
            var seasonId = ParseGuid(query, "seasonId");
            var levelId = ParseGuid(query, "levelId");
            var teamId = ParseGuid(query, "teamId");
            var teamType = ParseTeamType(query, "teamType");

            const string sql = @"
                WITH FinalGames AS (
                    SELECT g.GameId, g.HomeTeamId AS TeamId
                    FROM Games g
                    WHERE UPPER(ISNULL(g.Status, 'SCHEDULED')) IN ('FINAL', 'COMPLETED', 'CLOSED')
                    UNION ALL
                    SELECT g.GameId, g.AwayTeamId AS TeamId
                    FROM Games g
                    WHERE UPPER(ISNULL(g.Status, 'SCHEDULED')) IN ('FINAL', 'COMPLETED', 'CLOSED')
                ),
                TeamGames AS (
                    SELECT fg.GameId, fg.TeamId, t.SeasonId
                    FROM FinalGames fg
                    INNER JOIN Teams t ON t.Id = fg.TeamId
                    WHERE (@SeasonId IS NULL OR t.SeasonId = @SeasonId)
                        AND (@LevelId IS NULL OR t.LevelId = @LevelId)
                                                AND (@TeamType IS NULL OR t.TeamType = @TeamType)
                      AND (@TeamId IS NULL OR fg.TeamId = @TeamId)
                ),
                TeamGoals AS (
                    SELECT
                        gg.GameId,
                        gg.ScoringTeamId AS TeamId,
                        COUNT(*) AS Goals,
                        SUM(CASE WHEN UPPER(ISNULL(gg.Strength, '')) = 'PP' THEN 1 ELSE 0 END) AS PPGoals,
                        SUM(CASE WHEN UPPER(ISNULL(gg.Strength, '')) = 'SH' THEN 1 ELSE 0 END) AS SHGoals
                    FROM GameGoals gg
                    GROUP BY gg.GameId, gg.ScoringTeamId
                ),
                TeamPim AS (
                    SELECT gp.GameId, gp.TeamId, SUM(ISNULL(gp.DurationMinutes, 0)) AS PIM
                    FROM GamePenalties gp
                    GROUP BY gp.GameId, gp.TeamId
                ),
                TeamShots AS (
                    SELECT gss.GameId, g.HomeTeamId AS TeamId,
                        ISNULL(gss.HomeShotsTotal, 0) AS ShotsFor,
                        ISNULL(gss.AwayShotsTotal, 0) AS ShotsAgainst
                    FROM GameStatsSnapshots gss
                    INNER JOIN Games g ON g.GameId = gss.GameId
                    UNION ALL
                    SELECT gss.GameId, g.AwayTeamId AS TeamId,
                        ISNULL(gss.AwayShotsTotal, 0) AS ShotsFor,
                        ISNULL(gss.HomeShotsTotal, 0) AS ShotsAgainst
                    FROM GameStatsSnapshots gss
                    INNER JOIN Games g ON g.GameId = gss.GameId
                )
                SELECT
                    tg.TeamId,
                    t.Name AS TeamName,
                    t.TeamType,
                    tg.SeasonId,
                    s.SeasonName,
                    COUNT(DISTINCT tg.GameId) AS GP,
                    SUM(ISNULL(gf.Goals, 0)) AS GF,
                    SUM(ISNULL(ga.Goals, 0)) AS GA,
                    SUM(ISNULL(gf.Goals, 0)) - SUM(ISNULL(ga.Goals, 0)) AS GoalDiff,
                    SUM(ISNULL(tp.PIM, 0)) AS PIM,
                    SUM(ISNULL(gf.PPGoals, 0)) AS PPGoals,
                    SUM(ISNULL(gf.SHGoals, 0)) AS SHGoals,
                    SUM(ISNULL(ts.ShotsFor, 0)) AS ShotsFor,
                    SUM(ISNULL(ts.ShotsAgainst, 0)) AS ShotsAgainst,
                    CASE
                        WHEN SUM(ISNULL(ts.ShotsFor, 0)) = 0 THEN CAST(0 AS DECIMAL(10,2))
                        ELSE CAST((SUM(ISNULL(gf.Goals, 0)) * 100.0) / SUM(ISNULL(ts.ShotsFor, 0)) AS DECIMAL(10,2))
                    END AS ShootingPct
                FROM TeamGames tg
                INNER JOIN Teams t ON t.Id = tg.TeamId
                LEFT JOIN Seasons s ON s.SeasonId = tg.SeasonId
                LEFT JOIN TeamGoals gf ON gf.GameId = tg.GameId AND gf.TeamId = tg.TeamId
                LEFT JOIN TeamGoals ga ON ga.GameId = tg.GameId AND ga.TeamId <> tg.TeamId
                LEFT JOIN TeamPim tp ON tp.GameId = tg.GameId AND tp.TeamId = tg.TeamId
                LEFT JOIN TeamShots ts ON ts.GameId = tg.GameId AND ts.TeamId = tg.TeamId
                GROUP BY tg.TeamId, t.Name, t.TeamType, tg.SeasonId, s.SeasonName
                ORDER BY GF DESC, TeamName ASC;";

            using var conn = _connectionFactory.CreateConnection();
            await EnsureGameStatsSnapshotTable(conn);
            var rows = await conn.QueryAsync(sql, new { SeasonId = seasonId, LevelId = levelId, TeamType = teamType, TeamId = teamId });

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(rows.ToArray());
            return response;
        }

        [Function("GetPlayerStats")]
        public async Task<HttpResponseData> GetPlayerStats(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "stats/player")] HttpRequestData req)
        {
            var denied = await ValidateStatsAccess(req);
            if (denied != null) return denied;

            var query = ParseQuery(req.Url.Query);
            var seasonId = ParseGuid(query, "seasonId");
            var levelId = ParseGuid(query, "levelId");
            var teamId = ParseGuid(query, "teamId");
            var playerId = ParseGuid(query, "playerId");
            var teamType = ParseTeamType(query, "teamType");

            const string sql = @"
                WITH FinalGames AS (
                    SELECT DISTINCT g.GameId
                    FROM Games g
                    INNER JOIN Teams ht ON ht.Id = g.HomeTeamId
                    INNER JOIN Teams at ON at.Id = g.AwayTeamId
                    WHERE UPPER(ISNULL(g.Status, 'SCHEDULED')) IN ('FINAL', 'COMPLETED', 'CLOSED')
                      AND (@SeasonId IS NULL OR ht.SeasonId = @SeasonId OR at.SeasonId = @SeasonId)
                                            AND (@LevelId IS NULL OR ht.LevelId = @LevelId OR at.LevelId = @LevelId)
                                            AND (@TeamType IS NULL OR ht.TeamType = @TeamType OR at.TeamType = @TeamType)
                      AND (@TeamId IS NULL OR g.HomeTeamId = @TeamId OR g.AwayTeamId = @TeamId)
                ),
                GoalRows AS (
                    SELECT gg.ScorerId AS PlayerId, COUNT(*) AS Goals
                    FROM GameGoals gg
                    INNER JOIN FinalGames fg ON fg.GameId = gg.GameId
                    GROUP BY gg.ScorerId
                ),
                AssistRows AS (
                    SELECT x.PlayerId, COUNT(*) AS Assists
                    FROM (
                        SELECT gg.Assist1Id AS PlayerId, gg.GameId
                        FROM GameGoals gg
                        INNER JOIN FinalGames fg ON fg.GameId = gg.GameId
                        WHERE gg.Assist1Id IS NOT NULL
                        UNION ALL
                        SELECT gg.Assist2Id AS PlayerId, gg.GameId
                        FROM GameGoals gg
                        INNER JOIN FinalGames fg ON fg.GameId = gg.GameId
                        WHERE gg.Assist2Id IS NOT NULL
                    ) x
                    GROUP BY x.PlayerId
                ),
                PimRows AS (
                    SELECT gp.PlayerId, SUM(ISNULL(gp.DurationMinutes, 0)) AS PIM
                    FROM GamePenalties gp
                    INNER JOIN FinalGames fg ON fg.GameId = gp.GameId
                    GROUP BY gp.PlayerId
                ),
                GpRows AS (
                    SELECT z.PlayerId, COUNT(DISTINCT z.GameId) AS GP
                    FROM (
                        SELECT gg.ScorerId AS PlayerId, gg.GameId
                        FROM GameGoals gg
                        INNER JOIN FinalGames fg ON fg.GameId = gg.GameId
                        UNION ALL
                        SELECT gg.Assist1Id AS PlayerId, gg.GameId
                        FROM GameGoals gg
                        INNER JOIN FinalGames fg ON fg.GameId = gg.GameId
                        WHERE gg.Assist1Id IS NOT NULL
                        UNION ALL
                        SELECT gg.Assist2Id AS PlayerId, gg.GameId
                        FROM GameGoals gg
                        INNER JOIN FinalGames fg ON fg.GameId = gg.GameId
                        WHERE gg.Assist2Id IS NOT NULL
                        UNION ALL
                        SELECT gp.PlayerId AS PlayerId, gp.GameId
                        FROM GamePenalties gp
                        INNER JOIN FinalGames fg ON fg.GameId = gp.GameId
                    ) z
                    GROUP BY z.PlayerId
                ),
                GoalieEstimateRows AS (
                    SELECT
                        p.PlayerId,
                        SUM(TRY_CAST(JSON_VALUE(js.[value], '$.shotsAgainst') AS DECIMAL(10,2))) AS EstShotsAgainst,
                        SUM(TRY_CAST(JSON_VALUE(js.[value], '$.savesEstimate') AS DECIMAL(10,2))) AS EstSaves,
                        SUM(TRY_CAST(JSON_VALUE(js.[value], '$.goalsAgainstEstimate') AS DECIMAL(10,2))) AS EstGoalsAgainst,
                        SUM(TRY_CAST(JSON_VALUE(js.[value], '$.timeInNetSeconds') AS DECIMAL(18,2))) AS TimeInNetSeconds
                    FROM FinalGames fg
                    INNER JOIN GameStatsSnapshots gss ON gss.GameId = fg.GameId
                    CROSS APPLY OPENJSON(
                        CASE
                            WHEN ISJSON(gss.GoalieSummaryJson) = 1 THEN gss.GoalieSummaryJson
                            ELSE '[]'
                        END
                    ) js
                    INNER JOIN Players p
                        ON p.FullName = JSON_VALUE(js.[value], '$.goalieName')
                    INNER JOIN PlayerTeams pt
                        ON pt.PlayerId = p.PlayerId
                        AND pt.TeamId = TRY_CAST(JSON_VALUE(js.[value], '$.goalieTeamId') AS UNIQUEIDENTIFIER)
                    GROUP BY p.PlayerId
                ),
                PlayerBase AS (
                    SELECT DISTINCT p.PlayerId, p.FullName, p.Position
                    FROM Players p
                    LEFT JOIN GoalRows g ON g.PlayerId = p.PlayerId
                    LEFT JOIN AssistRows a ON a.PlayerId = p.PlayerId
                    LEFT JOIN PimRows pm ON pm.PlayerId = p.PlayerId
                    LEFT JOIN GpRows gp ON gp.PlayerId = p.PlayerId
                    LEFT JOIN GoalieEstimateRows ge ON ge.PlayerId = p.PlayerId
                    WHERE g.PlayerId IS NOT NULL OR a.PlayerId IS NOT NULL OR pm.PlayerId IS NOT NULL OR gp.PlayerId IS NOT NULL
                       OR ge.PlayerId IS NOT NULL
                )
                SELECT
                    pb.PlayerId,
                    pb.FullName,
                    pb.Position,
                    ISNULL(gp.GP, 0) AS GP,
                    ISNULL(g.Goals, 0) AS G,
                    ISNULL(a.Assists, 0) AS A,
                    ISNULL(g.Goals, 0) + ISNULL(a.Assists, 0) AS Pts,
                    ISNULL(pm.PIM, 0) AS PIM,
                    ISNULL(ge.EstShotsAgainst, 0) AS EstShotsAgainst,
                    ISNULL(ge.EstSaves, 0) AS EstSaves,
                    CASE
                        WHEN ISNULL(ge.EstShotsAgainst, 0) = 0 THEN CAST(0 AS DECIMAL(10,2))
                        ELSE CAST((ISNULL(ge.EstSaves, 0) * 100.0) / ISNULL(ge.EstShotsAgainst, 0) AS DECIMAL(10,2))
                    END AS EstSavePct,
                    CASE
                        WHEN ISNULL(ge.TimeInNetSeconds, 0) = 0 THEN CAST(0 AS DECIMAL(10,2))
                        ELSE CAST((ISNULL(ge.EstGoalsAgainst, 0) * 3600.0) / ISNULL(ge.TimeInNetSeconds, 0) AS DECIMAL(10,2))
                    END AS EstGAA
                FROM PlayerBase pb
                LEFT JOIN GoalRows g ON g.PlayerId = pb.PlayerId
                LEFT JOIN AssistRows a ON a.PlayerId = pb.PlayerId
                LEFT JOIN PimRows pm ON pm.PlayerId = pb.PlayerId
                LEFT JOIN GpRows gp ON gp.PlayerId = pb.PlayerId
                LEFT JOIN GoalieEstimateRows ge ON ge.PlayerId = pb.PlayerId
                WHERE (@PlayerId IS NULL OR pb.PlayerId = @PlayerId)
                ORDER BY Pts DESC, G DESC, A DESC, pb.FullName ASC;";

            using var conn = _connectionFactory.CreateConnection();
            await EnsureGameStatsSnapshotTable(conn);
            var rows = await conn.QueryAsync(sql, new { SeasonId = seasonId, LevelId = levelId, TeamType = teamType, TeamId = teamId, PlayerId = playerId });

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(rows.ToArray());
            return response;
        }

        [Function("GetGameStats")]
        public async Task<HttpResponseData> GetGameStats(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "stats/game")] HttpRequestData req)
        {
            var denied = await ValidateStatsAccess(req);
            if (denied != null) return denied;

            var query = ParseQuery(req.Url.Query);
            var seasonId = ParseGuid(query, "seasonId");
            var levelId = ParseGuid(query, "levelId");
            var teamId = ParseGuid(query, "teamId");
            var gameId = ParseGuid(query, "gameId");
            var teamType = ParseTeamType(query, "teamType");

            const string sql = @"
                WITH FilteredGames AS (
                    SELECT
                        g.GameId,
                        g.GameDateTime,
                        g.HomeTeamId,
                        ht.Name AS HomeTeamName,
                        g.AwayTeamId,
                        at.Name AS AwayTeamName,
                        COALESCE(ht.SeasonId, at.SeasonId) AS SeasonId
                    FROM Games g
                    LEFT JOIN Teams ht ON ht.Id = g.HomeTeamId
                    LEFT JOIN Teams at ON at.Id = g.AwayTeamId
                    WHERE UPPER(ISNULL(g.Status, 'SCHEDULED')) IN ('FINAL', 'COMPLETED', 'CLOSED')
                      AND (@SeasonId IS NULL OR ht.SeasonId = @SeasonId OR at.SeasonId = @SeasonId)
                                            AND (@LevelId IS NULL OR ht.LevelId = @LevelId OR at.LevelId = @LevelId)
                                            AND (@TeamType IS NULL OR ht.TeamType = @TeamType OR at.TeamType = @TeamType)
                      AND (@TeamId IS NULL OR g.HomeTeamId = @TeamId OR g.AwayTeamId = @TeamId)
                      AND (@GameId IS NULL OR g.GameId = @GameId)
                ),
                GoalAgg AS (
                    SELECT
                        gg.GameId,
                        SUM(CASE WHEN gg.ScoringTeamId = fg.HomeTeamId THEN 1 ELSE 0 END) AS HomeGoals,
                        SUM(CASE WHEN gg.ScoringTeamId = fg.AwayTeamId THEN 1 ELSE 0 END) AS AwayGoals
                    FROM GameGoals gg
                    INNER JOIN FilteredGames fg ON fg.GameId = gg.GameId
                    GROUP BY gg.GameId
                ),
                PimAgg AS (
                    SELECT
                        gp.GameId,
                        SUM(CASE WHEN gp.TeamId = fg.HomeTeamId THEN ISNULL(gp.DurationMinutes, 0) ELSE 0 END) AS HomePIM,
                        SUM(CASE WHEN gp.TeamId = fg.AwayTeamId THEN ISNULL(gp.DurationMinutes, 0) ELSE 0 END) AS AwayPIM
                    FROM GamePenalties gp
                    INNER JOIN FilteredGames fg ON fg.GameId = gp.GameId
                    GROUP BY gp.GameId
                )
                SELECT
                    fg.GameId,
                    fg.GameDateTime,
                    fg.SeasonId,
                    s.SeasonName,
                    fg.HomeTeamId,
                    fg.HomeTeamName,
                    fg.AwayTeamId,
                    fg.AwayTeamName,
                    ISNULL(ga.HomeGoals, 0) AS HomeGoals,
                    ISNULL(ga.AwayGoals, 0) AS AwayGoals,
                    ISNULL(gss.HomeShotsTotal, 0) AS HomeShots,
                    ISNULL(gss.AwayShotsTotal, 0) AS AwayShots,
                    ISNULL(pa.HomePIM, 0) AS HomePIM,
                    ISNULL(pa.AwayPIM, 0) AS AwayPIM
                FROM FilteredGames fg
                LEFT JOIN Seasons s ON s.SeasonId = fg.SeasonId
                LEFT JOIN GoalAgg ga ON ga.GameId = fg.GameId
                LEFT JOIN PimAgg pa ON pa.GameId = fg.GameId
                LEFT JOIN GameStatsSnapshots gss ON gss.GameId = fg.GameId
                ORDER BY fg.GameDateTime DESC;";

            using var conn = _connectionFactory.CreateConnection();
            await EnsureGameStatsSnapshotTable(conn);
            var rows = await conn.QueryAsync(sql, new { SeasonId = seasonId, LevelId = levelId, TeamType = teamType, TeamId = teamId, GameId = gameId });

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(rows.ToArray());
            return response;
        }

        [Function("GetSeasonStats")]
        public async Task<HttpResponseData> GetSeasonStats(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "stats/season")] HttpRequestData req)
        {
            var denied = await ValidateStatsAccess(req);
            if (denied != null) return denied;

            var query = ParseQuery(req.Url.Query);
            var seasonId = ParseGuid(query, "seasonId");
            var levelId = ParseGuid(query, "levelId");
            var teamId = ParseGuid(query, "teamId");
            var teamType = ParseTeamType(query, "teamType");

            const string sql = @"
                WITH FilteredGames AS (
                    SELECT DISTINCT
                        g.GameId,
                        COALESCE(ht.SeasonId, at.SeasonId) AS SeasonId
                    FROM Games g
                    LEFT JOIN Teams ht ON ht.Id = g.HomeTeamId
                    LEFT JOIN Teams at ON at.Id = g.AwayTeamId
                    WHERE UPPER(ISNULL(g.Status, 'SCHEDULED')) IN ('FINAL', 'COMPLETED', 'CLOSED')
                      AND (@SeasonId IS NULL OR ht.SeasonId = @SeasonId OR at.SeasonId = @SeasonId)
                                            AND (@LevelId IS NULL OR ht.LevelId = @LevelId OR at.LevelId = @LevelId)
                                            AND (@TeamType IS NULL OR ht.TeamType = @TeamType OR at.TeamType = @TeamType)
                      AND (
                        @TeamId IS NULL OR
                        g.HomeTeamId = @TeamId OR
                        g.AwayTeamId = @TeamId
                      )
                )
                SELECT
                    fg.SeasonId,
                    s.SeasonName,
                    COUNT(DISTINCT fg.GameId) AS GamesFinal,
                    COUNT(gg.Id) AS Goals,
                    COUNT(gp.Id) AS Penalties,
                    ISNULL(SUM(gp.DurationMinutes), 0) AS PIM,
                    ISNULL(SUM(gss.HomeShotsTotal), 0) + ISNULL(SUM(gss.AwayShotsTotal), 0) AS Shots,
                    CASE
                        WHEN COUNT(DISTINCT fg.GameId) = 0 THEN 0
                        ELSE CAST(COUNT(gg.Id) * 1.0 / COUNT(DISTINCT fg.GameId) AS DECIMAL(10,2))
                    END AS AvgGoalsPerGame,
                    CASE
                        WHEN COUNT(DISTINCT fg.GameId) = 0 THEN 0
                        ELSE CAST((ISNULL(SUM(gss.HomeShotsTotal), 0) + ISNULL(SUM(gss.AwayShotsTotal), 0)) * 1.0 / COUNT(DISTINCT fg.GameId) AS DECIMAL(10,2))
                    END AS AvgShotsPerGame
                FROM FilteredGames fg
                LEFT JOIN Seasons s ON s.SeasonId = fg.SeasonId
                LEFT JOIN GameGoals gg ON gg.GameId = fg.GameId
                LEFT JOIN GamePenalties gp ON gp.GameId = fg.GameId
                LEFT JOIN GameStatsSnapshots gss ON gss.GameId = fg.GameId
                GROUP BY fg.SeasonId, s.SeasonName
                ORDER BY s.SeasonName DESC;";

            using var conn = _connectionFactory.CreateConnection();
            await EnsureGameStatsSnapshotTable(conn);
            var rows = await conn.QueryAsync(sql, new { SeasonId = seasonId, LevelId = levelId, TeamType = teamType, TeamId = teamId });

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(rows.ToArray());
            return response;
        }

        [Function("GetLeagueLeaders")]
        public async Task<HttpResponseData> GetLeagueLeaders(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "stats/leaders")] HttpRequestData req)
        {
            var denied = await ValidateStatsAccess(req);
            if (denied != null) return denied;

            var query = ParseQuery(req.Url.Query);
            var seasonId = ParseGuid(query, "seasonId");
            var levelId = ParseGuid(query, "levelId");
            var teamId = ParseGuid(query, "teamId");
            var teamType = ParseTeamType(query, "teamType");
            var limit = ParseInt(query, "limit") ?? 10;
            if (limit < 1) limit = 10;
            if (limit > 50) limit = 50;

            const string basePlayerSql = @"
                WITH FinalGames AS (
                    SELECT DISTINCT g.GameId
                    FROM Games g
                    INNER JOIN Teams ht ON ht.Id = g.HomeTeamId
                    INNER JOIN Teams at ON at.Id = g.AwayTeamId
                    WHERE UPPER(ISNULL(g.Status, 'SCHEDULED')) IN ('FINAL', 'COMPLETED', 'CLOSED')
                      AND (@SeasonId IS NULL OR ht.SeasonId = @SeasonId OR at.SeasonId = @SeasonId)
                                            AND (@LevelId IS NULL OR ht.LevelId = @LevelId OR at.LevelId = @LevelId)
                                            AND (@TeamType IS NULL OR ht.TeamType = @TeamType OR at.TeamType = @TeamType)
                      AND (@TeamId IS NULL OR g.HomeTeamId = @TeamId OR g.AwayTeamId = @TeamId)
                ),
                GoalRows AS (
                    SELECT gg.ScorerId AS PlayerId, COUNT(*) AS Goals
                    FROM GameGoals gg
                    INNER JOIN FinalGames fg ON fg.GameId = gg.GameId
                    GROUP BY gg.ScorerId
                ),
                AssistRows AS (
                    SELECT x.PlayerId, COUNT(*) AS Assists
                    FROM (
                        SELECT gg.Assist1Id AS PlayerId, gg.GameId
                        FROM GameGoals gg
                        INNER JOIN FinalGames fg ON fg.GameId = gg.GameId
                        WHERE gg.Assist1Id IS NOT NULL
                        UNION ALL
                        SELECT gg.Assist2Id AS PlayerId, gg.GameId
                        FROM GameGoals gg
                        INNER JOIN FinalGames fg ON fg.GameId = gg.GameId
                        WHERE gg.Assist2Id IS NOT NULL
                    ) x
                    GROUP BY x.PlayerId
                ),
                PimRows AS (
                    SELECT gp.PlayerId, SUM(ISNULL(gp.DurationMinutes, 0)) AS PIM
                    FROM GamePenalties gp
                    INNER JOIN FinalGames fg ON fg.GameId = gp.GameId
                    GROUP BY gp.PlayerId
                )
                SELECT
                    p.PlayerId,
                    p.FullName,
                    ISNULL(g.Goals, 0) AS Goals,
                    ISNULL(a.Assists, 0) AS Assists,
                    ISNULL(g.Goals, 0) + ISNULL(a.Assists, 0) AS Points,
                    ISNULL(pm.PIM, 0) AS PIM
                FROM Players p
                LEFT JOIN GoalRows g ON g.PlayerId = p.PlayerId
                LEFT JOIN AssistRows a ON a.PlayerId = p.PlayerId
                LEFT JOIN PimRows pm ON pm.PlayerId = p.PlayerId
                WHERE ISNULL(g.Goals, 0) > 0 OR ISNULL(a.Assists, 0) > 0 OR ISNULL(pm.PIM, 0) > 0";

            using var conn = _connectionFactory.CreateConnection();
            await EnsureGameStatsSnapshotTable(conn);

            var topPoints = await conn.QueryAsync(
                $"{basePlayerSql} ORDER BY Points DESC, Goals DESC, Assists DESC, FullName ASC OFFSET 0 ROWS FETCH NEXT @Limit ROWS ONLY;",
                new { SeasonId = seasonId, LevelId = levelId, TeamType = teamType, TeamId = teamId, Limit = limit });

            var topGoals = await conn.QueryAsync(
                $"{basePlayerSql} ORDER BY Goals DESC, Points DESC, FullName ASC OFFSET 0 ROWS FETCH NEXT @Limit ROWS ONLY;",
                new { SeasonId = seasonId, LevelId = levelId, TeamType = teamType, TeamId = teamId, Limit = limit });

            var topAssists = await conn.QueryAsync(
                $"{basePlayerSql} ORDER BY Assists DESC, Points DESC, FullName ASC OFFSET 0 ROWS FETCH NEXT @Limit ROWS ONLY;",
                new { SeasonId = seasonId, LevelId = levelId, TeamType = teamType, TeamId = teamId, Limit = limit });

            var topPim = await conn.QueryAsync(
                $"{basePlayerSql} ORDER BY PIM DESC, Points DESC, FullName ASC OFFSET 0 ROWS FETCH NEXT @Limit ROWS ONLY;",
                new { SeasonId = seasonId, LevelId = levelId, TeamType = teamType, TeamId = teamId, Limit = limit });

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                topPoints = topPoints.ToArray(),
                topGoals = topGoals.ToArray(),
                topAssists = topAssists.ToArray(),
                topPim = topPim.ToArray()
            });
            return response;
        }

        private async Task<HttpResponseData?> ValidateStatsAccess(HttpRequestData req)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrWhiteSpace(token))
            {
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");
            }

            var (isValid, _, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
            {
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");
            }

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin", "TeamManager", "Coach", "Viewer"))
            {
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view stats");
            }

            return null;
        }

        private static Dictionary<string, string> ParseQuery(string query)
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (string.IsNullOrWhiteSpace(query)) return result;

            var text = query.StartsWith("?") ? query.Substring(1) : query;
            var parts = text.Split('&', StringSplitOptions.RemoveEmptyEntries);
            foreach (var part in parts)
            {
                var idx = part.IndexOf('=');
                if (idx < 0)
                {
                    result[Uri.UnescapeDataString(part)] = string.Empty;
                    continue;
                }

                var key = Uri.UnescapeDataString(part.Substring(0, idx));
                var value = Uri.UnescapeDataString(part.Substring(idx + 1));
                result[key] = value;
            }

            return result;
        }

        private static Guid? ParseGuid(Dictionary<string, string> query, string key)
        {
            if (!query.TryGetValue(key, out var value) || string.IsNullOrWhiteSpace(value)) return null;
            return Guid.TryParse(value, out var parsed) ? parsed : null;
        }

        private static int? ParseInt(Dictionary<string, string> query, string key)
        {
            if (!query.TryGetValue(key, out var value) || string.IsNullOrWhiteSpace(value)) return null;
            return int.TryParse(value, out var parsed) ? parsed : null;
        }

        private static string? ParseTeamType(Dictionary<string, string> query, string key)
        {
            if (!query.TryGetValue(key, out var value) || string.IsNullOrWhiteSpace(value))
            {
                return null;
            }

            return value.Trim();
        }

        private static async Task EnsureGameStatsSnapshotTable(IDbConnection conn)
        {
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

            await conn.ExecuteAsync(ensureSnapshotTableSql);
        }
    }
}
