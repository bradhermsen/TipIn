using System;
using System.Collections.Generic;
using System.Data;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.Infrastructure.Database;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace TipInAPI.Services
{
    public class GameSummaryReportService : IGameSummaryReportService
    {
        private readonly ISqlConnectionFactory _connectionFactory;

        public GameSummaryReportService(ISqlConnectionFactory connectionFactory)
        {
            _connectionFactory = connectionFactory;
            QuestPDF.Settings.License = LicenseType.Community;
        }

        public async Task<GameSummaryReport?> BuildReportAsync(Guid gameId)
        {
            using var conn = _connectionFactory.CreateConnection();

            var game = await conn.QueryFirstOrDefaultAsync<GameRow>(@"
                SELECT
                    g.GameId,
                    g.GameDateTime,
                    g.Status,
                    g.ArenaName,
                    g.RinkName,
                    g.HomeTeamId,
                    g.AwayTeamId,
                    ht.Name AS HomeTeamName,
                    at.Name AS AwayTeamName,
                    ht.TeamType AS HomeTeamType,
                    at.TeamType AS AwayTeamType,
                    ht.TeamMascot AS HomeTeamMascot,
                    at.TeamMascot AS AwayTeamMascot,
                    ho.Mascot AS HomeOrgMascot,
                    ao.Mascot AS AwayOrgMascot,
                    hl.Name AS HomeLevelName,
                    al.Name AS AwayLevelName,
                    lg.Name AS LeagueName,
                    s.SeasonName
                FROM Games g
                LEFT JOIN Teams ht ON ht.Id = g.HomeTeamId
                LEFT JOIN Teams at ON at.Id = g.AwayTeamId
                LEFT JOIN Levels hl ON hl.Id = ht.LevelId
                LEFT JOIN Levels al ON al.Id = at.LevelId
                LEFT JOIN Organizations ho ON ho.OrganizationId = ht.OrganizationId
                LEFT JOIN Organizations ao ON ao.OrganizationId = at.OrganizationId
                LEFT JOIN Leagues lg ON lg.Id = COALESCE(ho.LeagueId, ao.LeagueId)
                LEFT JOIN Seasons s ON s.SeasonId = COALESCE(ht.SeasonId, at.SeasonId)
                WHERE g.GameId = @GameId;", new { GameId = gameId });

            if (game == null)
            {
                return null;
            }

            var totals = await conn.QueryFirstOrDefaultAsync<ScoreAndShotRow>(@"
                SELECT
                    SUM(CASE WHEN gg.ScoringTeamId = g.HomeTeamId THEN 1 ELSE 0 END) AS HomeGoals,
                    SUM(CASE WHEN gg.ScoringTeamId = g.AwayTeamId THEN 1 ELSE 0 END) AS AwayGoals,
                    ISNULL(gss.HomeShotsP1, 0) AS HomeShotsP1,
                    ISNULL(gss.HomeShotsP2, 0) AS HomeShotsP2,
                    ISNULL(gss.HomeShotsP3, 0) AS HomeShotsP3,
                    ISNULL(gss.HomeShotsOT, 0) AS HomeShotsOT,
                    ISNULL(gss.HomeShotsTotal, 0) AS HomeShotsTotal,
                    ISNULL(gss.AwayShotsP1, 0) AS AwayShotsP1,
                    ISNULL(gss.AwayShotsP2, 0) AS AwayShotsP2,
                    ISNULL(gss.AwayShotsP3, 0) AS AwayShotsP3,
                    ISNULL(gss.AwayShotsOT, 0) AS AwayShotsOT,
                    ISNULL(gss.AwayShotsTotal, 0) AS AwayShotsTotal
                FROM Games g
                LEFT JOIN GameGoals gg ON gg.GameId = g.GameId
                LEFT JOIN GameStatsSnapshots gss ON gss.GameId = g.GameId
                WHERE g.GameId = @GameId
                GROUP BY
                    gss.HomeShotsP1,
                    gss.HomeShotsP2,
                    gss.HomeShotsP3,
                    gss.HomeShotsOT,
                    gss.HomeShotsTotal,
                    gss.AwayShotsP1,
                    gss.AwayShotsP2,
                    gss.AwayShotsP3,
                    gss.AwayShotsOT,
                    gss.AwayShotsTotal;", new { GameId = gameId });

            var goals = (await conn.QueryAsync<GoalSummaryLine>(@"
                SELECT
                    gg.Period,
                    gg.TimeInPeriod,
                    t.Name AS TeamName,
                    p.JerseyNumber AS ScorerNumber,
                    p.FullName AS Scorer,
                    a1.JerseyNumber AS Assist1Number,
                    a1.FullName AS Assist1,
                    a2.JerseyNumber AS Assist2Number,
                    a2.FullName AS Assist2,
                    gg.Strength
                FROM GameGoals gg
                LEFT JOIN Teams t ON t.Id = gg.ScoringTeamId
                LEFT JOIN Players p ON p.PlayerId = gg.ScorerId
                LEFT JOIN Players a1 ON a1.PlayerId = gg.Assist1Id
                LEFT JOIN Players a2 ON a2.PlayerId = gg.Assist2Id
                WHERE gg.GameId = @GameId
                ORDER BY gg.Period, gg.TimeInPeriod;", new { GameId = gameId })).ToList();

            var penalties = (await conn.QueryAsync<PenaltySummaryLine>(@"
                SELECT
                    gp.Period,
                    gp.TimeInPeriod,
                    t.Name AS TeamName,
                    p.JerseyNumber AS PlayerNumber,
                    p.FullName AS PlayerName,
                    gp.Infraction,
                    ISNULL(gp.DurationMinutes, 0) AS DurationMinutes,
                    JSON_VALUE(ge.Details, '$.PenaltyType') AS PenaltyType,
                    gp.Notes
                FROM GamePenalties gp
                LEFT JOIN GameEvents ge ON ge.Id = gp.EventId
                LEFT JOIN Teams t ON t.Id = gp.TeamId
                LEFT JOIN Players p ON p.PlayerId = gp.PlayerId
                WHERE gp.GameId = @GameId
                ORDER BY gp.Period, gp.TimeInPeriod;", new { GameId = gameId })).ToList();

            var goalieJson = await conn.QueryFirstOrDefaultAsync<string?>(@"
                SELECT GoalieSummaryJson
                FROM GameStatsSnapshots
                WHERE GameId = @GameId;", new { GameId = gameId });

            IList<GoalieEventRow>? derivedGoalieEvents = null;
            if (string.IsNullOrWhiteSpace(goalieJson) || goalieJson.Trim() == "[]")
            {
                derivedGoalieEvents = (await conn.QueryAsync<GoalieEventRow>(@"
                    SELECT
                        ge.TeamId,
                        ge.Period,
                        ge.TimeInPeriod,
                        JSON_VALUE(ge.Details, '$.GoalieChangeKind') AS ChangeKind,
                        JSON_VALUE(ge.Details, '$.GoalieOldName') AS OldName,
                        JSON_VALUE(ge.Details, '$.GoalieNewName') AS NewName
                    FROM dbo.GameEvents ge
                    WHERE ge.GameId = @GameId
                      AND ge.EventType = 'Goalie'
                      AND ISJSON(ge.Details) = 1
                    ORDER BY ge.Period, ge.TimeInPeriod, ge.CreatedAt;",
                    new { GameId = gameId })).ToList();
            }

            var coaches = await conn.QueryFirstOrDefaultAsync<CoachRow>(@"
                SELECT
                    h.HeadCoachName AS HomeHeadCoachName,
                    h.AssistantCoach1Name AS HomeAssistantCoach1Name,
                    h.AssistantCoach2Name AS HomeAssistantCoach2Name,
                    h.AssistantCoach3Name AS HomeAssistantCoach3Name,
                    h.AssistantCoach4Name AS HomeAssistantCoach4Name,
                    a.HeadCoachName AS AwayHeadCoachName,
                    a.AssistantCoach1Name AS AwayAssistantCoach1Name,
                    a.AssistantCoach2Name AS AwayAssistantCoach2Name,
                    a.AssistantCoach3Name AS AwayAssistantCoach3Name,
                    a.AssistantCoach4Name AS AwayAssistantCoach4Name
                FROM Games g
                LEFT JOIN Teams h ON h.Id = g.HomeTeamId
                LEFT JOIN Teams a ON a.Id = g.AwayTeamId
                WHERE g.GameId = @GameId;", new { GameId = gameId });

            var roster = (await conn.QueryAsync<RosterRow>(@"
                SELECT
                    r.TeamId,
                    COALESCE(r.JerseyNumber, p.JerseyNumber) AS JerseyNumber,
                    COALESCE(NULLIF(p.FullName, ''), CONCAT(p.FirstName, ' ', p.LastName)) AS PlayerName,
                    r.IsGoalie
                FROM RosterEntries r
                INNER JOIN Players p ON p.PlayerId = r.PlayerId
                WHERE r.TeamId IN @TeamIds
                  AND r.IsActive = 1
                ORDER BY
                    r.TeamId,
                    CASE WHEN COALESCE(r.JerseyNumber, p.JerseyNumber) IS NULL THEN 1 ELSE 0 END,
                    COALESCE(r.JerseyNumber, p.JerseyNumber),
                    COALESCE(p.LastName, ''),
                    COALESCE(p.FirstName, '');", new { TeamIds = new[] { game.HomeTeamId, game.AwayTeamId } })).ToList();

            var officials = (await conn.QueryAsync<OfficialSummaryLine>(@"
                SELECT
                    go.Role,
                    LTRIM(RTRIM(
                        COALESCE(
                            NULLIF(CONCAT(o.FirstName, ' ', o.LastName), ' '),
                            NULLIF(CONCAT(go.FirstName, ' ', go.LastName), ' '),
                            ''
                        )
                    )) AS OfficialName
                FROM GameOfficials go
                LEFT JOIN Officials o ON o.OfficialId = go.OfficialId
                WHERE go.GameId = @GameId
                ORDER BY
                    CASE REPLACE(go.Role, ' ', '')
                        WHEN 'Referee1' THEN 1
                        WHEN 'Referee2' THEN 2
                        WHEN 'Linesman1' THEN 3
                        WHEN 'Linesman2' THEN 4
                        ELSE 99
                    END,
                    go.Role;", new { GameId = gameId })).ToList();

            var suspensionReviews = (await conn.QueryAsync<SuspensionReviewSummaryLine>(@"
                SELECT
                    gp.Period,
                    gp.TimeInPeriod,
                    t.Name AS TeamName,
                    p.JerseyNumber AS PlayerNumber,
                    COALESCE(NULLIF(p.FullName, ''), CONCAT(p.FirstName, ' ', p.LastName)) AS PlayerName,
                    JSON_VALUE(ge.Details, '$.SuspensionBehavior') AS SuspensionBehavior,
                    CASE WHEN JSON_VALUE(ge.Details, '$.RequiresRefereeNotes') = 'true' THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS RequiresRefereeNotes,
                    CASE WHEN JSON_VALUE(ge.Details, '$.ReviewRequired') = 'true' THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS ReviewRequired,
                    gp.Notes
                FROM GamePenalties gp
                INNER JOIN GameEvents ge ON ge.Id = gp.EventId
                LEFT JOIN Teams t ON t.Id = gp.TeamId
                LEFT JOIN Players p ON p.PlayerId = gp.PlayerId
                WHERE gp.GameId = @GameId
                  AND ge.EventType = 'Penalty'
                  AND ISJSON(ge.Details) = 1
                  AND (
                    (
                        NULLIF(LTRIM(RTRIM(JSON_VALUE(ge.Details, '$.SuspensionBehavior'))), '') IS NOT NULL
                        AND LOWER(LTRIM(RTRIM(JSON_VALUE(ge.Details, '$.SuspensionBehavior')))) <> 'none'
                    )
                        OR JSON_VALUE(ge.Details, '$.RequiresRefereeNotes') = 'true'
                        OR JSON_VALUE(ge.Details, '$.ReviewRequired') = 'true'
                        OR NULLIF(LTRIM(RTRIM(gp.Notes)), '') IS NOT NULL
                  )
                ORDER BY gp.Period, gp.TimeInPeriod;", new { GameId = gameId })).ToList();

            return new GameSummaryReport
            {
                GameId = game.GameId,
                LeagueName = game.LeagueName ?? string.Empty,
                HomeLevelName = game.HomeLevelName ?? string.Empty,
                AwayLevelName = game.AwayLevelName ?? string.Empty,
                SeasonName = game.SeasonName ?? string.Empty,
                GameDateTime = game.GameDateTime,
                Status = game.Status ?? string.Empty,
                HomeTeamName = game.HomeTeamName ?? "Home",
                AwayTeamName = game.AwayTeamName ?? "Visitor",
                TeamType = ResolveTeamType(game.HomeTeamType, game.AwayTeamType),
                HomeTeamMascot = ResolveMascot(game.HomeTeamMascot, game.HomeOrgMascot),
                AwayTeamMascot = ResolveMascot(game.AwayTeamMascot, game.AwayOrgMascot),
                ArenaName = game.ArenaName ?? string.Empty,
                RinkName = game.RinkName ?? string.Empty,
                HomeHeadCoachName = coaches?.HomeHeadCoachName ?? string.Empty,
                HomeAssistantCoach1Name = coaches?.HomeAssistantCoach1Name ?? string.Empty,
                HomeAssistantCoach2Name = coaches?.HomeAssistantCoach2Name ?? string.Empty,
                HomeAssistantCoach3Name = coaches?.HomeAssistantCoach3Name ?? string.Empty,
                HomeAssistantCoach4Name = coaches?.HomeAssistantCoach4Name ?? string.Empty,
                AwayHeadCoachName = coaches?.AwayHeadCoachName ?? string.Empty,
                AwayAssistantCoach1Name = coaches?.AwayAssistantCoach1Name ?? string.Empty,
                AwayAssistantCoach2Name = coaches?.AwayAssistantCoach2Name ?? string.Empty,
                AwayAssistantCoach3Name = coaches?.AwayAssistantCoach3Name ?? string.Empty,
                AwayAssistantCoach4Name = coaches?.AwayAssistantCoach4Name ?? string.Empty,
                HomeGoals = totals?.HomeGoals ?? 0,
                AwayGoals = totals?.AwayGoals ?? 0,
                HomeShots = new PeriodShots
                {
                    P1 = totals?.HomeShotsP1 ?? 0,
                    P2 = totals?.HomeShotsP2 ?? 0,
                    P3 = totals?.HomeShotsP3 ?? 0,
                    OT = totals?.HomeShotsOT ?? 0,
                    Total = totals?.HomeShotsTotal ?? 0
                },
                AwayShots = new PeriodShots
                {
                    P1 = totals?.AwayShotsP1 ?? 0,
                    P2 = totals?.AwayShotsP2 ?? 0,
                    P3 = totals?.AwayShotsP3 ?? 0,
                    OT = totals?.AwayShotsOT ?? 0,
                    Total = totals?.AwayShotsTotal ?? 0
                },
                Goals = goals,
                Penalties = penalties,
                Goalies = string.IsNullOrWhiteSpace(goalieJson) || goalieJson.Trim() == "[]"
                    ? DeriveGoaliesFromEvents(
                        derivedGoalieEvents ?? new List<GoalieEventRow>(),
                        game.HomeTeamId, game.HomeTeamName ?? "Home",
                        game.AwayTeamId, game.AwayTeamName ?? "Visitor",
                        totals)
                    : ParseGoalieSummary(goalieJson),
                HomeRoster = roster.Where(x => x.TeamId == game.HomeTeamId)
                    .Select(x => new RosterPlayerSummaryLine
                    {
                        TeamId = x.TeamId,
                        JerseyNumber = x.JerseyNumber,
                        PlayerName = x.PlayerName,
                        IsGoalie = x.IsGoalie
                    }).ToList(),
                AwayRoster = roster.Where(x => x.TeamId == game.AwayTeamId)
                    .Select(x => new RosterPlayerSummaryLine
                    {
                        TeamId = x.TeamId,
                        JerseyNumber = x.JerseyNumber,
                        PlayerName = x.PlayerName,
                        IsGoalie = x.IsGoalie
                    }).ToList(),
                Officials = officials,
                SuspensionReviews = suspensionReviews
            };
        }

        public byte[] BuildPdf(GameSummaryReport report)
        {
            byte[]? logoBytes = TryReadLogoBytes();
            var generated = Document.Create(container =>
            {
                container.Page(page =>
                {
                    page.Margin(24);
                    page.Size(PageSizes.A4);
                    page.DefaultTextStyle(x => x.FontSize(10));

                    page.Header().Column(col =>
                    {
                        col.Item().Row(row =>
                        {
                            if (logoBytes != null)
                            {
                                row.ConstantItem(38).Height(38).Image(logoBytes);
                            }

                            row.RelativeItem().PaddingLeft(8).Column(header =>
                            {
                                header.Item().Text(title =>
                                {
                                    title.DefaultTextStyle(x => x.FontSize(16));
                                    title.Span("Tip").Bold().Italic().FontColor("#0B1424");
                                    title.Span("In").Bold().Italic().FontColor("#FF7B00");
                                    title.Span(" Scoring Game Manager").Bold().FontColor("#7A8491");
                                });
                                header.Item().Text("Game Summary Report").FontColor(Colors.Grey.Darken1);
                            });
                        });

                        col.Item().PaddingTop(6).LineHorizontal(1).LineColor(Colors.Grey.Lighten1);
                    });

                    page.Content().Column(col =>
                    {
                        col.Spacing(8);

                        col.Item().Text("Game Summary").Bold().FontSize(11);
                        col.Item().Text(BuildFinalScoreLine(report)).Bold().FontSize(12);
                        if (!string.IsNullOrWhiteSpace(report.LeagueName))
                        {
                            col.Item().Text($"League: {report.LeagueName}");
                        }
                        if (!string.IsNullOrWhiteSpace(report.TeamType))
                        {
                            col.Item().Text($"Team Type: {report.TeamType}");
                        }
                        col.Item().Text($"Team Level: {FormatLevelLabel(report.HomeLevelName, report.AwayLevelName)}");
                        col.Item().Text($"Date and Time: {report.GameDateTime.ToLocalTime():yyyy-MM-dd hh:mm tt}");
                        col.Item().Text($"Venue: {BuildVenue(report.ArenaName, report.RinkName)}");
                        if (!string.IsNullOrWhiteSpace(report.SeasonName))
                        {
                            col.Item().Text($"Season: {report.SeasonName}");
                        }

                        col.Item().PaddingTop(6).Text("Goal Breakdown").Bold().FontSize(11);
                        col.Item().Text($"Game Score: {BuildFinalScoreLine(report).Replace("Final: ", string.Empty, StringComparison.Ordinal)}").Bold();
                        col.Item().Text("Goals:").SemiBold();
                        if (report.Goals.Count == 0)
                        {
                            col.Item().Text("No goals recorded.");
                        }
                        else
                        {
                            foreach (var goal in report.Goals)
                            {
                                var strengthText = ExpandStrength(goal.Strength);
                                col.Item().Text($"Period {goal.Period} {goal.TimeInPeriod} - {goal.TeamName}: {FormatNumberAndName(goal.ScorerNumber, goal.Scorer)}{BuildAssistText(goal.Assist1Number, goal.Assist1, goal.Assist2Number, goal.Assist2)} - {strengthText}");
                            }
                        }

                        col.Item().PaddingTop(6).Text("Team Shots Breakdown").Bold().FontSize(11);
                        col.Item().Element(c => DrawShotsTable(c, report));
                        col.Item().PaddingTop(4).Text("Goalie Shots By Period").Bold();
                        if (report.Goalies.Count == 0)
                        {
                            col.Item().Text("No goalie shot breakdown recorded.");
                        }
                        else
                        {
                            col.Item().Element(c => DrawGoalieTable(c, report.Goalies));
                        }

                        col.Item().PaddingTop(6).Text("Penalties").Bold().FontSize(11);
                        if (report.Penalties.Count == 0)
                        {
                            col.Item().Text("No penalties recorded.");
                        }
                        else
                        {
                            foreach (var penalty in report.Penalties)
                            {
                                col.Item().Text($"Period {penalty.Period} {penalty.TimeInPeriod} - {penalty.TeamName}: {FormatNumberAndName(penalty.PlayerNumber, penalty.PlayerName)} ({BuildPenaltyDisplayText(penalty)})");
                                if (!string.IsNullOrWhiteSpace(penalty.Notes))
                                {
                                    col.Item().Text($"Referee Notes: {penalty.Notes.Trim()}");
                                }
                            }
                        }

                        col.Item().PaddingTop(6).Text("Player Rosters").Bold().FontSize(11);
                        col.Item().Row(rosterRow =>
                        {
                            rosterRow.Spacing(14);

                            rosterRow.RelativeItem().Column(homeCol =>
                            {
                                homeCol.Item().Text($"{BuildTeamDisplayName(report.HomeTeamName, report.HomeTeamMascot)} (Home)").Bold();
                                homeCol.Item().Text($"Coaches: {FormatCoachList(report.HomeHeadCoachName, report.HomeAssistantCoach1Name, report.HomeAssistantCoach2Name, report.HomeAssistantCoach3Name, report.HomeAssistantCoach4Name)}");

                                if (report.HomeRoster.Count == 0)
                                {
                                    homeCol.Item().Text("No active roster players listed.");
                                }
                                else
                                {
                                    foreach (var player in report.HomeRoster)
                                    {
                                        homeCol.Item().Text($"{FormatNumberAndName(player.JerseyNumber, player.PlayerName)}{(player.IsGoalie ? " (Goalie)" : string.Empty)}");
                                    }
                                }
                            });

                            rosterRow.RelativeItem().Column(awayCol =>
                            {
                                awayCol.Item().Text($"{BuildTeamDisplayName(report.AwayTeamName, report.AwayTeamMascot)} (Visitor)").Bold();
                                awayCol.Item().Text($"Coaches: {FormatCoachList(report.AwayHeadCoachName, report.AwayAssistantCoach1Name, report.AwayAssistantCoach2Name, report.AwayAssistantCoach3Name, report.AwayAssistantCoach4Name)}");

                                if (report.AwayRoster.Count == 0)
                                {
                                    awayCol.Item().Text("No active roster players listed.");
                                }
                                else
                                {
                                    foreach (var player in report.AwayRoster)
                                    {
                                        awayCol.Item().Text($"{FormatNumberAndName(player.JerseyNumber, player.PlayerName)}{(player.IsGoalie ? " (Goalie)" : string.Empty)}");
                                    }
                                }
                            });
                        });

                        col.Item().PaddingTop(6).Text("Game Officials and Infraction Review").Bold().FontSize(11);
                        col.Item().Text("Game Officials Names").Bold();
                        if (report.Officials.Count == 0)
                        {
                            col.Item().Text("No officials assigned.");
                        }
                        else
                        {
                            foreach (var official in report.Officials)
                            {
                                col.Item().Text($"{FormatOfficialRole(official.Role)}: {official.OfficialName}");
                            }
                        }

                        col.Item().PaddingTop(2).Text("Infraction Review Flags and Notes").Bold();
                        var renderedSuspensionLines = 0;
                        if (report.SuspensionReviews.Count == 0)
                        {
                            col.Item().Text("No infraction review flags or notes.");
                        }
                        else
                        {
                            foreach (var item in report.SuspensionReviews)
                            {
                                var officialsNotes = string.IsNullOrWhiteSpace(item.Notes)
                                    ? "No officials notes provided"
                                    : item.Notes.Trim();

                                col.Item().Text($"Period {item.Period} {item.TimeInPeriod} - {item.TeamName}: {FormatNumberAndName(item.PlayerNumber, item.PlayerName)} : Officials notes - {officialsNotes}");
                                renderedSuspensionLines++;
                            }

                            if (renderedSuspensionLines == 0)
                            {
                                col.Item().Text("No infraction review flags or notes.");
                            }
                        }
                    });

                    page.Footer().Row(row =>
                    {
                        row.RelativeItem().Text("© 2026 TipIn Scoring. All rights reserved.").FontSize(8).FontColor(Colors.Grey.Darken1);
                        row.RelativeItem().AlignRight().Text($"Game ID: {report.GameId}").FontSize(8).FontColor(Colors.Grey.Darken1);
                    });
                });
            }).GeneratePdf();

            return generated;
        }

        public string BuildEmailBody(GameSummaryReport report)
        {
            var builder = new StringBuilder();
            builder.AppendLine("TipIn Scoring Game Manager - Finalized Game");
            builder.AppendLine();
            builder.AppendLine(BuildFinalScoreLine(report));
            if (!string.IsNullOrWhiteSpace(report.LeagueName))
            {
                builder.AppendLine($"League: {report.LeagueName}");
            }
            if (!string.IsNullOrWhiteSpace(report.TeamType))
            {
                builder.AppendLine($"Team Type: {report.TeamType}");
            }
            builder.AppendLine($"Team Level: {FormatLevelLabel(report.HomeLevelName, report.AwayLevelName)}");
            builder.AppendLine($"Date and Time: {report.GameDateTime.ToLocalTime():yyyy-MM-dd hh:mm tt}");
            builder.AppendLine($"Venue: {BuildVenue(report.ArenaName, report.RinkName)}");
            if (!string.IsNullOrWhiteSpace(report.SeasonName))
            {
                builder.AppendLine($"Season: {report.SeasonName}");
            }

            builder.AppendLine();
            builder.AppendLine("Shots By Period:");
            builder.AppendLine($"- {report.HomeTeamName}: Period 1 - {report.HomeShots.P1}, Period 2 - {report.HomeShots.P2}, Period 3 - {report.HomeShots.P3}, Overtime - {report.HomeShots.OT}, Total - {report.HomeShots.Total}");
            builder.AppendLine($"- {report.AwayTeamName}: Period 1 - {report.AwayShots.P1}, Period 2 - {report.AwayShots.P2}, Period 3 - {report.AwayShots.P3}, Overtime - {report.AwayShots.OT}, Total - {report.AwayShots.Total}");

            builder.AppendLine();
            builder.AppendLine("Goal Summary:");
            if (report.Goals.Count == 0)
            {
                builder.AppendLine("- No goals recorded.");
            }
            else
            {
                foreach (var goal in report.Goals)
                {
                    builder.AppendLine($"- Period {goal.Period} - {goal.TimeInPeriod}: {goal.TeamName} - {FormatNumberAndName(goal.ScorerNumber, goal.Scorer)}{BuildAssistText(goal.Assist1Number, goal.Assist1, goal.Assist2Number, goal.Assist2)} - {ExpandStrength(goal.Strength)}");
                }
            }

            builder.AppendLine();
            builder.AppendLine("Goalie Shots By Period:");
            if (report.Goalies.Count == 0)
            {
                builder.AppendLine("- No goalie shot breakdown recorded.");
            }
            else
            {
                foreach (var goalie in report.Goalies)
                {
                    builder.AppendLine($"- {goalie.TeamName} / {goalie.GoalieName}: Period 1 - {goalie.P1}, Period 2 - {goalie.P2}, Period 3 - {goalie.P3}, Overtime - {goalie.OT}, Total - {goalie.Total}");
                }
            }

            builder.AppendLine();
            builder.AppendLine("Penalties:");
            if (report.Penalties.Count == 0)
            {
                builder.AppendLine("- No penalties recorded.");
            }
            else
            {
                foreach (var penalty in report.Penalties)
                {
                    builder.AppendLine($"- Period {penalty.Period} - {penalty.TimeInPeriod}: {penalty.TeamName} - {FormatNumberAndName(penalty.PlayerNumber, penalty.PlayerName)} ({BuildPenaltyDisplayText(penalty)})");
                    if (!string.IsNullOrWhiteSpace(penalty.Notes))
                    {
                        builder.AppendLine($"  Referee Notes: {penalty.Notes.Trim()}");
                    }
                }
            }

            builder.AppendLine();
            builder.AppendLine("A formatted PDF scoresheet is attached.");
            return builder.ToString();
        }

        private static string BuildAssistText(int? assist1Number, string? assist1, int? assist2Number, string? assist2)
        {
            var assists = new List<string>();
            if (!string.IsNullOrWhiteSpace(assist1)) assists.Add(FormatNumberAndName(assist1Number, assist1));
            if (!string.IsNullOrWhiteSpace(assist2)) assists.Add(FormatNumberAndName(assist2Number, assist2));

            return assists.Count == 0 ? string.Empty : $" (Assist {string.Join(", ", assists)})";
        }

        private static string FormatNumberAndName(int? number, string? name)
        {
            var safeName = string.IsNullOrWhiteSpace(name) ? "Unknown" : name.Trim();
            return number.HasValue ? $"#{number.Value} {safeName}" : safeName;
        }

        private static string FormatLevelLabel(string? homeLevel, string? awayLevel)
        {
            var h = (homeLevel ?? string.Empty).Trim();
            var a = (awayLevel ?? string.Empty).Trim();

            if (!string.IsNullOrWhiteSpace(h) && string.Equals(h, a, StringComparison.OrdinalIgnoreCase))
            {
                return h;
            }

            if (!string.IsNullOrWhiteSpace(h) && !string.IsNullOrWhiteSpace(a))
            {
                return $"Home {h} / Visitor {a}";
            }

            return string.IsNullOrWhiteSpace(h) ? (string.IsNullOrWhiteSpace(a) ? "N/A" : a) : h;
        }

        private static string BuildTeamDisplayName(string? teamName, string? teamMascot)
        {
            var name = (teamName ?? string.Empty).Trim();
            var mascot = (teamMascot ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(name))
            {
                return string.IsNullOrWhiteSpace(mascot) ? "Unknown Team" : mascot;
            }

            return string.IsNullOrWhiteSpace(mascot) ? name : $"{name} {mascot}";
        }

        private static string BuildFinalScoreLine(GameSummaryReport report)
        {
            var away = BuildTeamDisplayName(report.AwayTeamName, report.AwayTeamMascot);
            var home = BuildTeamDisplayName(report.HomeTeamName, report.HomeTeamMascot);
            return $"Final: {away} (Away) {report.AwayGoals} - {report.HomeGoals} {home} (Home)";
        }

        private static string ResolveMascot(string? teamMascot, string? orgMascot)
        {
            if (!string.IsNullOrWhiteSpace(teamMascot))
            {
                return teamMascot.Trim();
            }

            return string.IsNullOrWhiteSpace(orgMascot) ? string.Empty : orgMascot.Trim();
        }

        private static string ResolveTeamType(string? homeTeamType, string? awayTeamType)
        {
            if (!string.IsNullOrWhiteSpace(homeTeamType))
            {
                return homeTeamType.Trim();
            }

            return string.IsNullOrWhiteSpace(awayTeamType) ? string.Empty : awayTeamType.Trim();
        }

        private static string BuildVenue(string? arenaName, string? rinkName)
        {
            var arena = (arenaName ?? string.Empty).Trim();
            var rink = (rinkName ?? string.Empty).Trim();

            if (!string.IsNullOrWhiteSpace(arena) && !string.IsNullOrWhiteSpace(rink))
            {
                return $"{arena} - {rink}";
            }

            if (!string.IsNullOrWhiteSpace(arena))
            {
                return arena;
            }

            if (!string.IsNullOrWhiteSpace(rink))
            {
                return rink;
            }

            return "N/A";
        }

        private static string FormatCoachList(params string[] coaches)
        {
            var filtered = coaches
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim())
                .ToList();

            return filtered.Count == 0 ? "None listed" : string.Join(", ", filtered);
        }

        private static string FormatOfficialRole(string role)
        {
            var compact = (role ?? string.Empty).Replace(" ", string.Empty, StringComparison.Ordinal);
            return compact switch
            {
                "Referee1" => "Referee 1",
                "Referee2" => "Referee 2",
                "Linesman1" => "Linesman 1",
                "Linesman2" => "Linesman 2",
                _ => string.IsNullOrWhiteSpace(role) ? "Official" : role
            };
        }

        private static string ExpandStrength(string strength)
        {
            var normalized = (strength ?? string.Empty).Trim().ToUpperInvariant();
            return normalized switch
            {
                "EV" => "Even Strength",
                "PP" => "Power Play",
                "SH" => "Short-Handed",
                _ => string.IsNullOrWhiteSpace(strength) ? "Even Strength" : strength
            };
        }

        private static string BuildPenaltyDisplayText(PenaltySummaryLine penalty)
        {
            var infraction = string.IsNullOrWhiteSpace(penalty.Infraction)
                ? "Penalty"
                : penalty.Infraction.Trim();

            if (IsDisqualificationPenalty(penalty))
            {
                return $"{infraction}, DQ";
            }

            return $"{infraction}, {penalty.DurationMinutes} Min";
        }

        private static bool IsDisqualificationPenalty(PenaltySummaryLine penalty)
        {
            var type = (penalty.PenaltyType ?? string.Empty).Trim().ToLowerInvariant();
            var infraction = (penalty.Infraction ?? string.Empty).Trim().ToLowerInvariant();

            if (type == "disqualification" || type == "dq" || type.Contains("ejection") || type.Contains("dq"))
            {
                return true;
            }

            return infraction == "disqualification" || infraction == "dq";
        }

        private static List<GoalieSummaryLine> DeriveGoaliesFromEvents(
            IList<GoalieEventRow> events,
            Guid homeTeamId, string homeTeamName,
            Guid awayTeamId, string awayTeamName,
            ScoreAndShotRow? shots)
        {
            var result = new List<GoalieSummaryLine>();

            var teamPairs = new[]
            {
                (teamId: homeTeamId, teamName: homeTeamName,
                 sp1: shots?.AwayShotsP1 ?? 0, sp2: shots?.AwayShotsP2 ?? 0,
                 sp3: shots?.AwayShotsP3 ?? 0, sot: shots?.AwayShotsOT ?? 0),
                (teamId: awayTeamId, teamName: awayTeamName,
                 sp1: shots?.HomeShotsP1 ?? 0, sp2: shots?.HomeShotsP2 ?? 0,
                 sp3: shots?.HomeShotsP3 ?? 0, sot: shots?.HomeShotsOT ?? 0),
            };

            foreach (var team in teamPairs)
            {
                var teamEvents = events
                    .Where(e => e.TeamId == team.teamId)
                    .OrderBy(e => e.Period)
                    .ThenBy(e => e.TimeInPeriod)
                    .ToList();

                // Determine starting goalie from first change event's old name
                string? startingGoalie = teamEvents
                    .Where(e => !string.IsNullOrWhiteSpace(e.OldName))
                    .Select(e => e.OldName!.Trim())
                    .FirstOrDefault();

                if (startingGoalie == null && teamEvents.Count == 0)
                    continue;

                // Replay events to find who was in net at the START and END of each period
                var periodGoalies = new Dictionary<int, (string? start, string? end)>();
                string? active = startingGoalie;

                // Mark starting goalie as covering period 1 start
                for (var p = 1; p <= 4; p++)
                    periodGoalies[p] = (active, active);

                foreach (var ev in teamEvents)
                {
                    var kind = (ev.ChangeKind ?? "change").Trim().ToLowerInvariant();
                    var newName = string.IsNullOrWhiteSpace(ev.NewName) ? null : ev.NewName.Trim();
                    var oldName = string.IsNullOrWhiteSpace(ev.OldName) ? null : ev.OldName.Trim();

                    // Ensure starting goalie is captured from this event if not already set
                    if (active == null && oldName != null)
                    {
                        active = oldName;
                        for (var p = 1; p < ev.Period; p++)
                            periodGoalies[p] = (active, active);
                        if (periodGoalies.TryGetValue(ev.Period, out var cur))
                            periodGoalies[ev.Period] = (active, cur.end);
                    }

                    if (kind == "change")
                    {
                        // Record that active goalie was in net at START of this period
                        if (periodGoalies.TryGetValue(ev.Period, out var before))
                            periodGoalies[ev.Period] = (before.start ?? active, newName);
                        active = newName;
                        // New goalie covers all subsequent periods (until next event overrides)
                        for (var p = ev.Period + 1; p <= 4; p++)
                            periodGoalies[p] = (active, active);
                    }
                    else if (kind == "pulled")
                    {
                        if (periodGoalies.TryGetValue(ev.Period, out var before))
                            periodGoalies[ev.Period] = (before.start ?? active, null);
                        active = null;
                    }
                    else if (kind == "returned")
                    {
                        var returnedName = newName ?? oldName ?? active;
                        active = returnedName;
                        if (periodGoalies.TryGetValue(ev.Period, out var before))
                            periodGoalies[ev.Period] = (before.start, active);
                        for (var p = ev.Period + 1; p <= 4; p++)
                            periodGoalies[p] = (active, active);
                    }
                }

                // Gather all unique goalies who played for this team
                var allGoalies = periodGoalies.Values
                    .SelectMany(v => new[] { v.start, v.end })
                    .Where(n => !string.IsNullOrWhiteSpace(n))
                    .Select(n => n!)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                if (allGoalies.Count == 0)
                    continue;

                // Attribute shots per period: if start==end goalie → full shots; otherwise split 50/50
                var goalieShots = allGoalies.ToDictionary(
                    g => g,
                    _ => new int[4], // indexes 0-3 = P1,P2,P3,OT
                    StringComparer.OrdinalIgnoreCase);

                var periodShotArrays = new[] { team.sp1, team.sp2, team.sp3, team.sot };
                for (var pidx = 0; pidx < 4; pidx++)
                {
                    var period = pidx + 1;
                    var totalShots = periodShotArrays[pidx];
                    if (!periodGoalies.TryGetValue(period, out var pg)) continue;

                    var startG = string.IsNullOrWhiteSpace(pg.start) ? null : pg.start;
                    var endG = string.IsNullOrWhiteSpace(pg.end) ? null : pg.end;

                    if (startG != null && string.Equals(startG, endG, StringComparison.OrdinalIgnoreCase))
                    {
                        // One goalie for the whole period
                        if (goalieShots.TryGetValue(startG, out var arr))
                            arr[pidx] += totalShots;
                    }
                    else
                    {
                        // Change mid-period: split evenly
                        var half1 = totalShots / 2;
                        var half2 = totalShots - half1;
                        if (startG != null && goalieShots.TryGetValue(startG, out var arrS))
                            arrS[pidx] += half1;
                        if (endG != null && goalieShots.TryGetValue(endG, out var arrE))
                            arrE[pidx] += half2;
                    }
                }

                foreach (var goalieName in allGoalies)
                {
                    if (!goalieShots.TryGetValue(goalieName, out var gs)) continue;
                    var total = gs[0] + gs[1] + gs[2] + gs[3];
                    result.Add(new GoalieSummaryLine
                    {
                        TeamName = team.teamName,
                        GoalieName = goalieName,
                        P1 = gs[0],
                        P2 = gs[1],
                        P3 = gs[2],
                        OT = gs[3],
                        Total = total,
                    });
                }
            }

            return result;
        }

        private static List<GoalieSummaryLine> ParseGoalieSummary(string? goalieJson)
        {
            var rows = new List<GoalieSummaryLine>();
            if (string.IsNullOrWhiteSpace(goalieJson))
            {
                return rows;
            }

            try
            {
                using var doc = JsonDocument.Parse(goalieJson);
                if (doc.RootElement.ValueKind != JsonValueKind.Array)
                {
                    return rows;
                }

                foreach (var item in doc.RootElement.EnumerateArray())
                {
                    var teamName = ReadString(item, "goalieTeamName") ?? ReadString(item, "GoalieTeamName") ?? string.Empty;
                    var goalieName = ReadString(item, "goalieName") ?? ReadString(item, "GoalieName") ?? string.Empty;
                    var p1 = ReadInt(item, "p1");
                    var p2 = ReadInt(item, "p2");
                    var p3 = ReadInt(item, "p3");
                    var ot = ReadInt(item, "ot");

                    var byPeriod = GetProperty(item, "shotsAgainstByPeriod") ?? GetProperty(item, "ShotsAgainstByPeriod");
                    if (byPeriod.HasValue && byPeriod.Value.ValueKind == JsonValueKind.Object)
                    {
                        p1 = ReadInt(byPeriod.Value, "p1");
                        p2 = ReadInt(byPeriod.Value, "p2");
                        p3 = ReadInt(byPeriod.Value, "p3");
                        ot = ReadInt(byPeriod.Value, "ot");
                    }

                    var total = ReadInt(item, "shotsAgainst");
                    if (total <= 0)
                    {
                        total = p1 + p2 + p3 + ot;
                    }

                    rows.Add(new GoalieSummaryLine
                    {
                        TeamName = teamName,
                        GoalieName = goalieName,
                        P1 = p1,
                        P2 = p2,
                        P3 = p3,
                        OT = ot,
                        Total = total,
                        TimeInNetSeconds = ReadInt(item, "timeInNetSeconds"),
                        GoalsAgainstEstimate = ReadDecimal(item, "goalsAgainstEstimate"),
                        SavesEstimate = ReadDecimal(item, "savesEstimate"),
                        SavePctEstimate = ReadDecimal(item, "savePctEstimate")
                    });
                }
            }
            catch
            {
                // Ignore malformed JSON and return empty list.
            }

            return rows;
        }

        private static int ReadInt(JsonElement element, string property)
        {
            var target = GetProperty(element, property);
            if (!target.HasValue)
            {
                return 0;
            }

            var value = target.Value;
            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number))
            {
                return number;
            }

            if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
            {
                return parsed;
            }

            return 0;
        }

        private static decimal ReadDecimal(JsonElement element, string property)
        {
            var target = GetProperty(element, property);
            if (!target.HasValue)
            {
                return 0m;
            }

            var value = target.Value;
            if (value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var number))
            {
                return number;
            }

            if (value.ValueKind == JsonValueKind.String && decimal.TryParse(value.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed))
            {
                return parsed;
            }

            return 0m;
        }

        private static string? ReadString(JsonElement element, string property)
        {
            var target = GetProperty(element, property);
            if (!target.HasValue)
            {
                return null;
            }

            return target.Value.ValueKind == JsonValueKind.String ? target.Value.GetString() : null;
        }

        private static JsonElement? GetProperty(JsonElement element, string propertyName)
        {
            foreach (var prop in element.EnumerateObject())
            {
                if (string.Equals(prop.Name, propertyName, StringComparison.OrdinalIgnoreCase))
                {
                    return prop.Value;
                }
            }

            return null;
        }

        private static byte[]? TryReadLogoBytes()
        {
            try
            {
                // Primary location: API Assets folder (always ship logo here)
                var primaryPath = Path.Combine(AppContext.BaseDirectory, "Assets", "TipIn NoBG.png");

                if (File.Exists(primaryPath))
                    return File.ReadAllBytes(primaryPath);

                // Fallback: current working directory (dev environments)
                var fallbackPath = Path.Combine(Directory.GetCurrentDirectory(), "Assets", "TipIn NoBG.png");

                if (File.Exists(fallbackPath))
                    return File.ReadAllBytes(fallbackPath);

                // Optional: log missing file for debugging
                Console.WriteLine($"[GameSummaryReport] Logo not found. Checked:\n - {primaryPath}\n - {fallbackPath}");

                return null;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[GameSummaryReport] Error reading logo: {ex.Message}");
                return null;
            }
        }


        private static void DrawShotsTable(IContainer container, GameSummaryReport report)
        {
            container.Table(table =>
            {
                table.ColumnsDefinition(columns =>
                {
                    columns.RelativeColumn(2);
                    columns.RelativeColumn();
                    columns.RelativeColumn();
                    columns.RelativeColumn();
                    columns.RelativeColumn();
                    columns.RelativeColumn();
                });

                table.Header(header =>
                {
                    header.Cell().Element(CellStyleHeader).Text("Team");
                    header.Cell().Element(CellStyleHeader).AlignCenter().Text("Period 1");
                    header.Cell().Element(CellStyleHeader).AlignCenter().Text("Period 2");
                    header.Cell().Element(CellStyleHeader).AlignCenter().Text("Period 3");
                    header.Cell().Element(CellStyleHeader).AlignCenter().Text("Overtime");
                    header.Cell().Element(CellStyleHeader).AlignCenter().Text("Total");
                });

                DrawShotsRow(table, report.HomeTeamName, report.HomeShots);
                DrawShotsRow(table, report.AwayTeamName, report.AwayShots);
            });
        }

        private static void DrawGoalieTable(IContainer container, List<GoalieSummaryLine> goalies)
        {
            container.Table(table =>
            {
                table.ColumnsDefinition(columns =>
                {
                    columns.RelativeColumn(2);
                    columns.RelativeColumn(2);
                    columns.RelativeColumn();
                    columns.RelativeColumn();
                    columns.RelativeColumn();
                    columns.RelativeColumn();
                    columns.RelativeColumn();
                });

                table.Header(header =>
                {
                    header.Cell().Element(CellStyleHeader).Text("Team");
                    header.Cell().Element(CellStyleHeader).Text("Goalie");
                    header.Cell().Element(CellStyleHeader).AlignCenter().Text("Period 1");
                    header.Cell().Element(CellStyleHeader).AlignCenter().Text("Period 2");
                    header.Cell().Element(CellStyleHeader).AlignCenter().Text("Period 3");
                    header.Cell().Element(CellStyleHeader).AlignCenter().Text("Overtime");
                    header.Cell().Element(CellStyleHeader).AlignCenter().Text("Total");
                });

                foreach (var goalie in goalies)
                {
                    table.Cell().Element(CellStyleData).Text(goalie.TeamName);
                    table.Cell().Element(CellStyleData).Text(goalie.GoalieName);
                    table.Cell().Element(CellStyleData).AlignCenter().Text(goalie.P1.ToString(CultureInfo.InvariantCulture));
                    table.Cell().Element(CellStyleData).AlignCenter().Text(goalie.P2.ToString(CultureInfo.InvariantCulture));
                    table.Cell().Element(CellStyleData).AlignCenter().Text(goalie.P3.ToString(CultureInfo.InvariantCulture));
                    table.Cell().Element(CellStyleData).AlignCenter().Text(goalie.OT.ToString(CultureInfo.InvariantCulture));
                    table.Cell().Element(CellStyleData).AlignCenter().Text(goalie.Total.ToString(CultureInfo.InvariantCulture));
                }
            });
        }

        private static void DrawShotsRow(TableDescriptor table, string teamName, PeriodShots shots)
        {
            table.Cell().Element(CellStyleData).Text(teamName.ToUpperInvariant());
            table.Cell().Element(CellStyleData).AlignCenter().Text(shots.P1.ToString(CultureInfo.InvariantCulture));
            table.Cell().Element(CellStyleData).AlignCenter().Text(shots.P2.ToString(CultureInfo.InvariantCulture));
            table.Cell().Element(CellStyleData).AlignCenter().Text(shots.P3.ToString(CultureInfo.InvariantCulture));
            table.Cell().Element(CellStyleData).AlignCenter().Text(shots.OT.ToString(CultureInfo.InvariantCulture));
            table.Cell().Element(CellStyleData).AlignCenter().Text(shots.Total.ToString(CultureInfo.InvariantCulture));
        }

        private static IContainer CellStyleHeader(IContainer container)
        {
            return container
                .PaddingVertical(4)
                .PaddingHorizontal(4)
                .BorderBottom(1)
                .BorderColor(Colors.Grey.Lighten1)
                .DefaultTextStyle(x => x.SemiBold().FontSize(9));
        }

        private static IContainer CellStyleData(IContainer container)
        {
            return container
                .PaddingVertical(3)
                .PaddingHorizontal(4)
                .BorderBottom(1)
                .BorderColor(Colors.Grey.Lighten3)
                .DefaultTextStyle(x => x.FontSize(9));
        }

        private sealed class GameRow
        {
            public Guid GameId { get; set; }
            public DateTime GameDateTime { get; set; }
            public string? Status { get; set; }
            public string? ArenaName { get; set; }
            public string? RinkName { get; set; }
            public Guid HomeTeamId { get; set; }
            public Guid AwayTeamId { get; set; }
            public string? HomeTeamName { get; set; }
            public string? AwayTeamName { get; set; }
            public string? HomeTeamType { get; set; }
            public string? AwayTeamType { get; set; }
            public string? HomeTeamMascot { get; set; }
            public string? AwayTeamMascot { get; set; }
            public string? HomeOrgMascot { get; set; }
            public string? AwayOrgMascot { get; set; }
            public string? HomeLevelName { get; set; }
            public string? AwayLevelName { get; set; }
            public string? LeagueName { get; set; }
            public string? SeasonName { get; set; }
        }

        private sealed class CoachRow
        {
            public string? HomeHeadCoachName { get; set; }
            public string? HomeAssistantCoach1Name { get; set; }
            public string? HomeAssistantCoach2Name { get; set; }
            public string? HomeAssistantCoach3Name { get; set; }
            public string? HomeAssistantCoach4Name { get; set; }
            public string? AwayHeadCoachName { get; set; }
            public string? AwayAssistantCoach1Name { get; set; }
            public string? AwayAssistantCoach2Name { get; set; }
            public string? AwayAssistantCoach3Name { get; set; }
            public string? AwayAssistantCoach4Name { get; set; }
        }

        private sealed class RosterRow
        {
            public Guid TeamId { get; set; }
            public int? JerseyNumber { get; set; }
            public string PlayerName { get; set; } = string.Empty;
            public bool IsGoalie { get; set; }
        }

        private sealed class GoalieEventRow
        {
            public Guid TeamId { get; set; }
            public int Period { get; set; }
            public string TimeInPeriod { get; set; } = string.Empty;
            public string? ChangeKind { get; set; }
            public string? OldName { get; set; }
            public string? NewName { get; set; }
        }

        private sealed class ScoreAndShotRow
        {
            public int HomeGoals { get; set; }
            public int AwayGoals { get; set; }
            public int HomeShotsP1 { get; set; }
            public int HomeShotsP2 { get; set; }
            public int HomeShotsP3 { get; set; }
            public int HomeShotsOT { get; set; }
            public int HomeShotsTotal { get; set; }
            public int AwayShotsP1 { get; set; }
            public int AwayShotsP2 { get; set; }
            public int AwayShotsP3 { get; set; }
            public int AwayShotsOT { get; set; }
            public int AwayShotsTotal { get; set; }
        }
    }
}
