using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using TipInAPI.DTOs;

namespace TipInAPI.Repositories
{
    public interface ILevelsRepository
    {
        Task<IEnumerable<LevelListItemDto>> GetAllAsync();
        Task<LevelDto?> GetByIdAsync(Guid id);
        Task<Guid> CreateAsync(CreateLevelDto dto);
        Task UpdateAsync(Guid id, UpdateLevelDto dto);
        Task DeleteAsync(Guid id);
    }
}
