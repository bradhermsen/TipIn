using System;
using System.Collections.Generic;
using System.Data;
using System.Threading.Tasks;
using TipInAPI.DTOs;
using TipInAPI.Models;

namespace TipInAPI.Repositories
{
    public interface IUsersRepository
    {
        // CREATE
        Task CreateLinkedUserAsync(AuthUser auth, User profile);
        Task CreateLinkedUserAsync(AuthUser auth, User profile, IDbConnection conn, IDbTransaction tx);

        // UPDATE
        Task UpdateLinkedUserAsync(
            Guid id,
            string email,
            string firstName,
            string lastName,
            Guid? organizationId,
            string role,
            bool isActive,
            string? password);

        Task UpdateLinkedUserAsync(
            Guid id,
            string email,
            string firstName,
            string lastName,
            Guid? organizationId,
            string role,
            bool isActive,
            string? password,
            IDbConnection conn,
            IDbTransaction tx);

        // READ
        Task<IEnumerable<UserListItemDto>> GetAllUsersAsync();
        Task<UserListItemDto?> GetUserByIdAsync(Guid id);
        Task<User?> GetUserByEmailAsync(string email);
        Task<AuthUser?> GetAuthUserByEmailAsync(string email);
        Task<string?> GetEmailByUserIdAsync(Guid id);
     
        // PASSWORD
        Task UpdatePasswordHashAsync(Guid id, string passwordHash);

        // DELETE
        Task DeleteLinkedUserAsync(Guid id);
    }
}
