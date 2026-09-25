using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using TipInAPI.DTOs;
using TipInAPI.Repositories;

namespace TipInAPI.Services
{
    public class CoachTeamsService : ICoachTeamsService
    {
        private readonly ICoachTeamsRepository _repo;

        public CoachTeamsService(ICoachTeamsRepository repo)
        {
            _repo = repo;
        }

        public Task AssignAsync(Guid userId, Guid teamId)
        {
            return _repo.AssignCoachToTeamAsync(userId, teamId);
        }

        public Task RemoveAsync(Guid userId, Guid teamId)
        {
            return _repo.RemoveAsync(userId, teamId);
        }

        public Task<IEnumerable<CoachTeamDetailDto>> GetTeamsForCoachAsync(Guid userId)
        {
            return _repo.GetTeamsForCoachAsync(userId);
        }

        public Task<IEnumerable<CoachTeamDetailDto>> GetCoachesForTeamAsync(Guid teamId)
        {
            return _repo.GetCoachesForTeamAsync(teamId);
        }
    }
}
