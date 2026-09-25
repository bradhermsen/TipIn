using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using TipInAPI.Models;
using TipInAPI.DTOs;

namespace TipInAPI.Repositories
{
    public interface IPlayersRepository
    {
        Task<IEnumerable<PlayerListItemDto>> GetAllDtosAsync();
        Task<PlayerDto?> GetByIdAsync(Guid id);
        Task<IEnumerable<Player>> GetAllAsync();
        Task<Guid> CreateAsync(CreatePlayerDto dto);
        Task UpdateAsync(Guid id, UpdatePlayerDto dto);
        Task DeleteAsync(Guid id);
    }
}
