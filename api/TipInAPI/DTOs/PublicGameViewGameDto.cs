using System;

namespace TipInAPI.DTOs
{
    public class PublicGameViewGameDto
    {
        public Guid GameId { get; set; }
        public Guid HomeTeamId { get; set; }
        public string HomeTeamName { get; set; } = string.Empty;
        public Guid AwayTeamId { get; set; }
        public string AwayTeamName { get; set; } = string.Empty;
        public DateTime GameDateTime { get; set; }
        public string Status { get; set; } = string.Empty;
        public string? HomeTeamMascot { get; set; }
        public string? AwayTeamMascot { get; set; }
        public string? TeamType { get; set; }
        public string? LevelName { get; set; }
        public int HomeScore { get; set; }
        public int AwayScore { get; set; }
    }
}