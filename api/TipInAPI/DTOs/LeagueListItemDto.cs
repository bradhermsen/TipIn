using System;

namespace TipInAPI.DTOs
{
    public class LeagueListItemDto
    {
        public Guid LeagueId { get; set; }
        public string? LeagueName { get; set; }
        public bool IsActive { get; set; }
        public int OrganizationCount { get; set; }
        public int ConferenceCount { get; set; }
        public int SectionCount { get; set; }
    }
}
