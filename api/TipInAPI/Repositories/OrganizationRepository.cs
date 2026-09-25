using System;
using System.Collections.Generic;
using System.Data;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.DTOs;
using TipInAPI.Models;

namespace TipInAPI.Repositories
{
    public class OrganizationRepository : IOrganizationRepository
    {
        private readonly IDbConnection _db;

        public OrganizationRepository(IDbConnection db)
        {
            _db = db;
        }

        // ============================================================
        // GET ALL
        // ============================================================
        public async Task<IEnumerable<OrganizationListItemDto>> GetAllAsync()
        {
            var sql = @"
SELECT 
    o.OrganizationId,
    o.Name,
    o.Abbreviation,
    o.City,
    o.State,
    o.Country,
    o.StreetAddress,
    o.ZipCode,
    o.Mascot,
    o.OrganizationType,
    o.LeagueId,
    l.Name AS LeagueName,
    COUNT(t.Id) AS TeamCount,
    o.PrimaryContactFirstName,
    o.PrimaryContactLastName,
    o.PrimaryContactEmail,
    o.IsActive,
    o.CreatedAt,
    o.UpdatedAt
FROM Organizations o
LEFT JOIN Leagues l ON o.LeagueId = l.Id
LEFT JOIN Teams t ON t.OrganizationId = o.OrganizationId
GROUP BY 
    o.OrganizationId,
    o.Name,
    o.Abbreviation,
    o.City,
    o.State,
    o.Country,
    o.StreetAddress,
    o.ZipCode,
    o.Mascot,
    o.OrganizationType,
    o.LeagueId,
    l.Name,
    o.PrimaryContactFirstName,
    o.PrimaryContactLastName,
    o.PrimaryContactEmail,
    o.IsActive,
    o.CreatedAt,
    o.UpdatedAt
ORDER BY o.Name ASC;
";

            return await _db.QueryAsync<OrganizationListItemDto>(sql);
        }

        // ============================================================
        // GET BY ID
        // ============================================================
        public async Task<OrganizationDto?> GetByIdAsync(Guid id)
        {
            var sql = @"
SELECT 
    o.OrganizationId,
    o.Name,
    o.Abbreviation,
    o.City,
    o.State,
    o.Country,
    o.StreetAddress,
    o.ZipCode,
    o.Mascot,
    o.OrganizationType,
    o.LeagueId,
    o.PrimaryContactFirstName,
    o.PrimaryContactLastName,
    o.PrimaryContactEmail,
    o.BillingStreetAddress,
    o.BillingCity,
    o.BillingState,
    o.BillingZipCode,
    o.BillingContactName,
    o.BillingContactEmail,
    o.IsActive,
    o.CreatedAt,
    o.UpdatedAt
FROM Organizations o
WHERE o.OrganizationId = @Id;
";

            return await _db.QueryFirstOrDefaultAsync<OrganizationDto>(sql, new { Id = id });
        }

        // ============================================================
        // CREATE (now accepts full Organization model)
        // ============================================================
        public async Task CreateAsync(Organization org)
        {
            var sql = @"
SET XACT_ABORT ON;
BEGIN TRANSACTION;

INSERT INTO Organizations (
    OrganizationId,
    Name,
    Abbreviation,
    City,
    State,
    Country,
    StreetAddress,
    ZipCode,
    Mascot,
    OrganizationType,
    LeagueId,
    PrimaryContactFirstName,
    PrimaryContactLastName,
    PrimaryContactEmail,
    BillingStreetAddress,
    BillingCity,
    BillingState,
    BillingZipCode,
    BillingContactName,
    BillingContactEmail,
    IsActive,
    CreatedAt,
    UpdatedAt
)
VALUES (
    @OrganizationId,
    @Name,
    @Abbreviation,
    @City,
    @State,
    @Country,
    @StreetAddress,
    @ZipCode,
    @Mascot,
    @OrganizationType,
    @LeagueId,
    @PrimaryContactFirstName,
    @PrimaryContactLastName,
    @PrimaryContactEmail,
    @BillingStreetAddress,
    @BillingCity,
    @BillingState,
    @BillingZipCode,
    @BillingContactName,
    @BillingContactEmail,
    @IsActive,
    GETUTCDATE(),
    GETUTCDATE()
);

IF OBJECT_ID(N'dbo.SeasonOrganizations', N'U') IS NOT NULL
BEGIN
    INSERT INTO dbo.SeasonOrganizations
    (
        SeasonId,
        OrganizationId,
        ParticipationType,
        CreatedAt,
        UpdatedAt
    )
    SELECT
        s.SeasonId,
        @OrganizationId,
        @OrganizationType,
        SYSUTCDATETIME(),
        SYSUTCDATETIME()
    FROM dbo.Seasons s
    WHERE s.IsActive = 1
      AND NOT EXISTS
      (
          SELECT 1
          FROM dbo.SeasonOrganizations so
          WHERE so.SeasonId = s.SeasonId
            AND so.OrganizationId = @OrganizationId
      );
END;

COMMIT TRANSACTION;
";

            await _db.ExecuteAsync(sql, new
            {
                OrganizationId = org.Id,
                org.Name,
                org.Abbreviation,
                org.City,
                org.State,
                org.Country,
                org.StreetAddress,
                org.ZipCode,
                org.Mascot,
                org.OrganizationType,
                org.LeagueId,
                org.PrimaryContactFirstName,
                org.PrimaryContactLastName,
                org.PrimaryContactEmail,
                org.BillingStreetAddress,
                org.BillingCity,
                org.BillingState,
                org.BillingZipCode,
                org.BillingContactName,
                org.BillingContactEmail,
                org.IsActive
            });
        }

        // ============================================================
        // UPDATE
        // ============================================================
        public async Task UpdateAsync(Guid id, UpdateOrganizationDto dto)
        {
            var sql = @"
SET XACT_ABORT ON;
BEGIN TRANSACTION;

UPDATE Organizations
SET
    Name = @Name,
    Abbreviation = @Abbreviation,
    City = @City,
    State = @State,
    Country = @Country,
    StreetAddress = @StreetAddress,
    ZipCode = @ZipCode,
    Mascot = @Mascot,
    OrganizationType = @OrganizationType,
    LeagueId = @LeagueId,
    PrimaryContactFirstName = @PrimaryContactFirstName,
    PrimaryContactLastName = @PrimaryContactLastName,
    PrimaryContactEmail = @PrimaryContactEmail,
    BillingStreetAddress = @BillingStreetAddress,
    BillingCity = @BillingCity,
    BillingState = @BillingState,
    BillingZipCode = @BillingZipCode,
    BillingContactName = @BillingContactName,
    BillingContactEmail = @BillingContactEmail,
    IsActive = @IsActive,
    UpdatedAt = GETUTCDATE()
WHERE OrganizationId = @Id;

IF OBJECT_ID(N'dbo.SeasonOrganizations', N'U') IS NOT NULL
BEGIN
    UPDATE dbo.SeasonOrganizations
    SET ParticipationType = CASE
            WHEN ParticipationType = N'NotParticipating' THEN N'NotParticipating'
            ELSE @OrganizationType
        END,
        UpdatedAt = SYSUTCDATETIME()
    WHERE OrganizationId = @Id;
END;

UPDATE dbo.Teams
SET IsExternal = CASE WHEN @OrganizationType = N'External' THEN 1 ELSE 0 END,
    ScorekeeperCode = CASE WHEN @OrganizationType = N'External' THEN NULL ELSE ScorekeeperCode END,
    StatManagerCode = CASE WHEN @OrganizationType = N'External' THEN NULL ELSE StatManagerCode END
WHERE OrganizationId = @Id;

COMMIT TRANSACTION;
";

            await _db.ExecuteAsync(sql, new
            {
                Id = id,
                dto.Name,
                dto.Abbreviation,
                dto.City,
                dto.State,
                dto.Country,
                dto.StreetAddress,
                dto.ZipCode,
                dto.Mascot,
                dto.OrganizationType,
                dto.LeagueId,
                dto.PrimaryContactFirstName,
                dto.PrimaryContactLastName,
                dto.PrimaryContactEmail,
                dto.BillingStreetAddress,
                dto.BillingCity,
                dto.BillingState,
                dto.BillingZipCode,
                dto.BillingContactName,
                dto.BillingContactEmail,
                dto.IsActive
            });
        }

        // ============================================================
        // DELETE
        // ============================================================
        public async Task DeleteAsync(Guid id)
        {
            var sql = @"DELETE FROM Organizations WHERE OrganizationId = @Id;";
            await _db.ExecuteAsync(sql, new { Id = id });
        }
    }
}
