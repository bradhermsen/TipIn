using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using TipInAPI.DTOs;
using TipInAPI.Models;

namespace TipInAPI.Repositories
{
    public interface IOrganizationRepository
    {
        Task<IEnumerable<OrganizationListItemDto>> GetAllAsync();
        Task<OrganizationDto?> GetByIdAsync(Guid id);
        Task<Guid?> FindDuplicateIdAsync(string name, Guid leagueId);

        // Updated: now accepts full Organization model
        Task CreateAsync(Organization org);

        Task UpdateAsync(Guid id, UpdateOrganizationDto dto);
        Task DeleteAsync(Guid id);
    }
}
