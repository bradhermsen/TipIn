using System;

namespace TipInAPI.DTOs
{
    public class TeamsListItemDto
    {
        public Guid TeamId { get; set; }
        public Guid? OrganizationId { get; set; }
        public Guid? ConferenceDistrictId { get; set; }
        public Guid? SectionRegionId { get; set; }
        public Guid LevelId { get; set; }
 
        public Guid SeasonId { get; set; }

        public string? Name { get; set; }
        public string? Abbreviation { get; set; }
        public string? TeamType { get; set; }
        public string? TeamMascot { get; set; }
        public string? OrganizationName { get; set; }
        public string OrganizationType { get; set; } = "Managed";
        public string? ConferenceDistrictName { get; set; }
        public string? SectionRegionName { get; set; }
        public string? LevelName { get; set; }
        public string? SeasonName { get; set; }

        public int RosterCount { get; set; }

        public string? HeadCoachName { get; set; }
        public string? GameManagerCode { get; set; }
        public DateTime? GameManagerCodeExpiresAt { get; set; }
        
        public string? StatManagerCode { get; set; }
        public DateTime? StatManagerCodeExpiresAt { get; set; }

        public bool IsExternal { get; set; }
        public bool IsActive { get; set; }
    }
}
