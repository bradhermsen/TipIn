using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using TipInAPI.DTOs;
using TipInAPI.Repositories;

namespace TipInAPI.Services
{
    public class GameService : IGameService
    {
        private readonly IGameRepository _repo;

        public GameService(IGameRepository repo)
        {
            _repo = repo;
        }

        public Task<IEnumerable<GameListItemDto>> GetAllAsync()
            => _repo.GetAllAsync();

        public Task<GameDetailDto?> GetByIdAsync(Guid id)
            => _repo.GetByIdAsync(id);

        public async Task CreateAsync(GameCreateUpdateDto dto)
        {
            await NormalizeVenueAsync(dto);
            dto.PeriodLengthMinutes = await ResolvePeriodLengthMinutesAsync(dto);
            await _repo.CreateAsync(dto);
        }

        public async Task UpdateAsync(Guid id, GameCreateUpdateDto dto)
        {
            await NormalizeVenueAsync(dto);
            dto.PeriodLengthMinutes = await ResolvePeriodLengthMinutesAsync(dto);
            await _repo.UpdateAsync(id, dto);
        }

        public Task DeleteAsync(Guid id)
            => _repo.DeleteAsync(id);

        private async Task<int> ResolvePeriodLengthMinutesAsync(GameCreateUpdateDto dto)
        {
            if (dto.PeriodLengthMinutes.HasValue)
            {
                return dto.PeriodLengthMinutes.Value;
            }

            var levelName = await _repo.GetTeamLevelNameAsync(dto.HomeTeamId);
            return GetDefaultPeriodLengthByLevel(levelName);
        }

        private async Task NormalizeVenueAsync(GameCreateUpdateDto dto)
        {
            if (dto.ArenaId.HasValue || dto.RinkId.HasValue)
            {
                if (!dto.ArenaId.HasValue || !dto.RinkId.HasValue)
                    throw new ArgumentException("A managed venue requires both an arena and a rink.");

                var venue = await _repo.GetManagedVenueAsync(dto.ArenaId.Value, dto.RinkId.Value);
                if (venue == null)
                    throw new ArgumentException("The selected managed arena and rink are invalid or inactive.");

                dto.ArenaName = venue.ArenaName;
                dto.RinkName = venue.RinkName;
                dto.VenueAddress = venue.VenueAddress;
                return;
            }

            dto.ArenaId = null;
            dto.RinkId = null;
            dto.ArenaName = dto.ArenaName?.Trim() ?? string.Empty;
            dto.RinkName = dto.RinkName?.Trim() ?? string.Empty;
            dto.VenueAddress = string.IsNullOrWhiteSpace(dto.VenueAddress) ? null : dto.VenueAddress.Trim();
            if (string.IsNullOrWhiteSpace(dto.ArenaName))
                throw new ArgumentException("An external venue name is required.");
        }

        private static int GetDefaultPeriodLengthByLevel(string? levelName)
        {
            if (string.IsNullOrWhiteSpace(levelName)) return 17;

            var normalized = levelName.Trim().ToLowerInvariant();
            if (normalized.Contains("jv")) return 15;
            if (normalized.Contains("varsity")) return 17;

            return 17;
        }
    }
}
