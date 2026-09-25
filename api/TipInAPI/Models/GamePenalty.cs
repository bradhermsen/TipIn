using System;

namespace TipInAPI.Models
{
    public class GamePenalty
    {
        public Guid Id { get; set; }
        public Guid GameId { get; set; }
        public Guid EventId { get; set; }
        public Guid TeamId { get; set; }
        public Guid PlayerId { get; set; }
        public Guid? ServedByPlayerId { get; set; }
        public string Infraction { get; set; } = string.Empty;
        public int DurationMinutes { get; set; }
        public int Period { get; set; }
        public string TimeInPeriod { get; set; } = string.Empty;
        public string? Notes { get; set; }
        public DateTime CreatedAt { get; set; }
    }
}