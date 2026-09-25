using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using TipInAPI.DTOs;
using TipInAPI.Repositories;
using TipInAPI.Models;

namespace TipInAPI.Services
{
    public class OrganizationService : IOrganizationService
    {
        private readonly IOrganizationRepository _repo;
        private readonly IUsersService _usersService;

        public OrganizationService(
            IOrganizationRepository repo,
            IUsersService usersService)
        {
            _repo = repo;
            _usersService = usersService;
        }

        public Task<IEnumerable<OrganizationListItemDto>> GetAllAsync()
            => _repo.GetAllAsync();

        public Task<OrganizationDto?> GetByIdAsync(Guid id)
            => _repo.GetByIdAsync(id);

        // ⭐ Returns full Organization
        public async Task<Organization> CreateAsync(CreateOrganizationDto dto)
        {
            var org = new Organization
            {
                Id = Guid.NewGuid(),
                LeagueId = dto.LeagueId,
                Name = dto.Name,
                Abbreviation = dto.Abbreviation,

                StreetAddress = dto.StreetAddress,
                City = dto.City,
                State = dto.State,
                ZipCode = dto.ZipCode,
                Country = dto.Country,

                BillingStreetAddress = dto.BillingStreetAddress,
                BillingCity = dto.BillingCity,
                BillingState = dto.BillingState,
                BillingZipCode = dto.BillingZipCode,
                BillingContactName = dto.BillingContactName,
                BillingContactEmail = dto.BillingContactEmail,

                PrimaryContactFirstName = dto.PrimaryContactFirstName,
                PrimaryContactLastName = dto.PrimaryContactLastName,
                PrimaryContactEmail = dto.PrimaryContactEmail,

                DistrictConference = dto.DistrictConference,
                Mascot = dto.Mascot,
                OrganizationType = NormalizeOrganizationType(dto.OrganizationType),
                IsActive = dto.IsActive,

                CreatedAt = DateTime.UtcNow
            };

            await _repo.CreateAsync(org);
            return org;
        }

        // ⭐ Auto-create OrgOwner
        public async Task CreateOrgOwnerForOrganizationAsync(Organization org)
        {
            if (!string.Equals(org.OrganizationType, "Managed", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            var tempPassword = "TipIn2024!";
            var hash = BCrypt.Net.BCrypt.HashPassword(tempPassword, 10);

            await _usersService.CreateUserWithHashAsync(
                org.PrimaryContactEmail,
                hash,
                "OrgOwner",
                org.Id,
                org.PrimaryContactFirstName ?? "",
                org.PrimaryContactLastName ?? "",
                new List<Guid>() // OrgOwner has no team assignments
            );
        }

        public Task UpdateAsync(Guid id, UpdateOrganizationDto dto)
        {
            dto.OrganizationType = NormalizeOrganizationType(dto.OrganizationType);
            return _repo.UpdateAsync(id, dto);
        }

        public Task DeleteAsync(Guid id)
            => _repo.DeleteAsync(id);

        private static string NormalizeOrganizationType(string? organizationType)
        {
            return string.Equals(organizationType?.Trim(), "External", StringComparison.OrdinalIgnoreCase)
                ? "External"
                : "Managed";
        }
    }
}
