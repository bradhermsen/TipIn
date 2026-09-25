using System;

namespace TipInAPI.DTOs
{
    public class GameCreateUpdateDto
    {
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
        public int? PeriodLengthMinutes { get; set; }

        public Guid? Referee1OfficialId { get; set; }
        public Guid? Referee2OfficialId { get; set; }
        public Guid? Linesman1OfficialId { get; set; }
        public Guid? Linesman2OfficialId { get; set; }

        public string? Notes { get; set; }

        public string? Status { get; set; }
    }
}
