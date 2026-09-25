using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using TipInAPI.DTOs;

namespace TipInAPI.Services
{
    public interface IPlayersService
    {
        Task<IEnumerable<PlayerListItemDto>> GetAllDtosAsync();
        Task<PlayerDto?> GetByIdAsync(Guid id);
        Task<Guid> CreateAsync(CreatePlayerDto dto);
        Task UpdateAsync(Guid id, UpdatePlayerDto dto);
        Task DeleteAsync(Guid id);
    }
}
