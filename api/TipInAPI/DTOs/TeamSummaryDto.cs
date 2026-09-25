using System;

namespace TipInAPI.DTOs
{
    public class TeamSummaryDto
    {
        public Guid TeamId { get; set; }
        public string TeamName { get; set; }
        public string? Abbreviation { get; set; }
        public string LevelName { get; set; }
        public string? TeamType { get; set; }

    }
}
