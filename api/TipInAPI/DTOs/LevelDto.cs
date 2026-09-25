using System;

namespace TipInAPI.DTOs
{
    public class LevelDto
    {
        public Guid LevelId { get; set; }
        public string? LevelName { get; set; }
        public bool IsActive { get; set; }

        // System
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }
}
