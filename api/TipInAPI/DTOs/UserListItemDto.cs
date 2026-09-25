using System;
using System.Collections.Generic;

namespace TipInAPI.DTOs
{
    public class UserListItemDto
    {
        public Guid Id { get; set; }

        public Guid? OrganizationId { get; set; }
        public string? OrganizationName { get; set; }

        public string FirstName { get; set; } = "";
        public string LastName { get; set; } = "";
        public string Email { get; set; } = "";

        public DateTime CreatedAt { get; set; }

        public string Role { get; set; } = "None";
        public bool IsActive { get; set; }

        public List<TeamSummaryDto> Teams { get; set; } = new();
    }
}
