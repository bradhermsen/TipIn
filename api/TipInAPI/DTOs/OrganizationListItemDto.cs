using System;

namespace TipInAPI.DTOs
{
    public class OrganizationListItemDto
    {
        public Guid OrganizationId { get; set; }
        public Guid LeagueId { get; set; }
        public string? LeagueName { get; set; }

        public string? Name { get; set; }
        public string? Abbreviation { get; set; }
        public string? Mascot { get; set; }
        public string OrganizationType { get; set; } = "Managed";

        public string? City { get; set; }
        public string? State { get; set; }

        public int TeamCount { get; set; }
        public string? DistrictConference { get; set; }

        public string? PrimaryContactFirstName { get; set; }
        public string? PrimaryContactLastName { get; set; }
        public string? PrimaryContactEmail { get; set; }

        public bool IsActive { get; set; }
    }
}
