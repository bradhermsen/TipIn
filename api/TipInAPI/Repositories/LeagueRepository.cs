using System;
using System.Collections.Generic;
using System.Data;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.DTOs;

namespace TipInAPI.Repositories
{
    public class LeagueRepository : ILeagueRepository
    {
        private readonly IDbConnection _db;

        public LeagueRepository(IDbConnection db)
        {
            _db = db;
        }

        public async Task<IEnumerable<LeagueListItemDto>> GetAllAsync()
        {
            var sql = @"
                SELECT 
                    l.Id AS LeagueId,
                    l.Name AS LeagueName,
                    COUNT(o.OrganizationId) AS OrganizationCount
                FROM Leagues l
                LEFT JOIN Organizations o ON o.LeagueId = l.Id
                GROUP BY l.Id, l.Name
                ORDER BY l.Name ASC;
            ";

            return await _db.QueryAsync<LeagueListItemDto>(sql);
        }

        public async Task<LeagueDto?> GetByIdAsync(Guid id)
        {
            var sql = @"
                SELECT 
                    Id AS LeagueId,
                    Name AS LeagueName
                FROM Leagues
                WHERE Id = @Id;
            ";

            return await _db.QueryFirstOrDefaultAsync<LeagueDto>(sql, new { Id = id });
        }

        public async Task<Guid> CreateAsync(CreateLeagueDto dto)
        {
            var id = Guid.NewGuid();

            var sql = @"
                INSERT INTO Leagues (Id, Name)
                VALUES (@Id, @Name);
            ";

            await _db.ExecuteAsync(sql, new
            {
                Id = id,
                Name = dto.LeagueName
            });

            return id;
        }

        public async Task UpdateAsync(Guid id, UpdateLeagueDto dto)
        {
            var sql = @"
                UPDATE Leagues
                SET Name = @Name
                WHERE Id = @Id;
            ";

            await _db.ExecuteAsync(sql, new
            {
                Id = id,
                Name = dto.LeagueName
            });
        }

        public async Task<int> DeleteAsync(Guid id)
        {
            if (_db.State != ConnectionState.Open) _db.Open();
            using var transaction = _db.BeginTransaction(IsolationLevel.Serializable);

            var exists = await _db.ExecuteScalarAsync<int>(@"
                SELECT COUNT(1)
                FROM dbo.Leagues WITH (UPDLOCK, HOLDLOCK)
                WHERE Id = @Id;", new { Id = id }, transaction);
            if (exists == 0)
            {
                transaction.Commit();
                return 0;
            }

            var organizationCount = await _db.ExecuteScalarAsync<int>(@"
                SELECT COUNT(1)
                FROM dbo.Organizations WITH (UPDLOCK, HOLDLOCK)
                WHERE LeagueId = @Id;", new { Id = id }, transaction);
            if (organizationCount > 0)
            {
                transaction.Commit();
                return -1;
            }

            await _db.ExecuteAsync("DELETE FROM dbo.Leagues WHERE Id = @Id;", new { Id = id }, transaction);
            transaction.Commit();
            return 1;
        }
    }
}
