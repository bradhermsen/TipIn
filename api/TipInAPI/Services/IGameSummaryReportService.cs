using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace TipInAPI.Services
{
    public class GameSummaryReport
    {
        public Guid GameId { get; set; }
        public string LeagueName { get; set; } = string.Empty;
        public string HomeLevelName { get; set; } = string.Empty;
        public string AwayLevelName { get; set; } = string.Empty;
        public string SeasonName { get; set; } = string.Empty;
        public DateTime GameDateTime { get; set; }
        public string Status { get; set; } = string.Empty;
        public string HomeTeamName { get; set; } = string.Empty;
        public string AwayTeamName { get; set; } = string.Empty;
        public string TeamType { get; set; } = string.Empty;
        public string HomeTeamMascot { get; set; } = string.Empty;
        public string AwayTeamMascot { get; set; } = string.Empty;
        public string ArenaName { get; set; } = string.Empty;
        public string RinkName { get; set; } = string.Empty;
        public string HomeHeadCoachName { get; set; } = string.Empty;
        public string HomeAssistantCoach1Name { get; set; } = string.Empty;
        public string HomeAssistantCoach2Name { get; set; } = string.Empty;
        public string HomeAssistantCoach3Name { get; set; } = string.Empty;
        public string HomeAssistantCoach4Name { get; set; } = string.Empty;
        public string AwayHeadCoachName { get; set; } = string.Empty;
        public string AwayAssistantCoach1Name { get; set; } = string.Empty;
        public string AwayAssistantCoach2Name { get; set; } = string.Empty;
        public string AwayAssistantCoach3Name { get; set; } = string.Empty;
        public string AwayAssistantCoach4Name { get; set; } = string.Empty;
        public int HomeGoals { get; set; }
        public int AwayGoals { get; set; }
        public PeriodShots HomeShots { get; set; } = new PeriodShots();
        public PeriodShots AwayShots { get; set; } = new PeriodShots();
        public List<GoalSummaryLine> Goals { get; set; } = new List<GoalSummaryLine>();
        public List<PenaltySummaryLine> Penalties { get; set; } = new List<PenaltySummaryLine>();
        public List<GoalieSummaryLine> Goalies { get; set; } = new List<GoalieSummaryLine>();
        public List<RosterPlayerSummaryLine> HomeRoster { get; set; } = new List<RosterPlayerSummaryLine>();
        public List<RosterPlayerSummaryLine> AwayRoster { get; set; } = new List<RosterPlayerSummaryLine>();
        public List<OfficialSummaryLine> Officials { get; set; } = new List<OfficialSummaryLine>();
        public List<SuspensionReviewSummaryLine> SuspensionReviews { get; set; } = new List<SuspensionReviewSummaryLine>();
    }

    public class PeriodShots
    {
        public int P1 { get; set; }
        public int P2 { get; set; }
        public int P3 { get; set; }
        public int OT { get; set; }
        public int Total { get; set; }
    }

    public class GoalSummaryLine
    {
        public int Period { get; set; }
        public string TimeInPeriod { get; set; } = string.Empty;
        public string TeamName { get; set; } = string.Empty;
        public int? ScorerNumber { get; set; }
        public string Scorer { get; set; } = string.Empty;
        public int? Assist1Number { get; set; }
        public string? Assist1 { get; set; }
        public int? Assist2Number { get; set; }
        public string? Assist2 { get; set; }
        public string Strength { get; set; } = string.Empty;
    }

    public class PenaltySummaryLine
    {
        public int Period { get; set; }
        public string TimeInPeriod { get; set; } = string.Empty;
        public string TeamName { get; set; } = string.Empty;
        public int? PlayerNumber { get; set; }
        public string PlayerName { get; set; } = string.Empty;
        public string Infraction { get; set; } = string.Empty;
        public int DurationMinutes { get; set; }
        public string? PenaltyType { get; set; }
        public string? Notes { get; set; }
    }

    public class GoalieSummaryLine
    {
        public string TeamName { get; set; } = string.Empty;
        public string GoalieName { get; set; } = string.Empty;
        public int P1 { get; set; }
        public int P2 { get; set; }
        public int P3 { get; set; }
        public int OT { get; set; }
        public int Total { get; set; }
        public int TimeInNetSeconds { get; set; }
        public decimal GoalsAgainstEstimate { get; set; }
        public decimal SavesEstimate { get; set; }
        public decimal SavePctEstimate { get; set; }
    }

    public class RosterPlayerSummaryLine
    {
        public Guid TeamId { get; set; }
        public int? JerseyNumber { get; set; }
        public string PlayerName { get; set; } = string.Empty;
        public bool IsGoalie { get; set; }
    }

    public class OfficialSummaryLine
    {
        public string Role { get; set; } = string.Empty;
        public string OfficialName { get; set; } = string.Empty;
    }

    public class SuspensionReviewSummaryLine
    {
        public int Period { get; set; }
        public string TimeInPeriod { get; set; } = string.Empty;
        public string TeamName { get; set; } = string.Empty;
        public int? PlayerNumber { get; set; }
        public string PlayerName { get; set; } = string.Empty;
        public string? SuspensionBehavior { get; set; }
        public bool RequiresRefereeNotes { get; set; }
        public bool ReviewRequired { get; set; }
        public string? Notes { get; set; }
    }

    public interface IGameSummaryReportService
    {
        Task<GameSummaryReport?> BuildReportAsync(Guid gameId);
        byte[] BuildPdf(GameSummaryReport report);
        string BuildEmailBody(GameSummaryReport report);
    }
}
