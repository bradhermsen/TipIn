using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;
using TipInAPI.DTOs; 

namespace TipInAPI.Models
{
    public class User
    {
        [JsonPropertyName("id")]
        public Guid Id { get; set; }

        [JsonPropertyName("organizationId")]
        public Guid? OrganizationId { get; set; }
        public string? OrganizationName { get; set; }


        [JsonPropertyName("firstName")]
        public string FirstName { get; set; }

        [JsonPropertyName("lastName")]
        public string LastName { get; set; }

        [JsonPropertyName("email")]
        public string Email { get; set; }

        [JsonPropertyName("createdAt")]
        public DateTime CreatedAt { get; set; }

        [JsonPropertyName("role")]
        public string Role { get; set; }

        [JsonPropertyName("isActive")]
        public bool IsActive { get; set; }

        [JsonPropertyName("teams")]
        public List<TeamSummaryDto> Teams { get; set; } = new();
    }
}
