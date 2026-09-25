using System;

namespace TipInAPI.DTOs
{
    public class UpdateSeasonDto
    {
        public string? SeasonName { get; set; }

        public DateTime StartDate { get; set; }
        public DateTime EndDate { get; set; }

        public bool IsActive { get; set; }
    }
}
