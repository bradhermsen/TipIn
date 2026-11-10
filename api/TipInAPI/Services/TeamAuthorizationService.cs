using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.Infrastructure.Database;

namespace TipInAPI.Services
{
    public interface ITeamAuthorizationService
    {
        Task<bool> CanAdminAccessTeamAsync(Guid adminUserId, string role, Guid teamId);
        Task<bool> CanAdminInviteToTeamAsync(Guid adminUserId, string role, Guid teamId);
        Task<bool> CanAdminAccessUserAsync(Guid adminUserId, string role, Guid targetUserId);
        Task<bool> IsUserAssignedToTeamAsync(Guid userId, Guid teamId, ICoachTeamsService coachTeamsService);
        Task<bool> CanUserManageTeamAsync(Guid userId, string role, Guid teamId, ICoachTeamsService coachTeamsService);
        Task<HashSet<Guid>> GetAssignedTeamIdsAsync(Guid userId, ICoachTeamsService coachTeamsService);
    }

    public class TeamAuthorizationService : ITeamAuthorizationService
    {
        private readonly ISqlConnectionFactory _db;

        public TeamAuthorizationService(ISqlConnectionFactory db)
        {
            _db = db;
        }

        /// <summary>
        /// SuperAdmin can access any team. OrgAdmin only teams in their own organization.
        /// Denies when either organization is missing.
        /// </summary>
        public async Task<bool> CanAdminAccessTeamAsync(Guid adminUserId, string role, Guid teamId)
        {
            if (role == "SuperAdmin") return true;
            if (role != "OrgAdmin") return false;

            using var conn = _db.CreateConnection();
            return await conn.ExecuteScalarAsync<bool>(@"
                SELECT CASE WHEN EXISTS (
                    SELECT 1
                    FROM Users u
                    JOIN Teams t ON t.OrganizationId = u.OrganizationId
                    WHERE u.Id = @AdminUserId AND t.Id = @TeamId AND u.OrganizationId IS NOT NULL
                ) THEN 1 ELSE 0 END",
                new { AdminUserId = adminUserId, TeamId = teamId });
        }

        /// <summary>
        /// Invite rights: everything CanAdminAccessTeamAsync allows, plus visiting teams
        /// (External organization) that have a non-cancelled game against one of the
        /// OrgAdmin's own teams within 30 days before or after today.
        /// </summary>
        public async Task<bool> CanAdminInviteToTeamAsync(Guid adminUserId, string role, Guid teamId)
        {
            if (await CanAdminAccessTeamAsync(adminUserId, role, teamId)) return true;
            if (role != "OrgAdmin") return false;

            using var conn = _db.CreateConnection();
            return await conn.ExecuteScalarAsync<bool>(@"
                SELECT CASE WHEN EXISTS (
                    SELECT 1
                    FROM Users u
                    JOIN Teams hostTeam ON hostTeam.OrganizationId = u.OrganizationId
                    JOIN Games g ON (g.HomeTeamId = hostTeam.Id AND g.AwayTeamId = @TeamId)
                                 OR (g.AwayTeamId = hostTeam.Id AND g.HomeTeamId = @TeamId)
                    JOIN Teams visitor ON visitor.Id = @TeamId
                    JOIN Organizations vo ON vo.OrganizationId = visitor.OrganizationId
                    WHERE u.Id = @AdminUserId
                      AND u.OrganizationId IS NOT NULL
                      AND vo.OrganizationType = 'External'
                      AND g.Status <> 'Cancelled'
                      AND g.GameDateTime BETWEEN DATEADD(DAY, -30, SYSUTCDATETIME()) AND DATEADD(DAY, 30, SYSUTCDATETIME())
                ) THEN 1 ELSE 0 END",
                new { AdminUserId = adminUserId, TeamId = teamId });
        }

        /// <summary>
        /// SuperAdmin can access any user. OrgAdmin only users in their own organization.
        /// </summary>
        public async Task<bool> CanAdminAccessUserAsync(Guid adminUserId, string role, Guid targetUserId)
        {
            if (role == "SuperAdmin") return true;
            if (role != "OrgAdmin") return false;

            using var conn = _db.CreateConnection();
            return await conn.ExecuteScalarAsync<bool>(@"
                SELECT CASE WHEN EXISTS (
                    SELECT 1
                    FROM Users a
                    JOIN Users u ON u.OrganizationId = a.OrganizationId
                    WHERE a.Id = @AdminUserId AND u.Id = @TargetUserId AND a.OrganizationId IS NOT NULL
                ) THEN 1 ELSE 0 END",
                new { AdminUserId = adminUserId, TargetUserId = targetUserId });
        }

        /// <summary>
        /// Check if user (Coach/TeamManager) is assigned to the team.
        /// </summary>
        public async Task<bool> IsUserAssignedToTeamAsync(Guid userId, Guid teamId, ICoachTeamsService coachTeamsService)
        {
            try
            {
                var teams = await coachTeamsService.GetTeamsForCoachAsync(userId);
                return teams.Any(t => t.TeamId == teamId);
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Team IDs assigned to the user. Returns an empty set on failure (deny by default).
        /// </summary>
        public async Task<HashSet<Guid>> GetAssignedTeamIdsAsync(Guid userId, ICoachTeamsService coachTeamsService)
        {
            try
            {
                var teams = await coachTeamsService.GetTeamsForCoachAsync(userId);
                return teams.Select(t => t.TeamId).ToHashSet();
            }
            catch
            {
                return new HashSet<Guid>();
            }
        }

        /// <summary>
        /// Check if user can manage the specified team based on role and assignment.
        /// SuperAdmin/OrgAdmin can manage any team.
        /// Coach/TeamManager must be assigned to the team.
        /// </summary>
        public async Task<bool> CanUserManageTeamAsync(Guid userId, string role, Guid teamId, ICoachTeamsService coachTeamsService)
        {
            // SuperAdmin and OrgAdmin can manage all teams
            if (role == "SuperAdmin" || role == "OrgAdmin")
                return true;

            // Coach and TeamManager must be assigned to the team
            if (role == "Coach" || role == "TeamManager")
                return await IsUserAssignedToTeamAsync(userId, teamId, coachTeamsService);

            return false;
        }
    }
}
