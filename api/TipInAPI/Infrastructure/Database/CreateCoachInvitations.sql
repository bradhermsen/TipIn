IF OBJECT_ID('dbo.CoachInvitations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CoachInvitations
    (
        InvitationId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT PK_CoachInvitations PRIMARY KEY,
        TeamId UNIQUEIDENTIFIER NOT NULL,
        Email NVARCHAR(256) NOT NULL,
        -- SHA-256 of the invite token. The token itself is never stored.
        TokenHash CHAR(64) NOT NULL,
        Status NVARCHAR(20) NOT NULL
            CONSTRAINT DF_CoachInvitations_Status DEFAULT 'Pending',
        ExpiresAtUtc DATETIME2 NOT NULL,
        FailedAttempts INT NOT NULL
            CONSTRAINT DF_CoachInvitations_FailedAttempts DEFAULT 0,
        CreatedByUserId UNIQUEIDENTIFIER NOT NULL,
        CreatedAtUtc DATETIME2 NOT NULL
            CONSTRAINT DF_CoachInvitations_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        UsedAtUtc DATETIME2 NULL,
        UsedByUserId UNIQUEIDENTIFIER NULL,
        RevokedAtUtc DATETIME2 NULL,
        RevokedByUserId UNIQUEIDENTIFIER NULL,
        CONSTRAINT CK_CoachInvitations_Status
            CHECK (Status IN ('Pending', 'Accepted', 'Revoked'))
    );
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CoachInvitations_Teams'
)
BEGIN
    ALTER TABLE dbo.CoachInvitations
    ADD CONSTRAINT FK_CoachInvitations_Teams
    FOREIGN KEY (TeamId) REFERENCES dbo.Teams (Id);
END;

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UX_CoachInvitations_TokenHash'
      AND object_id = OBJECT_ID('dbo.CoachInvitations')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_CoachInvitations_TokenHash
    ON dbo.CoachInvitations (TokenHash);
END;

-- Only one pending invite per team and email. Regenerating revokes the old one first.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UX_CoachInvitations_Pending_TeamEmail'
      AND object_id = OBJECT_ID('dbo.CoachInvitations')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_CoachInvitations_Pending_TeamEmail
    ON dbo.CoachInvitations (TeamId, Email)
    WHERE Status = 'Pending';
END;
