using System;
using System.Collections.Generic;
using System.Data;
using System.Threading.Tasks;
using TipInAPI.DTOs;

namespace TipInAPI.Repositories
{
    public interface ICoachTeamsRepository
    {
        // ============================================================
        // ASSIGN COACH TO TEAM
        // ============================================================
        Task AssignCoachToTeamAsync(Guid userId, Guid teamId); // standalone
        Task AssignCoachToTeamAsync(Guid userId, Guid teamId, IDbConnection conn, IDbTransaction tx); // transactional

        // ============================================================
        // REMOVE COACH FROM TEAM
        // ============================================================
        Task RemoveAsync(Guid userId, Guid teamId); // standalone
        Task RemoveAsync(Guid userId, Guid teamId, IDbConnection conn, IDbTransaction tx); // transactional

        // ============================================================
        // GET TEAMS FOR COACH
        // ============================================================
        Task<IEnumerable<CoachTeamDetailDto>> GetTeamsForCoachAsync(Guid userId); // standalone
        Task<IEnumerable<CoachTeamDetailDto>> GetTeamsForCoachAsync(Guid userId, IDbConnection conn, IDbTransaction tx); // transactional

        // ============================================================
        // GET COACHES FOR TEAM
        // ============================================================
        Task<IEnumerable<CoachTeamDetailDto>> GetCoachesForTeamAsync(Guid teamId);
    }
}
