using System;

namespace TipInAPI.DTOs
{
    public class GameListItemDto
    {
        public Guid GameId { get; set; }

        public Guid HomeTeamId { get; set; }
        public string HomeTeamName { get; set; }

        public Guid AwayTeamId { get; set; }
        public string AwayTeamName { get; set; }

        public DateTime GameDateTime { get; set; }

        public Guid? ArenaId { get; set; }
        public Guid? RinkId { get; set; }
        public string ArenaName { get; set; }
        public string RinkName { get; set; }
        public string? VenueAddress { get; set; }

        public string GameTypeName { get; set; }
        public string? GameRoundName { get; set; }

        public string? Referee1 { get; set; }
        public string? Referee2 { get; set; }
        public string? Linesman1 { get; set; }
        public string? Linesman2 { get; set; }

        public int PeriodLengthMinutes { get; set; }

        public string Status { get; set; }
    }
}
