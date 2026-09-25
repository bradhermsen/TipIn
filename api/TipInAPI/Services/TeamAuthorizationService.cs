using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace TipInAPI.Services
{
    public interface ITeamAuthorizationService
    {
        Task<bool> IsUserAssignedToTeamAsync(Guid userId, Guid teamId, ICoachTeamsService coachTeamsService);
        Task<bool> CanUserManageTeamAsync(Guid userId, string role, Guid teamId, ICoachTeamsService coachTeamsService);
    }

    public class TeamAuthorizationService : ITeamAuthorizationService
    {
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
