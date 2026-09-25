using System;
using System.Collections.Generic;

namespace TipInAPI.DTOs
{
    public class PlayerListItemDto
    {
        public Guid Id { get; set; }

        public string FirstName { get; set; } = "";
        public string LastName { get; set; } = "";
        public string FullName { get; set; } = "";

        public int? Grade { get; set; }
        public int? JerseyNumber { get; set; }
        public string? Position { get; set; }
        public string? Shoots { get; set; }

        public Guid? OrganizationId { get; set; }
        public string? OrganizationName { get; set; }

        public string Status { get; set; } = "Inactive";

        // Multi-team support
        public List<PlayerTeamDto> Teams { get; set; } = new();
    }
}
