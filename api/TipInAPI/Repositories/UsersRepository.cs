using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.Infrastructure.Database;
using TipInAPI.Models;
using TipInAPI.DTOs;
using TipInAPI.Repositories;

namespace TipInAPI.Repositories
{
    public class UsersRepository : IUsersRepository
    {
        private readonly ISqlConnectionFactory _db;
        private readonly ICoachTeamsRepository _coachTeamsRepository;

        public UsersRepository(
            ISqlConnectionFactory db,
            ICoachTeamsRepository coachTeamsRepository)
        {
            _db = db;
            _coachTeamsRepository = coachTeamsRepository;
        }

        // ============================================================
        // CREATE (standalone)
        // ============================================================
        public async Task CreateLinkedUserAsync(AuthUser auth, User profile)
        {
            using var conn = _db.CreateConnection();
            using var tx = conn.BeginTransaction();

            await CreateLinkedUserAsync(auth, profile, conn, tx);

            tx.Commit();
        }

        // ============================================================
        // CREATE (transactional)
        // ============================================================
        public async Task CreateLinkedUserAsync(AuthUser auth, User profile, IDbConnection conn, IDbTransaction tx)
        {
            const string sqlAuth = @"
                INSERT INTO AuthUsers (Id, Email, PasswordHash, Role, IsActive, CreatedAt)
                VALUES (@Id, @Email, @PasswordHash, @Role, @IsActive, @CreatedAt);";

            const string sqlUser = @"
                INSERT INTO Users (Id, OrganizationId, FirstName, LastName, Email, CreatedAt)
                VALUES (@Id, @OrganizationId, @FirstName, @LastName, @Email, @CreatedAt);";

            await conn.ExecuteAsync(sqlAuth, auth, tx);
            await conn.ExecuteAsync(sqlUser, profile, tx);
        }

        // ============================================================
        // UPDATE (standalone)
        // ============================================================
        public async Task UpdateLinkedUserAsync(
            Guid id,
            string email,
            string firstName,
            string lastName,
            Guid? organizationId,
            string role,
            bool isActive,
            string? password)
        {
            using var conn = _db.CreateConnection();
            using var tx = conn.BeginTransaction();

            await UpdateLinkedUserAsync(id, email, firstName, lastName, organizationId, role, isActive, password, conn, tx);

            tx.Commit();
        }

        // ============================================================
        // UPDATE (transactional)
        // ============================================================
        public async Task UpdateLinkedUserAsync(
            Guid id,
            string email,
            string firstName,
            string lastName,
            Guid? organizationId,
            string role,
            bool isActive,
            string? password,
            IDbConnection conn,
            IDbTransaction tx)
        {
            const string sqlGetEmail = @"SELECT Email FROM Users WHERE Id = @Id;";
            var originalEmail = await conn.ExecuteScalarAsync<string>(sqlGetEmail, new { Id = id }, tx);

            if (originalEmail == null)
                throw new InvalidOperationException("User not found.");

            const string sqlUser = @"
                UPDATE Users
                SET FirstName = @FirstName,
                    LastName = @LastName,
                    OrganizationId = @OrganizationId,
                    Email = @Email
                WHERE Id = @Id;";

            await conn.ExecuteAsync(sqlUser, new
            {
                Id = id,
                FirstName = firstName,
                LastName = lastName,
                OrganizationId = organizationId,
                Email = email
            }, tx);

            const string sqlAuth = @"
                UPDATE AuthUsers
                SET Email = @NewEmail,
                    Role = @Role,
                    IsActive = @IsActive
                WHERE Id = @Id;";

            await conn.ExecuteAsync(sqlAuth, new
            {
                Id = id,
                NewEmail = email,
                Role = role,
                IsActive = isActive
            }, tx);

            if (!string.IsNullOrWhiteSpace(password))
            {
                const string sqlPass = @"
                    UPDATE AuthUsers
                    SET PasswordHash = @PasswordHash
                    WHERE Id = @Id;";

                await conn.ExecuteAsync(sqlPass, new
                {
                    Id = id,
                    PasswordHash = BCrypt.Net.BCrypt.HashPassword(password)
                }, tx);
            }
        }

        // ============================================================
        // GET ALL USERS (DTO)
        // ============================================================
        public async Task<IEnumerable<UserListItemDto>> GetAllUsersAsync()
        {
            using var conn = _db.CreateConnection();

            var sql = @"
                SELECT
                    u.Id,
                    u.OrganizationId,
                    u.FirstName,
                    u.LastName,
                    u.Email,
                    u.CreatedAt,

                    au.Role,
                    au.IsActive,

                    o.Name AS OrganizationName,

                    t.Id AS TeamId,
                    t.Name AS TeamName,
                    t.Abbreviation,
                    t.LevelId,
                    l.Name AS LevelName,
                    t.TeamType

                FROM Users u
                LEFT JOIN AuthUsers au ON au.Id = u.Id
                LEFT JOIN Organizations o ON o.OrganizationId = u.OrganizationId
                LEFT JOIN CoachTeams ct ON ct.UserId = u.Id
                LEFT JOIN Teams t ON t.Id = ct.TeamId
                LEFT JOIN Levels l ON l.Id = t.LevelId

                ORDER BY u.LastName, u.FirstName;
            ";

            var lookup = new Dictionary<Guid, UserListItemDto>();

            await conn.QueryAsync<UserListItemDto, TeamSummaryDto, UserListItemDto>(
                sql,
                (user, team) =>
                {
                    if (!lookup.TryGetValue(user.Id, out var dto))
                    {
                        dto = user;
                        dto.Teams = new List<TeamSummaryDto>();
                        lookup.Add(dto.Id, dto);
                    }

                    if (team != null && team.TeamId != Guid.Empty)
                        dto.Teams.Add(team);

                    return dto;
                },
                splitOn: "TeamId"
            );

            var users = lookup.Values.ToList();

            foreach (var user in users)
            {
                if (user.Role == "Admin")
                {
                    user.Teams = new List<TeamSummaryDto>();
                    continue;
                }

                if (user.Role == "OrgOwner" && user.OrganizationId != null)
                {
                    var orgTeams = await conn.QueryAsync<TeamSummaryDto>(
                        @"SELECT 
                            Id AS TeamId,
                            Name AS TeamName,
                            Abbreviation,
                            LevelId,
                            (SELECT Name FROM Levels WHERE Id = LevelId) AS LevelName,
                            TeamType
                        FROM Teams
                        WHERE OrganizationId = @OrgId;",
                        new { OrgId = user.OrganizationId }
                    );

                    user.Teams = orgTeams.ToList();
                    continue;
                }
            }

            return users;
        }

        // ============================================================
        // GET USER BY ID (DTO)
        // ============================================================
        public async Task<UserListItemDto?> GetUserByIdAsync(Guid id)
        {
            using var conn = _db.CreateConnection();

            var sql = @"
                SELECT
                    u.Id,
                    u.OrganizationId,
                    u.FirstName,
                    u.LastName,
                    u.Email,
                    u.CreatedAt,

                    au.Role,
                    au.IsActive,

                    o.Name AS OrganizationName,

                    t.Id AS TeamId,
                    t.Name AS TeamName,
                    t.Abbreviation,
                    t.LevelId,
                    l.Name AS LevelName,
                    t.TeamType

                FROM Users u
                LEFT JOIN AuthUsers au ON au.Id = u.Id
                LEFT JOIN Organizations o ON o.OrganizationId = u.OrganizationId
                LEFT JOIN CoachTeams ct ON ct.UserId = u.Id
                LEFT JOIN Teams t ON t.Id = ct.TeamId
                LEFT JOIN Levels l ON l.Id = t.LevelId
                WHERE u.Id = @Id;
            ";

            var lookup = new Dictionary<Guid, UserListItemDto>();

            await conn.QueryAsync<UserListItemDto, TeamSummaryDto, UserListItemDto>(
                sql,
                (user, team) =>
                {
                    if (!lookup.TryGetValue(user.Id, out var dto))
                    {
                        dto = user;
                        dto.Teams = new List<TeamSummaryDto>();
                        lookup.Add(dto.Id, dto);
                    }

                    if (team != null && team.TeamId != Guid.Empty)
                        dto.Teams.Add(team);

                    return dto;
                },
                new { Id = id },
                splitOn: "TeamId"
            );

            return lookup.Values.FirstOrDefault();
        }

        // ============================================================
        // GET USER BY EMAIL
        // ============================================================
        public async Task<User?> GetUserByEmailAsync(string email)
        {
            using var conn = _db.CreateConnection();
            return await conn.QueryFirstOrDefaultAsync<User>(
                "SELECT * FROM Users WHERE Email = @Email;",
                new { Email = email }
            );
        }

        public async Task<AuthUser?> GetAuthUserByEmailAsync(string email)
        {
            using var conn = _db.CreateConnection();
            return await conn.QueryFirstOrDefaultAsync<AuthUser>(
                "SELECT * FROM AuthUsers WHERE Email = @Email;",
                new { Email = email }
            );
        }

        public async Task<string?> GetEmailByUserIdAsync(Guid id)
        {
            using var conn = _db.CreateConnection();
            return await conn.ExecuteScalarAsync<string?>(
                "SELECT Email FROM Users WHERE Id = @Id;",
                new { Id = id }
            );
        }

        public async Task UpdatePasswordHashAsync(Guid id, string passwordHash)
        {
            using var conn = _db.CreateConnection();
            await conn.ExecuteAsync(
                "UPDATE AuthUsers SET PasswordHash = @Hash WHERE Id = @Id;",
                new { Id = id, Hash = passwordHash }
            );
        }

        // ============================================================
        // DELETE USER (Unified ID Model)
        // ============================================================
        public async Task DeleteLinkedUserAsync(Guid id)
        {
            using var conn = _db.CreateConnection();
            using var tx = conn.BeginTransaction();

            await conn.ExecuteAsync(
                @"DELETE FROM CoachTeams WHERE UserId = @Id;",
                new { Id = id }, tx);

            await conn.ExecuteAsync(
                @"DELETE FROM Users WHERE Id = @Id;",
                new { Id = id }, tx);

            await conn.ExecuteAsync(
                @"DELETE FROM AuthUsers WHERE Id = @Id;",
                new { Id = id }, tx);

            tx.Commit();
        }
    }
}
