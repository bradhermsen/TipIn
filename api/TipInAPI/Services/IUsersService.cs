using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using TipInAPI.DTOs;
using TipInAPI.Models;

namespace TipInAPI.Services
{
    public interface IUsersService
    {
        // CREATE
        Task<User> CreateUserAsync(
            string email,
            string password,
            string role,
            Guid? organizationId,
            string firstName,
            string lastName,
            List<Guid> teamIds);

        Task<User> CreateUserWithHashAsync(
            string email,
            string passwordHash,
            string role,
            Guid? organizationId,
            string firstName,
            string lastName,
            List<Guid> teamIds);

        // READ (DTOs for UI)
        Task<IEnumerable<UserListItemDto>> GetAllAsync();
        Task<UserListItemDto?> GetByIdAsync(Guid id);
        Task<UserListItemDto?> GetByEmailAsync(string email);

        // UPDATE
        Task UpdateUserAsync(
            Guid id,
            string email,
            string firstName,
            string lastName,
            Guid? organizationId,
            string role,
            bool isActive,
            string? password,
            List<Guid> teamIds);

        // PASSWORD
        Task ResetPasswordAsync(Guid id, string newPassword);

        // DELETE
        Task DeleteUserAsync(Guid id);
    }
}
