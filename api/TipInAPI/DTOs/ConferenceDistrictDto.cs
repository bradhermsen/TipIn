using System;

namespace TipInAPI.DTOs
{
    public class ConferenceDistrictDto
    {
        public Guid Id { get; set; }
        public Guid LeagueId { get; set; }
        public string? LeagueName { get; set; }
        public string? Name { get; set; }
        public int SortOrder { get; set; }
        public bool IsActive { get; set; }
    }
}
