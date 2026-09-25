using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using TipInAPI.DTOs;
using TipInAPI.Repositories;

namespace TipInAPI.Services
{
    public class LevelsService : ILevelsService
    {
        private readonly ILevelsRepository _repository;

        public LevelsService(ILevelsRepository repository)
        {
            _repository = repository;
        }

        public Task<IEnumerable<LevelListItemDto>> GetAllAsync()
            => _repository.GetAllAsync();

        public Task<LevelDto?> GetByIdAsync(Guid id)
            => _repository.GetByIdAsync(id);

        public Task<Guid> CreateAsync(CreateLevelDto dto)
            => _repository.CreateAsync(dto);

        public Task UpdateAsync(Guid id, UpdateLevelDto dto)
            => _repository.UpdateAsync(id, dto);

        public Task DeleteAsync(Guid id)
            => _repository.DeleteAsync(id);
    }
}
