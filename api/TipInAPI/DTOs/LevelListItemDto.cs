using System;

namespace TipInAPI.DTOs
{
    public class LevelListItemDto
    {
        public Guid LevelId { get; set; }
        public string? LevelName { get; set; }
        public bool IsActive { get; set; }

        public int TeamCount { get; set; }
    }
}
