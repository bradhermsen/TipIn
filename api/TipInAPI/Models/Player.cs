using System;

namespace TipInAPI.Models
{
    public class Player
    {
        public Guid PlayerId { get; set; }

        public string FirstName { get; set; } = string.Empty;
        public string LastName { get; set; } = string.Empty;
        public string? FullName { get; set; }

        public DateTime? BirthDate { get; set; }
        public int? Grade { get; set; }
        public int? HeightInches { get; set; }
        public int? WeightLbs { get; set; }

        public string? Shoots { get; set; }
        public string? Position { get; set; }

        public int? JerseyNumber { get; set; }
        public bool IsActive { get; set; }

        public Guid? TeamId { get; set; }
        public Guid? OrganizationId { get; set; }
        public Guid? LevelId { get; set; }

        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }

        // Optional navigation properties (Dapper-safe)
        public Team? Team { get; set; }
        public Organization? Organization { get; set; }
        public Level? Level { get; set; }
    }
}
