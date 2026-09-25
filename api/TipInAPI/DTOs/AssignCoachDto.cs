using System;
using System.Text.Json.Serialization;

namespace TipInAPI.DTOs
{
    public class AssignCoachDto
    {
        [JsonPropertyName("userId")]
        public Guid UserId { get; set; }

        [JsonPropertyName("teamId")]
        public Guid TeamId { get; set; }
    }
}
