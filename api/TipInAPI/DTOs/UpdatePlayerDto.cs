using System;
using System.Collections.Generic;

namespace TipInAPI.DTOs
{
    public class UpdatePlayerDto
    {
        public string FirstName { get; set; } = "";
        public string LastName { get; set; } = "";
        public DateTime? BirthDate { get; set; }

        public int? Grade { get; set; }
        public int? HeightInches { get; set; }
        public int? WeightLbs { get; set; }

        public string? Shoots { get; set; }
        public string? Position { get; set; }

        public Guid? OrganizationId { get; set; }
        public int? JerseyNumber { get; set; }

        public bool IsActive { get; set; }

        // NEW — multi-team support
        public List<Guid> TeamIds { get; set; } = new();
    }
}
