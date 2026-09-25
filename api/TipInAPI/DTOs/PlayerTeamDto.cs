using System;

namespace TipInAPI.DTOs
{
    public class PlayerTeamDto
    {
        public Guid TeamId { get; set; }
        public string TeamName { get; set; } = "";
        public Guid LevelId { get; set; }
        public string LevelName { get; set; } = "";
    }


}