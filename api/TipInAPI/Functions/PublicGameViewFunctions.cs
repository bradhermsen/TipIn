using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using Dapper;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using TipInAPI.DTOs;
using TipInAPI.Infrastructure.Database;
using TipInAPI.Services;

namespace TipInAPI.Functions
{
    public class PublicGameViewFunctions
    {
        private readonly IOrganizationService _organizationService;
        private readonly ISeasonsService _seasonsService;
        private readonly ITeamsService _teamsService;
        private readonly IGameService _gameService;
        private readonly IGameSummaryReportService _gameSummaryReportService;
        private readonly ISqlConnectionFactory _connectionFactory;

        public PublicGameViewFunctions(
            IOrganizationService organizationService,
            ISeasonsService seasonsService,
            ITeamsService teamsService,
            IGameService gameService,
            IGameSummaryReportService gameSummaryReportService,
            ISqlConnectionFactory connectionFactory)
        {
            _organizationService = organizationService;
            _seasonsService = seasonsService;
            _teamsService = teamsService;
            _gameService = gameService;
            _gameSummaryReportService = gameSummaryReportService;
            _connectionFactory = connectionFactory;
        }

        [Function("GetPublicGameViewOrganizations")]
        public async Task<HttpResponseData> GetOrganizations(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "public/gameview/organizations")] HttpRequestData req)
        {
            var items = (await _organizationService.GetAllAsync())
                .Where(item => item.IsActive)
                .OrderBy(item => item.Name)
                .Select(item => new
                {
                    item.OrganizationId,
                    item.LeagueId,
                    item.LeagueName,
                    item.Name,
                    item.Abbreviation,
                    item.Mascot,
                    item.OrganizationType,
                    item.IsActive,
                });

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(items);
            return response;
        }

        [Function("GetPublicGameViewSeasons")]
        public async Task<HttpResponseData> GetSeasons(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "public/gameview/seasons")] HttpRequestData req)
        {
            var items = (await _seasonsService.GetAllAsync())
                .OrderByDescending(item => item.EndDate)
                .Select(item => new
                {
                    item.SeasonId,
                    item.SeasonName,
                    item.StartDate,
                    item.EndDate,
                    item.IsActive,
                });

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(items);
            return response;
        }

        [Function("GetPublicGameViewTeams")]
        public async Task<HttpResponseData> GetTeams(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "public/gameview/teams")] HttpRequestData req)
        {
            var query = ParseQuery(req.Url.Query);
            var organizationId = ParseGuid(query, "organizationId");
            var seasonId = ParseGuid(query, "seasonId");
            var teamType = ParseString(query, "teamType");
            var organizations = (await _organizationService.GetAllAsync())
                .ToDictionary(item => item.OrganizationId);

            var teams = (await _teamsService.GetAllAsync())
                .Where(team => !organizationId.HasValue || team.OrganizationId == organizationId.Value)
                .Where(team => !seasonId.HasValue || team.SeasonId == seasonId.Value)
                .Where(team => string.IsNullOrWhiteSpace(teamType) || string.Equals(team.TeamType, teamType, StringComparison.OrdinalIgnoreCase))
                .OrderBy(team => team.Name)
                .Select(team =>
                {
                    OrganizationListItemDto? organization = null;
                    if (team.OrganizationId.HasValue)
                    {
                        organizations.TryGetValue(team.OrganizationId.Value, out organization);
                    }

                    return new
                    {
                        team.TeamId,
                        team.OrganizationId,
                        LeagueId = organization?.LeagueId ?? Guid.Empty,
                        OrganizationType = organization?.OrganizationType ?? "Managed",
                        team.SeasonId,
                        team.Name,
                        team.TeamType,
                        team.LevelName,
                        team.TeamMascot,
                        team.IsActive,
                    };
                });

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(teams);
            return response;
        }

        [Function("GetPublicGameViewGames")]
        public async Task<HttpResponseData> GetGames(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "public/gameview/games")] HttpRequestData req)
        {
            var query = ParseQuery(req.Url.Query);
            var organizationId = ParseGuid(query, "organizationId");
            var seasonId = ParseGuid(query, "seasonId");
            var teamId = ParseGuid(query, "teamId");
            var teamType = ParseString(query, "teamType");

            var teams = (await _teamsService.GetAllAsync()).ToArray();
            var teamMap = teams.ToDictionary(team => team.TeamId, team => team);

            var eligibleTeamIds = new HashSet<Guid>(
                teams
                    .Where(team => !organizationId.HasValue || team.OrganizationId == organizationId.Value)
                    .Where(team => !seasonId.HasValue || team.SeasonId == seasonId.Value)
                    .Where(team => string.IsNullOrWhiteSpace(teamType) || string.Equals(team.TeamType, teamType, StringComparison.OrdinalIgnoreCase))
                    .Select(team => team.TeamId));

            var items = (await _gameService.GetAllAsync())
                .Where(game => !teamId.HasValue || game.HomeTeamId == teamId.Value || game.AwayTeamId == teamId.Value)
                .Where(game => eligibleTeamIds.Count == 0 || eligibleTeamIds.Contains(game.HomeTeamId) || eligibleTeamIds.Contains(game.AwayTeamId))
                .OrderByDescending(game => game.GameDateTime)
                .Select(game =>
                {
                    teamMap.TryGetValue(game.HomeTeamId, out var homeTeam);
                    teamMap.TryGetValue(game.AwayTeamId, out var awayTeam);

                    return new
                    {
                        game.GameId,
                        game.HomeTeamId,
                        game.HomeTeamName,
                        game.AwayTeamId,
                        game.AwayTeamName,
                        game.GameDateTime,
                        game.Status,
                        HomeTeamMascot = homeTeam?.TeamMascot,
                        AwayTeamMascot = awayTeam?.TeamMascot,
                        TeamType = homeTeam?.TeamType ?? awayTeam?.TeamType,
                        LevelName = homeTeam?.LevelName ?? awayTeam?.LevelName,
                    };
                });

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(items);
            return response;
        }

        [Function("GetPublicGameViewGameById")]
        public async Task<HttpResponseData> GetGameById(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "public/gameview/games/{gameId:guid}")] HttpRequestData req,
            Guid gameId)
        {
            var game = await _gameService.GetByIdAsync(gameId);
            if (game == null)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            var teams = (await _teamsService.GetAllAsync()).ToArray();
            var homeTeam = teams.FirstOrDefault(team => team.TeamId == game.HomeTeamId);
            var awayTeam = teams.FirstOrDefault(team => team.TeamId == game.AwayTeamId);

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                game.GameId,
                game.HomeTeamId,
                game.HomeTeamName,
                game.AwayTeamId,
                game.AwayTeamName,
                game.GameDateTime,
                game.Status,
                game.PeriodLengthMinutes,
                game.ArenaName,
                game.RinkName,
                TeamType = homeTeam?.TeamType ?? awayTeam?.TeamType,
                LevelName = homeTeam?.LevelName ?? awayTeam?.LevelName,
                HomeTeamMascot = homeTeam?.TeamMascot,
                AwayTeamMascot = awayTeam?.TeamMascot,
            });
            return response;
        }

        [Function("GetPublicGameViewSummary")]
        public async Task<HttpResponseData> GetSummary(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "public/gameview/games/{gameId:guid}/summary")] HttpRequestData req,
            Guid gameId)
        {
            var report = await _gameSummaryReportService.BuildReportAsync(gameId);
            if (report == null)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            var liveStatus = await GetLiveStatusAsync(gameId);
                        using var conn = _connectionFactory.CreateConnection();
                        var shots = (await conn.QueryAsync(@"
                                SELECT
                                        ge.Id AS EventId,
                                        ge.Period,
                                        ge.TimeInPeriod,
                                        t.Name AS TeamName
                                FROM dbo.GameEvents ge
                                INNER JOIN dbo.Teams t ON t.Id = ge.TeamId
                                WHERE ge.GameId = @GameId
                                    AND ge.EventType = 'Shot'
                                ORDER BY ge.Period, ge.TimeInPeriod, ge.CreatedAt;",
                                new { GameId = gameId })).ToArray();

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                report.GameId,
                report.Status,
                    Goals = report.Goals.Select((goal, index) => new
                {
                    EventId = $"goal-{index + 1}",
                    goal.Period,
                    goal.TimeInPeriod,
                    goal.TeamName,
                    ScorerName = goal.Scorer,
                    Assist1Name = goal.Assist1,
                    Assist2Name = goal.Assist2,
                    goal.Strength,
                }),
                    CurrentPeriod = liveStatus?.CurrentPeriod,
                Penalties = report.Penalties.Select((penalty, index) => new
                {
                    EventId = $"penalty-{index + 1}",
                    penalty.Period,
                    penalty.TimeInPeriod,
                    penalty.TeamName,
                    penalty.PlayerName,
                    penalty.Infraction,
                    penalty.DurationMinutes,
                }),
                Shots = shots,
                HomeShotsP1 = report.HomeShots.P1,
                HomeShotsP2 = report.HomeShots.P2,
                HomeShotsP3 = report.HomeShots.P3,
                HomeShotsOT = report.HomeShots.OT,
                HomeShots = report.HomeShots.Total,
                AwayShotsP1 = report.AwayShots.P1,
                AwayShotsP2 = report.AwayShots.P2,
                AwayShotsP3 = report.AwayShots.P3,
                AwayShotsOT = report.AwayShots.OT,
                AwayShots = report.AwayShots.Total,
                liveStatus.HomeOnPowerPlay,
                liveStatus.AwayOnPowerPlay,
                liveStatus.HomeSkatersOnIce,
                liveStatus.AwaySkatersOnIce,
            });
            return response;
        }

        [Function("GetPublicGameViewSummaryReport")]
        public async Task<HttpResponseData> GetSummaryReport(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "public/gameview/games/{gameId:guid}/summary-report")] HttpRequestData req,
            Guid gameId)
        {
            var report = await _gameSummaryReportService.BuildReportAsync(gameId);
            if (report == null)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                report.GameId,
                report.LeagueName,
                report.HomeLevelName,
                report.AwayLevelName,
                report.SeasonName,
                report.GameDateTime,
                report.Status,
                report.HomeTeamName,
                report.AwayTeamName,
                report.TeamType,
                report.HomeTeamMascot,
                report.AwayTeamMascot,
                report.ArenaName,
                report.RinkName,
                report.HomeHeadCoachName,
                report.HomeAssistantCoach1Name,
                report.HomeAssistantCoach2Name,
                report.HomeAssistantCoach3Name,
                report.HomeAssistantCoach4Name,
                report.AwayHeadCoachName,
                report.AwayAssistantCoach1Name,
                report.AwayAssistantCoach2Name,
                report.AwayAssistantCoach3Name,
                report.AwayAssistantCoach4Name,
                report.HomeGoals,
                report.AwayGoals,
                HomeShots = report.HomeShots,
                AwayShots = report.AwayShots,
                Goals = report.Goals,
                Penalties = report.Penalties.Select(penalty => new
                {
                    penalty.Period,
                    penalty.TimeInPeriod,
                    penalty.TeamName,
                    penalty.PlayerNumber,
                    penalty.PlayerName,
                    penalty.Infraction,
                    penalty.DurationMinutes,
                    penalty.PenaltyType,
                    Notes = (string?)null,
                }),
                Goalies = report.Goalies,
                Officials = Array.Empty<object>(),
                SuspensionReviews = Array.Empty<object>(),
            });
            return response;
        }

        [Function("GetPublicGameViewRosters")]
        public async Task<HttpResponseData> GetRosters(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "public/gameview/games/{gameId:guid}/rosters")] HttpRequestData req,
            Guid gameId)
        {
            var game = await _gameService.GetByIdAsync(gameId);
            if (game == null)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            var report = await _gameSummaryReportService.BuildReportAsync(gameId);
            if (report == null)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            using var conn = _connectionFactory.CreateConnection();
            var rows = (await conn.QueryAsync<PublicRosterSourceRow>(@"
                SELECT
                    r.TeamId,
                    r.PlayerId,
                    COALESCE(NULLIF(p.FullName, ''), CONCAT(p.FirstName, ' ', p.LastName)) AS FullName,
                    COALESCE(r.JerseyNumber, p.JerseyNumber) AS JerseyNumber,
                    COALESCE(NULLIF(r.Position, ''), p.Position) AS Position,
                    CAST(COALESCE(r.Grade, p.Grade) AS NVARCHAR(20)) AS Grade,
                    r.IsGoalie,
                    r.IsActive
                FROM RosterEntries r
                INNER JOIN Players p ON p.PlayerId = r.PlayerId
                WHERE r.TeamId IN @TeamIds
                ORDER BY r.TeamId, COALESCE(r.JerseyNumber, p.JerseyNumber), p.LastName, p.FirstName;",
                new { TeamIds = new[] { game.HomeTeamId, game.AwayTeamId } })).ToList();

            var liveStatus = await GetLiveStatusAsync(gameId);
            var homeStarterIds = ParseIdList(liveStatus.HomeStartersJson);
            var awayStarterIds = ParseIdList(liveStatus.AwayStartersJson);

            var rosterPayload = BuildPublicRosterPayload(game, report, rows, homeStarterIds, awayStarterIds);
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(rosterPayload);
            return response;
        }

        [Function("GetPublicGameViewCoaches")]
        public async Task<HttpResponseData> GetCoaches(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "public/gameview/games/{gameId:guid}/coaches")] HttpRequestData req,
            Guid gameId)
        {
            var report = await _gameSummaryReportService.BuildReportAsync(gameId);
            if (report == null)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                HomeCoaches = BuildCoachRows(
                    report.HomeHeadCoachName,
                    report.HomeAssistantCoach1Name,
                    report.HomeAssistantCoach2Name,
                    report.HomeAssistantCoach3Name,
                    report.HomeAssistantCoach4Name),
                AwayCoaches = BuildCoachRows(
                    report.AwayHeadCoachName,
                    report.AwayAssistantCoach1Name,
                    report.AwayAssistantCoach2Name,
                    report.AwayAssistantCoach3Name,
                    report.AwayAssistantCoach4Name),
            });
            return response;
        }

        private static IEnumerable<object> BuildCoachRows(
            string? headCoach,
            string? assistant1,
            string? assistant2,
            string? assistant3,
            string? assistant4)
        {
            var rows = new List<(string RoleName, string? CoachName)>
            {
                ("Head Coach", headCoach),
                ("Asst Coach 1", assistant1),
                ("Asst Coach 2", assistant2),
                ("Asst Coach 3", assistant3),
                ("Asst Coach 4", assistant4),
            };

            return rows
                .Where(row => !string.IsNullOrWhiteSpace(row.CoachName))
                .Select(row => new
                {
                    row.RoleName,
                    CoachName = row.CoachName!.Trim(),
                });
        }

        private static object BuildPublicRosterPayload(
            dynamic game,
            GameSummaryReport report,
            List<PublicRosterSourceRow> rows,
            HashSet<string> homeStarterIds,
            HashSet<string> awayStarterIds)
        {
            var goalsByPlayer = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var assistsByPlayer = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var penaltyByPlayer = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

            foreach (var goal in report.Goals)
            {
                Increment(goalsByPlayer, goal.Scorer);
                Increment(assistsByPlayer, goal.Assist1);
                Increment(assistsByPlayer, goal.Assist2);
            }

            foreach (var penalty in report.Penalties)
            {
                var playerName = (penalty.PlayerName ?? string.Empty).Trim();
                if (!string.IsNullOrWhiteSpace(playerName))
                {
                    penaltyByPlayer[playerName] = (penaltyByPlayer.TryGetValue(playerName, out var current) ? current : 0) + penalty.DurationMinutes;
                }
            }

            var goalieStatsRows = report.Goalies
                .Select(goalie => new PublicGoalieStatsRow
                {
                    RawName = goalie.GoalieName,
                    NormalizedName = NormalizeName(goalie.GoalieName),
                    LastName = ExtractLastName(goalie.GoalieName),
                    ShotsAgainst = goalie.Total,
                    GoalsAgainst = Convert.ToDouble(goalie.GoalsAgainstEstimate),
                    SavePercentage = Convert.ToDouble(goalie.SavePctEstimate * 100m),
                    MinutesPlayed = Math.Round(goalie.TimeInNetSeconds / 60d, 1),
                })
                .ToList();

            foreach (var goalie in goalieStatsRows)
            {
                goalie.GoalsAgainstAverage = goalie.MinutesPlayed > 0
                    ? goalie.GoalsAgainst * (51d / goalie.MinutesPlayed)
                    : 0;
            }

            var homeRows = rows.Where(row => row.TeamId == game.HomeTeamId).ToList();
            var awayRows = rows.Where(row => row.TeamId == game.AwayTeamId).ToList();

            return new
            {
                HomeRoster = BuildDisplayRows(homeRows, homeStarterIds, goalsByPlayer, assistsByPlayer, penaltyByPlayer, goalieStatsRows, "home"),
                AwayRoster = BuildDisplayRows(awayRows, awayStarterIds, goalsByPlayer, assistsByPlayer, penaltyByPlayer, goalieStatsRows, "away"),
                GoalieStatsNotice = BuildGoalieStatsNotice(report),
            };
        }

        private static IEnumerable<object> BuildDisplayRows(
            List<PublicRosterSourceRow> rows,
            HashSet<string> starterIds,
            Dictionary<string, int> goalsByPlayer,
            Dictionary<string, int> assistsByPlayer,
            Dictionary<string, int> penaltyByPlayer,
            List<PublicGoalieStatsRow> goalieStatsRows,
            string teamLabel)
        {
            return rows.Select((row, index) =>
            {
                var playerName = (row.FullName ?? string.Empty).Trim();
                var normalizedName = NormalizeName(playerName);
                var lastName = ExtractLastName(playerName);
                var goalieStats = MatchGoalieStats(normalizedName, lastName, goalieStatsRows);

                return new
                {
                    PlayerId = $"{teamLabel}-{index + 1}",
                    PlayerName = playerName,
                    JerseyNumber = row.JerseyNumber?.ToString() ?? string.Empty,
                    Position = string.IsNullOrWhiteSpace(row.Position) ? (row.IsGoalie ? "G" : string.Empty) : row.Position.Trim(),
                    Grade = row.Grade?.Trim() ?? string.Empty,
                    row.IsGoalie,
                    IsStarter = starterIds.Contains(row.PlayerId.ToString()),
                    Goals = goalsByPlayer.TryGetValue(playerName, out var goals) ? goals : 0,
                    Assists = assistsByPlayer.TryGetValue(playerName, out var assists) ? assists : 0,
                    PenaltyMinutes = penaltyByPlayer.TryGetValue(playerName, out var penaltyMinutes) ? penaltyMinutes : 0,
                    ShotsAgainst = goalieStats?.ShotsAgainst ?? 0,
                    GoalsAgainst = goalieStats?.GoalsAgainst ?? 0,
                    GoalsAgainstAverage = goalieStats?.GoalsAgainstAverage ?? 0,
                    SavePercentage = goalieStats?.SavePercentage ?? 0,
                    MinutesPlayed = goalieStats?.MinutesPlayed ?? 0,
                };
            });
        }

        private static string BuildGoalieStatsNotice(GameSummaryReport report)
        {
            if (report == null)
            {
                return "Goalie stats are unavailable right now because the game summary report could not be loaded.";
            }

            if (report.Goalies == null || report.Goalies.Count == 0)
            {
                return "Goalie stats are unavailable for this game because no goalie summary data was submitted.";
            }

            return string.Empty;
        }

        private async Task<PublicLiveStatusRow> GetLiveStatusAsync(Guid gameId)
        {
            using var conn = _connectionFactory.CreateConnection();

            if (!ObjectExistsInDb(conn, "GameLiveStatus"))
            {
                return new PublicLiveStatusRow();
            }

            try
            {
                return await conn.QueryFirstOrDefaultAsync<PublicLiveStatusRow>(
                           "SELECT HomeOnPowerPlay, AwayOnPowerPlay, CurrentPeriod, HomeSkatersOnIce, AwaySkatersOnIce, HomeStartersJson, AwayStartersJson FROM dbo.GameLiveStatus WHERE GameId = @GameId;",
                           new { GameId = gameId })
                       ?? new PublicLiveStatusRow();
            }
            catch
            {
                return new PublicLiveStatusRow();
            }
        }

        private static bool ObjectExistsInDb(System.Data.IDbConnection conn, string tableName)
        {
            return conn.QueryFirstOrDefault<int>(
                "SELECT COUNT(1) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @TableName;",
                new { TableName = tableName }) > 0;
        }

        private static HashSet<string> ParseIdList(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            try
            {
                var items = JsonSerializer.Deserialize<List<string>>(json) ?? new List<string>();
                return new HashSet<string>(items, StringComparer.OrdinalIgnoreCase);
            }
            catch
            {
                return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            }
        }

        private static void Increment(Dictionary<string, int> map, string? key)
        {
            var normalized = (key ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(normalized)) return;

            map[normalized] = (map.TryGetValue(normalized, out var current) ? current : 0) + 1;
        }

        private static PublicGoalieStatsRow? MatchGoalieStats(string normalizedName, string lastName, List<PublicGoalieStatsRow> rows)
        {
            if (string.IsNullOrWhiteSpace(normalizedName)) return null;

            var exact = rows.FirstOrDefault(row => row.NormalizedName == normalizedName);
            if (exact != null) return exact;

            if (!string.IsNullOrWhiteSpace(lastName))
            {
                var lastNameMatches = rows.Where(row => row.LastName == lastName).ToList();
                if (lastNameMatches.Count == 1) return lastNameMatches[0];

                var loose = lastNameMatches.FirstOrDefault(row =>
                    normalizedName.Contains(row.NormalizedName, StringComparison.OrdinalIgnoreCase) ||
                    row.NormalizedName.Contains(normalizedName, StringComparison.OrdinalIgnoreCase));
                if (loose != null) return loose;
            }

            return rows.FirstOrDefault(row =>
                normalizedName.Contains(row.NormalizedName, StringComparison.OrdinalIgnoreCase) ||
                row.NormalizedName.Contains(normalizedName, StringComparison.OrdinalIgnoreCase));
        }

        private static string NormalizeName(string? value)
        {
            var chars = (value ?? string.Empty)
                .ToLowerInvariant()
                .Select(character => char.IsLetterOrDigit(character) || char.IsWhiteSpace(character) ? character : ' ')
                .ToArray();
            return string.Join(' ', new string(chars).Split(' ', StringSplitOptions.RemoveEmptyEntries));
        }

        private static string ExtractLastName(string? value)
        {
            var tokens = NormalizeName(value).Split(' ', StringSplitOptions.RemoveEmptyEntries);
            return tokens.Length == 0 ? string.Empty : tokens[tokens.Length - 1];
        }

        private static Dictionary<string, string> ParseQuery(string query)
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (string.IsNullOrWhiteSpace(query)) return result;

            foreach (var pair in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                var parts = pair.Split('=', 2);
                var key = Uri.UnescapeDataString(parts[0]);
                var value = parts.Length > 1 ? Uri.UnescapeDataString(parts[1]) : string.Empty;
                result[key] = value;
            }

            return result;
        }

        private static Guid? ParseGuid(Dictionary<string, string> query, string key)
        {
            return query.TryGetValue(key, out var raw) && Guid.TryParse(raw, out var value)
                ? value
                : null;
        }

        private static string ParseString(Dictionary<string, string> query, string key)
        {
            return query.TryGetValue(key, out var value) ? value.Trim() : string.Empty;
        }

        private sealed class PublicRosterSourceRow
        {
            public Guid TeamId { get; set; }
            public Guid PlayerId { get; set; }
            public string? FullName { get; set; }
            public int? JerseyNumber { get; set; }
            public string? Position { get; set; }
            public string? Grade { get; set; }
            public bool IsGoalie { get; set; }
            public bool IsActive { get; set; }
        }

        private sealed class PublicGoalieStatsRow
        {
            public string RawName { get; set; } = string.Empty;
            public string NormalizedName { get; set; } = string.Empty;
            public string LastName { get; set; } = string.Empty;
            public int ShotsAgainst { get; set; }
            public double GoalsAgainst { get; set; }
            public double GoalsAgainstAverage { get; set; }
            public double SavePercentage { get; set; }
            public double MinutesPlayed { get; set; }
        }

        private sealed class PublicLiveStatusRow
        {
            public bool? HomeOnPowerPlay { get; set; }
            public bool? AwayOnPowerPlay { get; set; }
            public int? HomeSkatersOnIce { get; set; }
            public int? AwaySkatersOnIce { get; set; }
                public int? CurrentPeriod { get; set; }
            public string? HomeStartersJson { get; set; }
            public string? AwayStartersJson { get; set; }
        }
    }
}