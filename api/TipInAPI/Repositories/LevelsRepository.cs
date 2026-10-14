using System;
using System.Collections.Generic;
using System.Data;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.DTOs;

namespace TipInAPI.Repositories
{
    public class LevelsRepository : ILevelsRepository
    {
        private readonly IDbConnection _db;

        public LevelsRepository(IDbConnection db)
        {
            _db = db;
        }

        public async Task<IEnumerable<LevelListItemDto>> GetAllAsync()
        {
            var sql = @"
                SELECT 
                    l.Id AS LevelId,
                    l.Name AS LevelName,
                    COUNT(t.Id) AS TeamCount
                FROM Levels l
                LEFT JOIN Teams t ON t.LevelId = l.Id
                GROUP BY l.Id, l.Name
                ORDER BY l.Name ASC;
            ";

            return await _db.QueryAsync<LevelListItemDto>(sql);
        }

        public async Task<LevelDto?> GetByIdAsync(Guid id)
        {
            var sql = @"
                SELECT 
                    Id AS LevelId,
                    Name AS LevelName
                FROM Levels
                WHERE Id = @Id;
            ";

            return await _db.QueryFirstOrDefaultAsync<LevelDto>(sql, new { Id = id });
        }

        public async Task<Guid> CreateAsync(CreateLevelDto dto)
        {
            var id = Guid.NewGuid();

            var sql = @"
                INSERT INTO Levels (Id, Name)
                VALUES (@Id, @Name);
            ";

            await _db.ExecuteAsync(sql, new
            {
                Id = id,
                Name = dto.LevelName
            });

            return id;
        }

        public async Task UpdateAsync(Guid id, UpdateLevelDto dto)
        {
            var sql = @"
                UPDATE Levels
                SET Name = @Name
                WHERE Id = @Id;
            ";

            await _db.ExecuteAsync(sql, new
            {
                Id = id,
                Name = dto.LevelName
            });
        }

        public async Task<int> DeleteAsync(Guid id)
        {
            if (_db.State != ConnectionState.Open) _db.Open();
            using var transaction = _db.BeginTransaction(IsolationLevel.Serializable);

            var exists = await _db.ExecuteScalarAsync<int>(@"
                SELECT COUNT(1)
                FROM dbo.Levels WITH (UPDLOCK, HOLDLOCK)
                WHERE Id = @Id;", new { Id = id }, transaction);
            if (exists == 0)
            {
                transaction.Commit();
                return 0;
            }

            var teamCount = await _db.ExecuteScalarAsync<int>(@"
                SELECT COUNT(1)
                FROM dbo.Teams WITH (UPDLOCK, HOLDLOCK)
                WHERE LevelId = @Id;", new { Id = id }, transaction);
            if (teamCount > 0)
            {
                transaction.Commit();
                return -1;
            }

            await _db.ExecuteAsync("DELETE FROM dbo.Levels WHERE Id = @Id;", new { Id = id }, transaction);
            transaction.Commit();
            return 1;
        }
    }
}
