using System;

namespace TipInAPI.Models
{
    public class GameEvent
    {
        public Guid Id { get; set; }
        public Guid GameId { get; set; }
        public string EventType { get; set; } = string.Empty;
        public int Period { get; set; }
        public string TimeInPeriod { get; set; } = string.Empty;
        public Guid? TeamId { get; set; }
        public Guid? PlayerId { get; set; }
        public Guid? SecondaryPlayerId { get; set; }
        public string? Zone { get; set; }
        public string? Details { get; set; }
        public DateTime CreatedAt { get; set; }
    }
}