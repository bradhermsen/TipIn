using System;

namespace TipInAPI.DTOs
{
    public class LeagueDto
    {
        public Guid LeagueId { get; set; }
        public string? LeagueName { get; set; }
        public bool IsActive { get; set; }
    }
}
