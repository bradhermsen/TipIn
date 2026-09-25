using System;
using System.Collections.Generic;

namespace TipInAPI.DTOs
{
    public class ArenaDto
    {
        public Guid ArenaId { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? StreetAddress { get; set; }
        public string? City { get; set; }
        public string? State { get; set; }
        public string? PostalCode { get; set; }
        public bool IsActive { get; set; }
        public string AccessLevel { get; set; } = "Use";
        public bool IsPrimary { get; set; }
        public List<RinkDto> Rinks { get; set; } = new();
        public List<ArenaOrganizationSummaryDto> Organizations { get; set; } = new();
    }

    public class ArenaOrganizationSummaryDto
    {
        public Guid ArenaId { get; set; }
        public Guid OrganizationId { get; set; }
        public string Name { get; set; } = string.Empty;
        public string AccessLevel { get; set; } = "Use";
        public bool IsPrimary { get; set; }
    }

    public class RinkDto
    {
        public Guid RinkId { get; set; }
        public Guid ArenaId { get; set; }
        public string Name { get; set; } = string.Empty;
        public int DisplayOrder { get; set; }
        public bool IsActive { get; set; }
        public bool GatewayAvailable { get; set; }
        public List<ScoreboardGatewayDto> Gateways { get; set; } = new();
    }

    public class ScoreboardGatewayDto
    {
        public Guid GatewayId { get; set; }
        public Guid RinkId { get; set; }
        public string Name { get; set; } = string.Empty;
        public string DeviceMacAddress { get; set; } = string.Empty;
        public string Host { get; set; } = string.Empty;
        public int Port { get; set; }
        public bool HasSecret { get; set; }
        public bool IsPrimary { get; set; }
        public bool IsActive { get; set; }
        public DateTime? LastSeenAt { get; set; }
    }

    public class ArenaCreateUpdateDto
    {
        public string Name { get; set; } = string.Empty;
        public string? StreetAddress { get; set; }
        public string? City { get; set; }
        public string? State { get; set; }
        public string? PostalCode { get; set; }
        public bool IsActive { get; set; } = true;
        public bool IsPrimary { get; set; }
    }

    public class ArenaAssociationDto
    {
        public string AccessLevel { get; set; } = "Use";
        public bool IsPrimary { get; set; }
    }

    public class RinkCreateUpdateDto
    {
        public string Name { get; set; } = string.Empty;
        public int DisplayOrder { get; set; }
        public bool IsActive { get; set; } = true;
    }

    public class ScoreboardGatewayCreateUpdateDto
    {
        public string Name { get; set; } = string.Empty;
        public string DeviceMacAddress { get; set; } = string.Empty;
        public string Host { get; set; } = string.Empty;
        public int Port { get; set; } = 80;
        public string? WebSocketSecret { get; set; }
        public bool IsPrimary { get; set; } = true;
        public bool IsActive { get; set; } = true;
    }

    public class ManagedVenueSnapshotDto
    {
        public Guid ArenaId { get; set; }
        public Guid RinkId { get; set; }
        public string ArenaName { get; set; } = string.Empty;
        public string RinkName { get; set; } = string.Empty;
        public string? VenueAddress { get; set; }
    }
}