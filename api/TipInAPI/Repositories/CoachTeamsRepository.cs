using System;
using System.Collections.Generic;
using System.Data;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.DTOs;
using TipInAPI.Infrastructure.Database;

namespace TipInAPI.Repositories
{
    public class CoachTeamsRepository : ICoachTeamsRepository
    {
        private readonly ISqlConnectionFactory _db;

        public CoachTeamsRepository(ISqlConnectionFactory db)
        {
            _db = db;
        }

        // ============================================================
        // ASSIGN COACH TO TEAM (supports external conn + tx)
        // ============================================================
        public async Task AssignCoachToTeamAsync(Guid userId, Guid teamId, IDbConnection conn, IDbTransaction tx)
        {
            const string sql = @"
                IF NOT EXISTS (
                    SELECT 1 FROM CoachTeams WHERE UserId = @UserId AND TeamId = @TeamId
                )
                BEGIN
                    INSERT INTO CoachTeams (UserId, TeamId)
                    VALUES (@UserId, @TeamId);
                END";

            await conn.ExecuteAsync(sql, new { UserId = userId, TeamId = teamId }, tx);
        }

        // Standalone overload
        public async Task AssignCoachToTeamAsync(Guid userId, Guid teamId)
        {
            using var conn = _db.CreateConnection();
            await AssignCoachToTeamAsync(userId, teamId, conn, null);
        }

        // ============================================================
        // REMOVE COACH FROM TEAM (supports external conn + tx)
        // ============================================================
        public async Task RemoveAsync(Guid userId, Guid teamId, IDbConnection conn, IDbTransaction tx)
        {
            const string sql = @"
                DELETE FROM CoachTeams
                WHERE UserId = @UserId AND TeamId = @TeamId;";

            await conn.ExecuteAsync(sql, new { UserId = userId, TeamId = teamId }, tx);
        }

        // Standalone overload
        public async Task RemoveAsync(Guid userId, Guid teamId)
        {
            using var conn = _db.CreateConnection();
            await RemoveAsync(userId, teamId, conn, null);
        }

        // ============================================================
        // GET TEAMS FOR COACH (supports external conn + tx)
        // ============================================================
        public async Task<IEnumerable<CoachTeamDetailDto>> GetTeamsForCoachAsync(Guid userId, IDbConnection conn, IDbTransaction tx)
        {
            const string sql = @"
                SELECT 
                    t.Id AS TeamId, 
                    t.Name AS TeamName,
                    t.Abbreviation
                FROM CoachTeams ct
                JOIN Teams t ON t.Id = ct.TeamId
                WHERE ct.UserId = @UserId;";

            return await conn.QueryAsync<CoachTeamDetailDto>(sql, new { UserId = userId }, tx);
        }

        // Standalone overload
        public async Task<IEnumerable<CoachTeamDetailDto>> GetTeamsForCoachAsync(Guid userId)
        {
            using var conn = _db.CreateConnection();
            return await GetTeamsForCoachAsync(userId, conn, null);
        }

        // ============================================================
        // GET COACHES FOR TEAM
        // ============================================================
        public async Task<IEnumerable<CoachTeamDetailDto>> GetCoachesForTeamAsync(Guid teamId)
        {
            using var conn = _db.CreateConnection();

            const string sql = @"
                SELECT 
                    u.Id AS UserId, 
                    u.FirstName, 
                    u.LastName, 
                    u.Email
                FROM CoachTeams ct
                JOIN Users u ON u.Id = ct.UserId
                WHERE ct.TeamId = @TeamId;";

            return await conn.QueryAsync<CoachTeamDetailDto>(sql, new { TeamId = teamId });
        }
    }
}
