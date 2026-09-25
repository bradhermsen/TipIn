using System;
using System.Collections.Generic;

namespace TipInAPI.DTOs
{
    public class PlayerDto
    {
        public Guid PlayerId { get; set; }

        public Guid? OrganizationId { get; set; }
        public string? OrganizationName { get; set; }

        public string? FirstName { get; set; }
        public string? LastName { get; set; }
        public string? FullName { get; set; }

        public DateTime? BirthDate { get; set; }
        public int? Grade { get; set; }

        public int? HeightInches { get; set; }
        public int? WeightLbs { get; set; }

        public string? Position { get; set; }
        public string? Shoots { get; set; }

        public int? JerseyNumber { get; set; }

        public bool IsActive { get; set; }
        public string Status => IsActive ? "Active" : "Inactive";

        // Multi-team support
        public List<PlayerTeamDto> Teams { get; set; } = new();
    }
}
