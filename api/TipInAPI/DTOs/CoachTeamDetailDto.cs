using System;

namespace TipInAPI.DTOs
{
    public class CoachTeamDetailDto
    {
        // Returned when querying coaches for a team
        public Guid UserId { get; set; }
        public string? FirstName { get; set; }
        public string? LastName { get; set; }
        public string? Email { get; set; }

        // Returned when querying teams for a coach
        public Guid TeamId { get; set; }
        public string? TeamName { get; set; }
        public string? Abbreviation { get; set; }
    }
}
