using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.DTOs;
using TipInAPI.Infrastructure.Database;
using TipInAPI.Repositories;
using TipInAPI.Models;

namespace TipInAPI.Services
{
    public class TeamsService : ITeamsService
    {
        private readonly ITeamsRepository _repo;
        private readonly IOrganizationRepository _organizationRepository;
        private readonly ISqlConnectionFactory _connectionFactory;

        private static readonly Dictionary<string, string> AllowedTeamTypes =
            new(StringComparer.OrdinalIgnoreCase)
            {
                ["boys"] = "Boys",
                ["girls"] = "Girls",
                ["co-ed"] = "Co-Ed",
                ["coed"] = "Co-Ed",
                ["men"] = "Men",
                ["women"] = "Women"
            };

        public TeamsService(
            ITeamsRepository repo,
            IOrganizationRepository organizationRepository,
            ISqlConnectionFactory connectionFactory)
        {
            _repo = repo;
            _organizationRepository = organizationRepository;
            _connectionFactory = connectionFactory;
        }

        public Task<IEnumerable<TeamsListItemDto>> GetAllAsync() =>
            _repo.GetAllAsync();

        public Task<TeamDetailDto?> GetByIdAsync(Guid id) =>
            _repo.GetByIdAsync(id);

        public async Task<Guid> CreateAsync(TeamCreateUpdateDto dto)
        {
            await ValidateAndApplyRulesAsync(dto);
            return await _repo.CreateAsync(dto);
        }

        public async Task UpdateAsync(Guid id, TeamCreateUpdateDto dto)
        {
            await ValidateAndApplyRulesAsync(dto);
            await _repo.UpdateAsync(id, dto);
        }

        public Task DeleteAsync(Guid id) =>
            _repo.DeleteAsync(id);

        // NEW
        public Task<IEnumerable<Team>> GetTeamsByOrganizationAsync(Guid organizationId) =>
            _repo.GetTeamsByOrganizationAsync(organizationId);

        private async Task ValidateAndApplyRulesAsync(TeamCreateUpdateDto dto)
        {
            if (dto == null)
            {
                throw new ArgumentException("Team payload is required.");
            }

            if (dto.LevelId == Guid.Empty)
            {
                throw new ArgumentException("Level is required.");
            }

            if (dto.SeasonId == Guid.Empty)
            {
                throw new ArgumentException("Season is required.");
            }

            var teamType = NormalizeTeamType(dto.TeamType);
            if (teamType == null)
            {
                throw new ArgumentException("Team type is required and must be one of: Boys, Girls, Co-Ed, Men, Women.");
            }

            dto.TeamType = teamType;
            dto.TeamMascot = string.IsNullOrWhiteSpace(dto.TeamMascot) ? null : dto.TeamMascot.Trim();

            if (!dto.OrganizationId.HasValue)
            {
                throw new ArgumentException("Organization is required for every team.");
            }

            var org = await _organizationRepository.GetByIdAsync(dto.OrganizationId.Value);
            if (org == null)
            {
                throw new ArgumentException("Selected organization was not found.");
            }

            var organizationType = string.Equals(org.OrganizationType, "External", StringComparison.OrdinalIgnoreCase)
                ? "External"
                : "Managed";
            dto.IsExternal = organizationType == "External";

            await ValidateSeasonParticipationAsync(
                dto.SeasonId,
                dto.OrganizationId.Value,
                organizationType);

            if (dto.IsExternal)
            {
                dto.GameManagerCode = null;
                dto.StatManagerCode = null;
                return;
            }

            if (!string.IsNullOrWhiteSpace(dto.TeamMascot))
            {
                return;
            }

            if (string.IsNullOrWhiteSpace(org.Mascot))
            {
                throw new InvalidOperationException("Organization mascot is required for internal teams when team mascot is not provided.");
            }

            dto.TeamMascot = org.Mascot.Trim();
        }

        private async Task ValidateSeasonParticipationAsync(
            Guid seasonId,
            Guid organizationId,
            string requiredParticipationType)
        {
            using var connection = _connectionFactory.CreateConnection();
            var participationType = await connection.QuerySingleOrDefaultAsync<string>(@"
                SELECT ParticipationType
                FROM dbo.SeasonOrganizations
                WHERE SeasonId = @SeasonId
                  AND OrganizationId = @OrganizationId;",
                new { SeasonId = seasonId, OrganizationId = organizationId });

            if (!string.Equals(participationType, requiredParticipationType, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    "The selected organization is not participating in this season.");
            }
        }

        private static string? NormalizeTeamType(string? value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return null;
            }

            var normalizedKey = value.Trim().ToLowerInvariant();
            return AllowedTeamTypes.TryGetValue(normalizedKey, out var normalizedType)
                ? normalizedType
                : null;
        }
    }
}
