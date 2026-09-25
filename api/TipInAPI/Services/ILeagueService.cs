using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using TipInAPI.DTOs;

namespace TipInAPI.Services
{
    public interface ILeagueService
    {
        Task<IEnumerable<LeagueListItemDto>> GetAllAsync();
        Task<LeagueDto?> GetByIdAsync(Guid id);
        Task<Guid> CreateAsync(CreateLeagueDto dto);
        Task UpdateAsync(Guid id, UpdateLeagueDto dto);
        Task DeleteAsync(Guid id);
    }
}
