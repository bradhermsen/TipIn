using System;
using System.Collections.Generic;

namespace TipInAPI.DTOs
{
    public class GameOfficialVerificationDto
    {
        public Guid? OfficialId { get; set; }
        public string Role { get; set; } = string.Empty;
        public string OfficialName { get; set; } = string.Empty;
        public string? OfficialEmail { get; set; }
        public string? SignatureImageBase64 { get; set; }
        public DateTime? SignedAtUtc { get; set; }
    }

    public class GameOfficialsVerificationResponseDto
    {
        public Guid GameId { get; set; }
        public List<GameOfficialVerificationDto> Officials { get; set; } = new();
    }

    public class SaveGameOfficialsVerificationRequestDto
    {
        public List<SaveOfficialSignatureDto> Officials { get; set; } = new();
    }

    public class SaveOfficialSignatureDto
    {
        public string Role { get; set; } = string.Empty;
        public string? SignatureImageBase64 { get; set; }
    }

    public class MobileOfficialAssignmentDto
    {
        public Guid OfficialId { get; set; }
        public string Role { get; set; } = string.Empty;
        public string? PreviousRole { get; set; }
    }

    public class MobileCreateOfficialDto
    {
        public string FirstName { get; set; } = string.Empty;
        public string LastName { get; set; } = string.Empty;
        public string? Email { get; set; }
        public bool IsReferee { get; set; }
        public bool IsLinesman { get; set; }
        public bool IsActive { get; set; } = true;
        public string? AssignmentRole { get; set; }
    }
}