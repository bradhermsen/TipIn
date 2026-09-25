using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using TipInAPI.DTOs;
using TipInAPI.Models;

namespace TipInAPI.Services
{
    public interface ITeamsService
    {
        Task<IEnumerable<TeamsListItemDto>> GetAllAsync();
        Task<TeamDetailDto?> GetByIdAsync(Guid id);
        Task<Guid> CreateAsync(TeamCreateUpdateDto dto);
        Task UpdateAsync(Guid id, TeamCreateUpdateDto dto);
        Task DeleteAsync(Guid id);

        // NEW
        Task<IEnumerable<Team>> GetTeamsByOrganizationAsync(Guid organizationId);
    }
}
