IF OBJECT_ID('dbo.GameOfficialVerifications', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.GameOfficialVerifications
    (
        GameOfficialVerificationId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT PK_GameOfficialVerifications PRIMARY KEY,
        GameId UNIQUEIDENTIFIER NOT NULL,
        OfficialId UNIQUEIDENTIFIER NULL,
        Role NVARCHAR(100) NOT NULL,
        OfficialName NVARCHAR(250) NOT NULL,
        SignatureImageBase64 NVARCHAR(MAX) NULL,
        SignedAtUtc DATETIME2 NULL,
        CreatedAtUtc DATETIME2 NOT NULL
            CONSTRAINT DF_GameOfficialVerifications_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        UpdatedAtUtc DATETIME2 NOT NULL
            CONSTRAINT DF_GameOfficialVerifications_UpdatedAtUtc DEFAULT SYSUTCDATETIME()
    );
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GameOfficialVerifications_Games'
)
BEGIN
    ALTER TABLE dbo.GameOfficialVerifications
    ADD CONSTRAINT FK_GameOfficialVerifications_Games
    FOREIGN KEY (GameId) REFERENCES dbo.Games (GameId);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GameOfficialVerifications_Officials'
)
BEGIN
    ALTER TABLE dbo.GameOfficialVerifications
    ADD CONSTRAINT FK_GameOfficialVerifications_Officials
    FOREIGN KEY (OfficialId) REFERENCES dbo.Officials (OfficialId);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'UX_GameOfficialVerifications_GameId_Role'
      AND object_id = OBJECT_ID('dbo.GameOfficialVerifications')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_GameOfficialVerifications_GameId_Role
    ON dbo.GameOfficialVerifications (GameId, Role);
END;
