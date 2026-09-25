using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using TipInAPI.DTOs;
using TipInAPI.Repositories;

namespace TipInAPI.Services
{
    public class PlayersService : IPlayersService
    {
        private readonly IPlayersRepository _repo;

        public PlayersService(IPlayersRepository repo)
        {
            _repo = repo;
        }

        public Task<IEnumerable<PlayerListItemDto>> GetAllDtosAsync()
            => _repo.GetAllDtosAsync();

        public Task<PlayerDto?> GetByIdAsync(Guid id)
            => _repo.GetByIdAsync(id);

        public Task<Guid> CreateAsync(CreatePlayerDto dto)
            => _repo.CreateAsync(dto);

        public Task UpdateAsync(Guid id, UpdatePlayerDto dto)
            => _repo.UpdateAsync(id, dto);

        public Task DeleteAsync(Guid id)
            => _repo.DeleteAsync(id);
    }
}
