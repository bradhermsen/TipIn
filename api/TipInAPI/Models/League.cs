using System;

namespace TipInAPI.Models
{
    public class League
    {
        public Guid Id { get; set; }
        public string? Name { get; set; }
        public bool IsActive { get; set; }

        // System
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }
}
