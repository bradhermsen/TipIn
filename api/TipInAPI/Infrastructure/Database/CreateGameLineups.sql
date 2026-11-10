-- Game-day lineups. One row per game and team holds the current participants and starters (by PlayerId).
-- Version increments on every change so a stale save or signature can be rejected.
IF OBJECT_ID('dbo.GameLineups', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.GameLineups
    (
        GameId UNIQUEIDENTIFIER NOT NULL,
        TeamId UNIQUEIDENTIFIER NOT NULL,
        ParticipantIdsJson NVARCHAR(MAX) NOT NULL,
        StarterIdsJson NVARCHAR(MAX) NOT NULL,
        Version INT NOT NULL,
        UpdatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_GameLineups_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
        UpdatedByUserId UNIQUEIDENTIFIER NULL,
        -- 'coach:<email>' or 'tablet'
        UpdatedBy NVARCHAR(256) NULL,
        CONSTRAINT PK_GameLineups PRIMARY KEY (GameId, TeamId),
        CONSTRAINT FK_GameLineups_Games FOREIGN KEY (GameId) REFERENCES dbo.Games (GameId),
        CONSTRAINT FK_GameLineups_Teams FOREIGN KEY (TeamId) REFERENCES dbo.Teams (Id)
    );
END;

-- Append-only history. A lineup is locked when its latest event is 'Sign'.
IF OBJECT_ID('dbo.GameLineupEvents', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.GameLineupEvents
    (
        EventId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_GameLineupEvents PRIMARY KEY,
        GameId UNIQUEIDENTIFIER NOT NULL,
        TeamId UNIQUEIDENTIFIER NOT NULL,
        EventType NVARCHAR(20) NOT NULL,
        LineupVersion INT NOT NULL,
        SignerName NVARCHAR(200) NULL,
        Device NVARCHAR(200) NULL,
        -- 1 when signed from a coach account, 0 when signed with only the Game Manager code
        IsVerified BIT NOT NULL CONSTRAINT DF_GameLineupEvents_IsVerified DEFAULT 0,
        ActorUserId UNIQUEIDENTIFIER NULL,
        Reason NVARCHAR(500) NULL,
        -- Name, jersey and position as they were at signing
        SnapshotJson NVARCHAR(MAX) NULL,
        CreatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_GameLineupEvents_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_GameLineupEvents_Type CHECK (EventType IN ('Sign', 'Unlock'))
    );

    CREATE NONCLUSTERED INDEX IX_GameLineupEvents_GameTeam
    ON dbo.GameLineupEvents (GameId, TeamId, CreatedAtUtc DESC);
END;
