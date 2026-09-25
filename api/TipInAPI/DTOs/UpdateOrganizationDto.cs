using System;

namespace TipInAPI.DTOs
{
    public class UpdateOrganizationDto
    {
        public Guid LeagueId { get; set; }

        public string? Name { get; set; }
        public string? Abbreviation { get; set; }

        public string? StreetAddress { get; set; }
        public string? City { get; set; }
        public string? State { get; set; }
        public string? ZipCode { get; set; }
        public string? Country { get; set; }

        public string? BillingStreetAddress { get; set; }
        public string? BillingCity { get; set; }
        public string? BillingState { get; set; }
        public string? BillingZipCode { get; set; }
        public string? BillingContactName { get; set; }
        public string? BillingContactEmail { get; set; }

        public string? PrimaryContactFirstName { get; set; }
        public string? PrimaryContactLastName { get; set; }
        public string? PrimaryContactEmail { get; set; }

        public string? DistrictConference { get; set; }
        public string? Mascot { get; set; }
        public string OrganizationType { get; set; } = "Managed";

        public bool IsActive { get; set; }
    }
}
