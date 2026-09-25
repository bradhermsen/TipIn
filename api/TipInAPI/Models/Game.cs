using System;

namespace TipInAPI.Models
{
    public class Game
    {
        public Guid GameId { get; set; }

        public Guid HomeTeamId { get; set; }
        public Guid AwayTeamId { get; set; }

        public DateTime GameDateTime { get; set; }

        public Guid? ArenaId { get; set; }
        public Guid? RinkId { get; set; }
        public string ArenaName { get; set; }
        public string RinkName { get; set; }
        public string? VenueAddress { get; set; }

        public int GameTypeId { get; set; }
        public int? GameRoundId { get; set; }
        public int PeriodLengthMinutes { get; set; } = 17;

        public string? Notes { get; set; }

        public string Status { get; set; } = "Scheduled";

        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }
}
