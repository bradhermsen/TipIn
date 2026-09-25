IF OBJECT_ID('dbo.Officials', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Officials
    (
        OfficialId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Officials PRIMARY KEY,
        FirstName NVARCHAR(100) NOT NULL,
        LastName NVARCHAR(100) NOT NULL,
        Role NVARCHAR(100) NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_Officials_IsActive DEFAULT 1,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Officials_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_Officials_UpdatedAt DEFAULT SYSUTCDATETIME()
    );
END;

IF COL_LENGTH('dbo.Officials', 'Email') IS NULL
BEGIN
    ALTER TABLE dbo.Officials
    ADD Email NVARCHAR(255) NULL;
END;

IF COL_LENGTH('dbo.GameOfficials', 'OfficialId') IS NULL
BEGIN
    ALTER TABLE dbo.GameOfficials
    ADD OfficialId UNIQUEIDENTIFIER NULL;
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GameOfficials_Officials'
)
BEGIN
    ALTER TABLE dbo.GameOfficials
    ADD CONSTRAINT FK_GameOfficials_Officials
    FOREIGN KEY (OfficialId) REFERENCES dbo.Officials (OfficialId);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_GameOfficials_GameId_Role'
      AND object_id = OBJECT_ID('dbo.GameOfficials')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_GameOfficials_GameId_Role
    ON dbo.GameOfficials (GameId, Role);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_GameOfficials_OfficialId'
      AND object_id = OBJECT_ID('dbo.GameOfficials')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_GameOfficials_OfficialId
    ON dbo.GameOfficials (OfficialId);
END;

INSERT INTO dbo.Officials (OfficialId, FirstName, LastName, Role)
SELECT NEWID(), go.FirstName, go.LastName,
       CASE
           WHEN go.Role LIKE 'Referee%' THEN 'Referee'
           WHEN go.Role LIKE 'Linesman%' THEN 'Linesman'
           ELSE go.Role
       END
FROM (
    SELECT DISTINCT FirstName, LastName, Role
    FROM dbo.GameOfficials
    WHERE ISNULL(LTRIM(RTRIM(FirstName)), '') <> ''
      AND ISNULL(LTRIM(RTRIM(LastName)), '') <> ''
) go
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.Officials o
    WHERE o.FirstName = go.FirstName
      AND o.LastName = go.LastName
);

UPDATE go
SET go.OfficialId = o.OfficialId
FROM dbo.GameOfficials go
INNER JOIN dbo.Officials o
    ON o.FirstName = go.FirstName
   AND o.LastName = go.LastName
WHERE go.OfficialId IS NULL;