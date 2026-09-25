using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TipInAPI.Infrastructure.Database.Migrations
{
    public partial class AddManagedFacilities : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
IF OBJECT_ID('dbo.Arenas', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Arenas (
        ArenaId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Arenas PRIMARY KEY,
        Name NVARCHAR(200) NOT NULL,
        StreetAddress NVARCHAR(200) NULL,
        City NVARCHAR(100) NULL,
        State NVARCHAR(50) NULL,
        PostalCode NVARCHAR(20) NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_Arenas_IsActive DEFAULT (1),
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Arenas_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_Arenas_UpdatedAt DEFAULT (SYSUTCDATETIME())
    );
END;

IF OBJECT_ID('dbo.ArenaOrganizations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ArenaOrganizations (
        ArenaId UNIQUEIDENTIFIER NOT NULL,
        OrganizationId UNIQUEIDENTIFIER NOT NULL,
        AccessLevel NVARCHAR(20) NOT NULL,
        IsPrimary BIT NOT NULL CONSTRAINT DF_ArenaOrganizations_IsPrimary DEFAULT (0),
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ArenaOrganizations_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_ArenaOrganizations PRIMARY KEY (ArenaId, OrganizationId),
        CONSTRAINT FK_ArenaOrganizations_Arenas FOREIGN KEY (ArenaId) REFERENCES dbo.Arenas(ArenaId),
        CONSTRAINT FK_ArenaOrganizations_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(OrganizationId),
        CONSTRAINT CK_ArenaOrganizations_AccessLevel CHECK (AccessLevel IN ('Manage', 'Use'))
    );
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ArenaOrganizations_Organization' AND object_id = OBJECT_ID('dbo.ArenaOrganizations'))
    CREATE INDEX IX_ArenaOrganizations_Organization ON dbo.ArenaOrganizations(OrganizationId, ArenaId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_ArenaOrganizations_Primary' AND object_id = OBJECT_ID('dbo.ArenaOrganizations'))
    CREATE UNIQUE INDEX UX_ArenaOrganizations_Primary ON dbo.ArenaOrganizations(OrganizationId) WHERE IsPrimary = 1;

IF OBJECT_ID('dbo.Rinks', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Rinks (
        RinkId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Rinks PRIMARY KEY,
        ArenaId UNIQUEIDENTIFIER NOT NULL,
        Name NVARCHAR(150) NOT NULL,
        DisplayOrder INT NOT NULL CONSTRAINT DF_Rinks_DisplayOrder DEFAULT (0),
        IsActive BIT NOT NULL CONSTRAINT DF_Rinks_IsActive DEFAULT (1),
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Rinks_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_Rinks_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT FK_Rinks_Arenas FOREIGN KEY (ArenaId) REFERENCES dbo.Arenas(ArenaId)
    );
    CREATE UNIQUE INDEX UX_Rinks_Arena_Name ON dbo.Rinks(ArenaId, Name);
END;

IF OBJECT_ID('dbo.ScoreboardGateways', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ScoreboardGateways (
        GatewayId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_ScoreboardGateways PRIMARY KEY,
        RinkId UNIQUEIDENTIFIER NOT NULL,
        Name NVARCHAR(150) NOT NULL,
        DeviceMacAddress NVARCHAR(50) NOT NULL,
        Host NVARCHAR(255) NOT NULL,
        Port INT NOT NULL,
        WebSocketSecretEncrypted NVARCHAR(1000) NOT NULL,
        IsPrimary BIT NOT NULL CONSTRAINT DF_ScoreboardGateways_IsPrimary DEFAULT (1),
        IsActive BIT NOT NULL CONSTRAINT DF_ScoreboardGateways_IsActive DEFAULT (1),
        LastSeenAt DATETIME2 NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ScoreboardGateways_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_ScoreboardGateways_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT FK_ScoreboardGateways_Rinks FOREIGN KEY (RinkId) REFERENCES dbo.Rinks(RinkId),
        CONSTRAINT CK_ScoreboardGateways_Port CHECK (Port BETWEEN 1 AND 65535)
    );
    CREATE UNIQUE INDEX UX_ScoreboardGateways_Mac ON dbo.ScoreboardGateways(DeviceMacAddress);
    CREATE UNIQUE INDEX UX_ScoreboardGateways_PrimaryPerRink
        ON dbo.ScoreboardGateways(RinkId)
        WHERE IsPrimary = 1 AND IsActive = 1;
END;

IF COL_LENGTH('dbo.Games', 'ArenaId') IS NULL ALTER TABLE dbo.Games ADD ArenaId UNIQUEIDENTIFIER NULL;
IF COL_LENGTH('dbo.Games', 'RinkId') IS NULL ALTER TABLE dbo.Games ADD RinkId UNIQUEIDENTIFIER NULL;
IF COL_LENGTH('dbo.Games', 'VenueAddress') IS NULL ALTER TABLE dbo.Games ADD VenueAddress NVARCHAR(300) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Games_Arenas')
    ALTER TABLE dbo.Games ADD CONSTRAINT FK_Games_Arenas FOREIGN KEY (ArenaId) REFERENCES dbo.Arenas(ArenaId);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Games_Rinks')
    ALTER TABLE dbo.Games ADD CONSTRAINT FK_Games_Rinks FOREIGN KEY (RinkId) REFERENCES dbo.Rinks(RinkId);
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Games_Rinks') ALTER TABLE dbo.Games DROP CONSTRAINT FK_Games_Rinks;
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Games_Arenas') ALTER TABLE dbo.Games DROP CONSTRAINT FK_Games_Arenas;
IF COL_LENGTH('dbo.Games', 'VenueAddress') IS NOT NULL ALTER TABLE dbo.Games DROP COLUMN VenueAddress;
IF COL_LENGTH('dbo.Games', 'RinkId') IS NOT NULL ALTER TABLE dbo.Games DROP COLUMN RinkId;
IF COL_LENGTH('dbo.Games', 'ArenaId') IS NOT NULL ALTER TABLE dbo.Games DROP COLUMN ArenaId;
IF OBJECT_ID('dbo.ScoreboardGateways', 'U') IS NOT NULL DROP TABLE dbo.ScoreboardGateways;
IF OBJECT_ID('dbo.Rinks', 'U') IS NOT NULL DROP TABLE dbo.Rinks;
IF OBJECT_ID('dbo.ArenaOrganizations', 'U') IS NOT NULL DROP TABLE dbo.ArenaOrganizations;
IF OBJECT_ID('dbo.Arenas', 'U') IS NOT NULL DROP TABLE dbo.Arenas;
");
        }
    }
}