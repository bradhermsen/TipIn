using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using TipInAPI.DTOs;
using TipInAPI.Repositories;

namespace TipInAPI.Services
{
    public class LeagueService : ILeagueService
    {
        private readonly ILeagueRepository _repository;

        public LeagueService(ILeagueRepository repository)
        {
            _repository = repository;
        }

        public Task<IEnumerable<LeagueListItemDto>> GetAllAsync()
            => _repository.GetAllAsync();

        public Task<LeagueDto?> GetByIdAsync(Guid id)
            => _repository.GetByIdAsync(id);

        public Task<Guid> CreateAsync(CreateLeagueDto dto)
            => _repository.CreateAsync(dto);

        public Task UpdateAsync(Guid id, UpdateLeagueDto dto)
            => _repository.UpdateAsync(id, dto);

        public Task DeleteAsync(Guid id)
            => _repository.DeleteAsync(id);
    }
}
