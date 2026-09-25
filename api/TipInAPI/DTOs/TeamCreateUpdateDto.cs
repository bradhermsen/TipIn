using System;

public class TeamCreateUpdateDto
{
    public Guid? OrganizationId { get; set; }
    public Guid? ConferenceDistrictId { get; set; }
    public Guid? SectionRegionId { get; set; }
    public Guid LevelId { get; set; }
    public Guid SeasonId { get; set; }

    public string? Name { get; set; }
    public string? Gender { get; set; }
    public string? Abbreviation { get; set; }
    public string? TeamType { get; set; }
    public string? TeamMascot { get; set; }

    public string? HeadCoachName { get; set; }
    public string? AssistantCoach1Name { get; set; }
    public string? AssistantCoach2Name { get; set; }
    public string? AssistantCoach3Name { get; set; }
    public string? AssistantCoach4Name { get; set; }

    public string? HeadCoachEmail { get; set; }
    public string? AssistantCoach1Email { get; set; }
    public string? AssistantCoach2Email { get; set; }
    public string? AssistantCoach3Email { get; set; }
    public string? AssistantCoach4Email { get; set; }

    public bool AssistantCoach1HasLogin { get; set; }
    public bool AssistantCoach2HasLogin { get; set; }
    public bool AssistantCoach3HasLogin { get; set; }
    public bool AssistantCoach4HasLogin { get; set; }

    public string? Notes { get; set; }
    public string? GameManagerCode { get; set; }
    public DateTime? GameManagerCodeExpiresAt { get; set; }
    
    public string? StatManagerCode { get; set; }
    public DateTime? StatManagerCodeExpiresAt { get; set; }

    public bool IsExternal { get; set; }
    public bool IsActive { get; set; }
}
