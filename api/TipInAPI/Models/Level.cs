using System;

namespace TipInAPI.Models
{
    public class Level
    {
        public Guid Id { get; set; }
        public string? LevelName { get; set; }
        public bool IsActive { get; set; }

        // System
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }
}
