using System;

namespace TipInAPI.Models
{
    public class GameGoal
    {
        public Guid Id { get; set; }
        public Guid GameId { get; set; }
        public Guid EventId { get; set; }
        public Guid ScoringTeamId { get; set; }
        public Guid ScorerId { get; set; }
        public Guid? Assist1Id { get; set; }
        public Guid? Assist2Id { get; set; }
        public Guid? GoalieId { get; set; }
        public string Strength { get; set; } = string.Empty;
        public string? ShotType { get; set; }
        public string? Zone { get; set; }
        public int Period { get; set; }
        public string TimeInPeriod { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
    }
}