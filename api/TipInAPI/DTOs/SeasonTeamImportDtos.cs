using System;
using System.Collections.Generic;

namespace TipInAPI.DTOs
{
    public class SeasonTeamImportCandidateDto
    {
        public Guid SourceTeamId { get; set; }
        public string TeamName { get; set; } = string.Empty;
        public Guid LevelId { get; set; }
        public string LevelName { get; set; } = string.Empty;
        public string TeamType { get; set; } = string.Empty;
        public Guid? OrganizationId { get; set; }
        public string OrganizationName { get; set; } = string.Empty;
        public bool IsExternal { get; set; }
        public bool AlreadyImported { get; set; }
        public bool IsEligible { get; set; }
        public string? IneligibleReason { get; set; }
    }

    public class ImportSeasonTeamsRequestDto
    {
        public Guid SourceSeasonId { get; set; }
        public List<Guid> TeamIds { get; set; } = new();
    }
}
