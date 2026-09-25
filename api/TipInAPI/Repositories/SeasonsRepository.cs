using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Data;
using Dapper;
using TipInAPI.DTOs;

namespace TipInAPI.Repositories
{
    public class SeasonsRepository : ISeasonsRepository
    {
        private readonly IDbConnection _db;

        public SeasonsRepository(IDbConnection db)
        {
            _db = db;
        }

        // GET ALL
        public async Task<IEnumerable<SeasonDto>> GetAllAsync()
        {
            var sql = @"
                SELECT 
                    SeasonId,
                    SeasonName,
                    StartDate,
                    EndDate,
                    IsActive
                FROM Seasons
                ORDER BY StartDate DESC";

            return await _db.QueryAsync<SeasonDto>(sql);
        }

        // GET BY ID
        public async Task<SeasonDto?> GetByIdAsync(Guid id)
        {
            var sql = @"
                SELECT 
                    SeasonId,
                    SeasonName,
                    StartDate,
                    EndDate,
                    IsActive
                FROM Seasons
                WHERE SeasonId = @Id";

            return await _db.QueryFirstOrDefaultAsync<SeasonDto>(sql, new { Id = id });
        }

        // CREATE
        public async Task CreateAsync(CreateSeasonDto dto)
        {
            var sql = @"
                IF @IsActive = 1
                BEGIN
                    UPDATE Seasons SET IsActive = 0 WHERE IsActive = 1;
                END;

                INSERT INTO Seasons (SeasonId, SeasonName, StartDate, EndDate, IsActive)
                VALUES (@SeasonId, @SeasonName, @StartDate, @EndDate, @IsActive);";

            await _db.ExecuteAsync(sql, new
            {
                SeasonId = Guid.NewGuid(),
                dto.SeasonName,
                dto.StartDate,
                dto.EndDate,
                dto.IsActive
            });
        }

        // UPDATE
        public async Task UpdateAsync(Guid id, UpdateSeasonDto dto)
        {
            var sql = @"
                IF @IsActive = 1
                BEGIN
                    UPDATE Seasons SET IsActive = 0 WHERE SeasonId <> @Id AND IsActive = 1;
                END;

                UPDATE Seasons
                SET 
                    SeasonName = @SeasonName,
                    StartDate = @StartDate,
                    EndDate = @EndDate,
                    IsActive = @IsActive
                WHERE SeasonId = @Id";

            await _db.ExecuteAsync(sql, new
            {
                Id = id,
                dto.SeasonName,
                dto.StartDate,
                dto.EndDate,
                dto.IsActive
            });
        }

        // DELETE
        public async Task DeleteAsync(Guid id)
        {
            var sql = @"DELETE FROM Seasons WHERE SeasonId = @Id";
            await _db.ExecuteAsync(sql, new { Id = id });
        }
    }
}
