IF OBJECT_ID(N'dbo.Seasons', N'U') IS NULL OR OBJECT_ID(N'dbo.Organizations', N'U') IS NULL
    THROW 50000, 'Seasons and Organizations must exist before creating SeasonOrganizations.', 1;

IF OBJECT_ID(N'dbo.SeasonOrganizations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SeasonOrganizations
    (
        SeasonId UNIQUEIDENTIFIER NOT NULL,
        OrganizationId UNIQUEIDENTIFIER NOT NULL,
        ParticipationType NVARCHAR(20) NOT NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_SeasonOrganizations_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_SeasonOrganizations_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_SeasonOrganizations PRIMARY KEY (SeasonId, OrganizationId),
        CONSTRAINT FK_SeasonOrganizations_Seasons FOREIGN KEY (SeasonId) REFERENCES dbo.Seasons(SeasonId) ON DELETE CASCADE,
        CONSTRAINT FK_SeasonOrganizations_Organizations FOREIGN KEY (OrganizationId) REFERENCES dbo.Organizations(OrganizationId),
        CONSTRAINT CK_SeasonOrganizations_ParticipationType CHECK (ParticipationType IN ('Managed', 'External', 'NotParticipating'))
    );
END;

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_SeasonOrganizations_Organization'
      AND object_id = OBJECT_ID(N'dbo.SeasonOrganizations')
)
    CREATE INDEX IX_SeasonOrganizations_Organization
        ON dbo.SeasonOrganizations (OrganizationId, SeasonId);

INSERT INTO dbo.SeasonOrganizations
(
    SeasonId,
    OrganizationId,
    ParticipationType,
    CreatedAt,
    UpdatedAt
)
SELECT DISTINCT
    t.SeasonId,
    o.OrganizationId,
    CASE
        WHEN LOWER(LTRIM(RTRIM(o.Name))) IN ('external', 'external team') THEN 'External'
        ELSE 'Managed'
    END,
    SYSUTCDATETIME(),
    SYSUTCDATETIME()
FROM dbo.Teams t
INNER JOIN dbo.Organizations o ON o.OrganizationId = t.OrganizationId
WHERE NOT EXISTS
(
    SELECT 1
    FROM dbo.SeasonOrganizations so
    WHERE so.SeasonId = t.SeasonId
      AND so.OrganizationId = t.OrganizationId
);
