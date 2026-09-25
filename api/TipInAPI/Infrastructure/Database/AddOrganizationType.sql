IF OBJECT_ID(N'dbo.Organizations', N'U') IS NULL
    THROW 50000, 'Organizations table is required.', 1;

IF COL_LENGTH(N'dbo.Organizations', N'OrganizationType') IS NULL
BEGIN
    ALTER TABLE dbo.Organizations
    ADD OrganizationType NVARCHAR(20) NOT NULL
        CONSTRAINT DF_Organizations_OrganizationType DEFAULT (N'Managed');
END;

EXEC(N'UPDATE dbo.Organizations
SET OrganizationType = CASE
    WHEN LOWER(LTRIM(RTRIM(Name))) IN (N''external'', N''external team'') THEN N''External''
    ELSE N''Managed''
END;');

IF NOT EXISTS
(
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_Organizations_OrganizationType'
)
BEGIN
    EXEC(N'ALTER TABLE dbo.Organizations
    ADD CONSTRAINT CK_Organizations_OrganizationType
        CHECK (OrganizationType IN (N''Managed'', N''External''));');
END;

IF OBJECT_ID(N'dbo.SeasonOrganizations', N'U') IS NOT NULL
BEGIN
    EXEC(N'UPDATE so
    SET ParticipationType = o.OrganizationType,
        UpdatedAt = SYSUTCDATETIME()
    FROM dbo.SeasonOrganizations so
    INNER JOIN dbo.Organizations o ON o.OrganizationId = so.OrganizationId
    WHERE so.ParticipationType <> N''NotParticipating'';');
END;

EXEC(N'UPDATE t
SET IsExternal = CASE WHEN o.OrganizationType = N''External'' THEN 1 ELSE 0 END,
    ScorekeeperCode = CASE WHEN o.OrganizationType = N''External'' THEN NULL ELSE t.ScorekeeperCode END,
    StatManagerCode = CASE WHEN o.OrganizationType = N''External'' THEN NULL ELSE t.StatManagerCode END
FROM dbo.Teams t
INNER JOIN dbo.Organizations o ON o.OrganizationId = t.OrganizationId;');

IF NOT EXISTS (SELECT 1 FROM dbo.Teams WHERE OrganizationId IS NULL)
BEGIN
    ALTER TABLE dbo.Teams ALTER COLUMN OrganizationId UNIQUEIDENTIFIER NOT NULL;
END;
