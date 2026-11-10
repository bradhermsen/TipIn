IF OBJECT_ID('dbo.RefreshTokens', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RefreshTokens
    (
        RefreshTokenId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT PK_RefreshTokens PRIMARY KEY,
        UserId UNIQUEIDENTIFIER NOT NULL,
        -- SHA-256 of the token. The token itself is never stored.
        TokenHash CHAR(64) NOT NULL,
        CreatedAtUtc DATETIME2 NOT NULL
            CONSTRAINT DF_RefreshTokens_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        -- Sliding expiry, extended on each rotation up to AbsoluteExpiresAtUtc
        ExpiresAtUtc DATETIME2 NOT NULL,
        AbsoluteExpiresAtUtc DATETIME2 NOT NULL,
        RevokedAtUtc DATETIME2 NULL,
        ReplacedByTokenId UNIQUEIDENTIFIER NULL
    );

    CREATE UNIQUE NONCLUSTERED INDEX UX_RefreshTokens_TokenHash
    ON dbo.RefreshTokens (TokenHash);

    CREATE NONCLUSTERED INDEX IX_RefreshTokens_UserId
    ON dbo.RefreshTokens (UserId);
END;

IF OBJECT_ID('dbo.PasswordResetTokens', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PasswordResetTokens
    (
        PasswordResetTokenId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT PK_PasswordResetTokens PRIMARY KEY,
        UserId UNIQUEIDENTIFIER NOT NULL,
        TokenHash CHAR(64) NOT NULL,
        CreatedAtUtc DATETIME2 NOT NULL
            CONSTRAINT DF_PasswordResetTokens_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        ExpiresAtUtc DATETIME2 NOT NULL,
        UsedAtUtc DATETIME2 NULL
    );

    CREATE UNIQUE NONCLUSTERED INDEX UX_PasswordResetTokens_TokenHash
    ON dbo.PasswordResetTokens (TokenHash);

    CREATE NONCLUSTERED INDEX IX_PasswordResetTokens_UserId
    ON dbo.PasswordResetTokens (UserId);
END;
