using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using TipInAPI.DTOs;

namespace TipInAPI.Services
{
    public interface IGameService
    {
        Task<IEnumerable<GameListItemDto>> GetAllAsync();
        Task<IEnumerable<PublicGameViewGameDto>> GetGameViewGamesAsync(
            Guid? seasonId,
            Guid? organizationId,
            Guid? teamId,
            string? teamType);
        Task<GameDetailDto?> GetByIdAsync(Guid id);
        Task CreateAsync(GameCreateUpdateDto dto);
        Task UpdateAsync(Guid id, GameCreateUpdateDto dto);
        Task DeleteAsync(Guid id);
    }
}
