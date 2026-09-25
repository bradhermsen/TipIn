using System;

namespace TipInAPI.Models
{
    public class Season
    {
        public Guid Id { get; set; }

        public string? SeasonName { get; set; }

        public DateTime StartDate { get; set; }
        public DateTime EndDate { get; set; }

        public bool IsActive { get; set; }

        // System
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }
}
