using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TipInAPI.Infrastructure.Database.Migrations
{
    public partial class AddTeamTypeAndMascotToTeams : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
IF COL_LENGTH('dbo.Teams', 'TeamType') IS NULL
BEGIN
    ALTER TABLE dbo.Teams ADD TeamType NVARCHAR(20) NULL;
END;

IF COL_LENGTH('dbo.Teams', 'TeamMascot') IS NULL
BEGIN
    ALTER TABLE dbo.Teams ADD TeamMascot NVARCHAR(80) NULL;
END;

EXEC(N'
UPDATE t
SET TeamMascot = COALESCE(NULLIF(t.TeamMascot, ''''), o.Mascot)
FROM dbo.Teams t
LEFT JOIN dbo.Organizations o ON o.OrganizationId = t.OrganizationId
WHERE ISNULL(t.IsExternal, 0) = 0;

UPDATE dbo.Teams
SET TeamType = ''Co-Ed''
WHERE TeamType IS NULL OR LTRIM(RTRIM(TeamType)) = '''';
');

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Teams_OrgTypeLevelSeason_NotNullOrg' AND object_id = OBJECT_ID('dbo.Teams'))
BEGIN
    DROP INDEX UX_Teams_OrgTypeLevelSeason_NotNullOrg ON dbo.Teams;
END;

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Teams_OrgTypeLevelSeason_NullOrg' AND object_id = OBJECT_ID('dbo.Teams'))
BEGIN
    DROP INDEX UX_Teams_OrgTypeLevelSeason_NullOrg ON dbo.Teams;
END;

EXEC(N'
CREATE UNIQUE INDEX UX_Teams_OrgTypeLevelSeason_NotNullOrg
ON dbo.Teams (OrganizationId, TeamType, LevelId, SeasonId)
WHERE OrganizationId IS NOT NULL;

CREATE UNIQUE INDEX UX_Teams_OrgTypeLevelSeason_NullOrg
ON dbo.Teams (TeamType, LevelId, SeasonId)
WHERE OrganizationId IS NULL;
');
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Teams_OrgTypeLevelSeason_NotNullOrg' AND object_id = OBJECT_ID('dbo.Teams'))
BEGIN
    DROP INDEX UX_Teams_OrgTypeLevelSeason_NotNullOrg ON dbo.Teams;
END;

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Teams_OrgTypeLevelSeason_NullOrg' AND object_id = OBJECT_ID('dbo.Teams'))
BEGIN
    DROP INDEX UX_Teams_OrgTypeLevelSeason_NullOrg ON dbo.Teams;
END;

IF COL_LENGTH('dbo.Teams', 'TeamMascot') IS NOT NULL
BEGIN
    ALTER TABLE dbo.Teams DROP COLUMN TeamMascot;
END;

IF COL_LENGTH('dbo.Teams', 'TeamType') IS NOT NULL
BEGIN
    ALTER TABLE dbo.Teams DROP COLUMN TeamType;
END;
");
        }
    }
}
