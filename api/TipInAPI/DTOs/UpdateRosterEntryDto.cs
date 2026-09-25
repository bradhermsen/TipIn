using System;

namespace TipInAPI.DTOs
{
    public class UpdateRosterEntryDto
    {
        // Roster Info
        public int? JerseyNumber { get; set; }
        public string? Position { get; set; }
        public string? Shoots { get; set; }
        public string? GamedayStatus { get; set; }
        public int? LineNumber { get; set; }
        public int? Grade { get; set; }
        public string? Notes { get; set; }

        // Flags
        public bool IsCaptain { get; set; }
        public bool IsAssistantCaptain { get; set; }
        public bool IsGoalie { get; set; }
        public bool IsActive { get; set; }
    }
}
