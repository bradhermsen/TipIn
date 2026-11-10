namespace TipInAPI.DTOs
{
    /// <summary>A staff listing, separate from a coach's account access.</summary>
    public sealed record CoachStaffDto(int Slot, string Title, string? Name, string? Email);

    /// <summary>Updates one assistant staff slot without changing the head coach or login access.</summary>
    public sealed record UpdateAssistantRequest
    {
        public string? Name { get; init; }
        public string? Email { get; init; }
        public string? ExpectedName { get; init; }
        public string? ExpectedEmail { get; init; }
    }
}
