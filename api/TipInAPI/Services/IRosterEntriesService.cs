using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using TipInAPI.DTOs;

namespace TipInAPI.Services
{
    public interface IRosterEntriesService
    {
        Task<IEnumerable<RosterEntryDto>> GetByTeamIdAsync(Guid teamId);
        Task<RosterEntryDto?> GetByIdAsync(Guid id);
        Task<Guid> CreateAsync(CreateRosterEntryDto dto);
        Task UpdateAsync(Guid id, UpdateRosterEntryDto dto);
        Task DeleteAsync(Guid id);
        Task<IEnumerable<PlayerDto>> GetAvailablePlayersAsync(Guid teamId);
    }
}
