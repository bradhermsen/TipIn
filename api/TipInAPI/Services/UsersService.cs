using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using TipInAPI.DTOs;
using TipInAPI.Models;
using TipInAPI.Repositories;
using TipInAPI.Infrastructure.Database;

namespace TipInAPI.Services
{
    public class UsersService : IUsersService
    {
        private readonly IUsersRepository _repo;
        private readonly ICoachTeamsRepository _coachTeamsRepository;
        private readonly IOrganizationRepository _orgRepo;
        private readonly ISqlConnectionFactory _connectionFactory;

        public UsersService(
            IUsersRepository repo,
            ICoachTeamsRepository coachTeamsRepository,
            IOrganizationRepository orgRepo,
            ISqlConnectionFactory connectionFactory)
        {
            _repo = repo;
            _coachTeamsRepository = coachTeamsRepository;
            _orgRepo = orgRepo;
            _connectionFactory = connectionFactory;
        }

        // ============================================================
        // GET ALL USERS (DTO for UI) — pass-through to repository
        // ============================================================
        public async Task<IEnumerable<UserListItemDto>> GetAllAsync()
        {
            return await _repo.GetAllUsersAsync();
        }

        // ============================================================
        // CREATE USER (Unified ID Model)
        // ============================================================
        public async Task<User> CreateUserAsync(
            string email,
            string password,
            string role,
            Guid? organizationId,
            string firstName,
            string lastName,
            List<Guid> teamIds)
        {
            await EnsureManagedOrganizationAsync(organizationId);

            var existing = await _repo.GetAuthUserByEmailAsync(email);
            if (existing != null)
                throw new InvalidOperationException("User already exists.");

            using var conn = _connectionFactory.CreateConnection();
            using var tx = conn.BeginTransaction();

            try
            {
                var userId = Guid.NewGuid();

                var authUser = new AuthUser
                {
                    Id = userId,
                    Email = email,
                    PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
                    Role = role,
                    IsActive = true,
                    CreatedAt = DateTime.UtcNow
                };

                var profile = new User
                {
                    Id = userId,
                    OrganizationId = organizationId,
                    FirstName = firstName,
                    LastName = lastName,
                    Email = email,
                    CreatedAt = DateTime.UtcNow
                };

                await _repo.CreateLinkedUserAsync(authUser, profile, conn, tx);

                if (teamIds != null)
                {
                    foreach (var teamId in teamIds)
                        await _coachTeamsRepository.AssignCoachToTeamAsync(userId, teamId, conn, tx);
                }

                tx.Commit();
                return profile;
            }
            catch
            {
                tx.Rollback();
                throw;
            }
        }

        // ============================================================
        // CREATE USER WITH HASH (OrgOwner)
        // ============================================================
        public async Task<User> CreateUserWithHashAsync(
            string email,
            string passwordHash,
            string role,
            Guid? organizationId,
            string firstName,
            string lastName,
            List<Guid> teamIds)
        {
            await EnsureManagedOrganizationAsync(organizationId);

            var existing = await _repo.GetAuthUserByEmailAsync(email);
            if (existing != null)
                throw new InvalidOperationException("User already exists.");

            using var conn = _connectionFactory.CreateConnection();
            using var tx = conn.BeginTransaction();

            try
            {
                var userId = Guid.NewGuid();

                var authUser = new AuthUser
                {
                    Id = userId,
                    Email = email,
                    PasswordHash = passwordHash,
                    Role = role,
                    IsActive = true,
                    CreatedAt = DateTime.UtcNow
                };

                var profile = new User
                {
                    Id = userId,
                    OrganizationId = organizationId,
                    FirstName = firstName,
                    LastName = lastName,
                    Email = email,
                    CreatedAt = DateTime.UtcNow
                };

                await _repo.CreateLinkedUserAsync(authUser, profile, conn, tx);

                if (teamIds != null)
                {
                    foreach (var teamId in teamIds)
                        await _coachTeamsRepository.AssignCoachToTeamAsync(userId, teamId, conn, tx);
                }

                tx.Commit();
                return profile;
            }
            catch
            {
                tx.Rollback();
                throw;
            }
        }

        // ============================================================
        // GET USER BY ID (DTO for Edit Modal)
        // ============================================================
        public async Task<UserListItemDto?> GetByIdAsync(Guid id)
        {
            return await _repo.GetUserByIdAsync(id);
        }

        // ============================================================
        // GET USER BY EMAIL
        // ============================================================
        public async Task<UserListItemDto?> GetByEmailAsync(string email)
        {
            var user = await _repo.GetUserByEmailAsync(email);
            if (user == null)
                return null;

            return await GetByIdAsync(user.Id);
        }

        // ============================================================
        // UPDATE USER (Unified ID Model)
        // ============================================================
        public async Task UpdateUserAsync(
            Guid id,
            string email,
            string firstName,
            string lastName,
            Guid? organizationId,
            string role,
            bool isActive,
            string? password,
            List<Guid> teamIds)
        {
            await EnsureManagedOrganizationAsync(organizationId);

            using var conn = _connectionFactory.CreateConnection();
            using var tx = conn.BeginTransaction();

            try
            {
                await _repo.UpdateLinkedUserAsync(
                    id,
                    email,
                    firstName,
                    lastName,
                    organizationId,
                    role,
                    isActive,
                    password,
                    conn,
                    tx
                );

                // Reset team assignments
                var existingTeams = await _coachTeamsRepository.GetTeamsForCoachAsync(id, conn, tx);
                foreach (var t in existingTeams)
                    await _coachTeamsRepository.RemoveAsync(id, t.TeamId, conn, tx);

                foreach (var teamId in teamIds)
                    await _coachTeamsRepository.AssignCoachToTeamAsync(id, teamId, conn, tx);

                tx.Commit();
            }
            catch
            {
                tx.Rollback();
                throw;
            }
        }

        // ============================================================
        // RESET PASSWORD
        // ============================================================
        public async Task ResetPasswordAsync(Guid id, string newPassword)
        {
            var hash = BCrypt.Net.BCrypt.HashPassword(newPassword);
            await _repo.UpdatePasswordHashAsync(id, hash);
        }

        private async Task EnsureManagedOrganizationAsync(Guid? organizationId)
        {
            if (!organizationId.HasValue)
            {
                return;
            }

            var organization = await _orgRepo.GetByIdAsync(organizationId.Value);
            if (organization == null)
            {
                throw new ArgumentException("Selected organization was not found.");
            }

            if (!string.Equals(organization.OrganizationType, "Managed", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("Portal users can only be assigned to Managed Organizations.");
            }
        }

        // ============================================================
        // DELETE USER
        // ============================================================
        public async Task DeleteUserAsync(Guid id)
        {
            await _repo.DeleteLinkedUserAsync(id);
        }
    }
}
