using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using TipInAPI.DTOs;
using TipInAPI.Repositories;

namespace TipInAPI.Services
{
    public class SeasonsService : ISeasonsService
    {
        private readonly ISeasonsRepository _repo;

        public SeasonsService(ISeasonsRepository repo)
        {
            _repo = repo;
        }

        public Task<IEnumerable<SeasonDto>> GetAllAsync() =>
            _repo.GetAllAsync();

        public Task<SeasonDto?> GetByIdAsync(Guid id) =>
            _repo.GetByIdAsync(id);

        public Task CreateAsync(CreateSeasonDto dto) =>
            _repo.CreateAsync(dto);

        public Task UpdateAsync(Guid id, UpdateSeasonDto dto) =>
            _repo.UpdateAsync(id, dto);

        public Task DeleteAsync(Guid id) =>
            _repo.DeleteAsync(id);
    }
}
