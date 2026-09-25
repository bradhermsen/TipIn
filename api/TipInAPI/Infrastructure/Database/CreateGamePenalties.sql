IF OBJECT_ID('dbo.GamePenalties', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.GamePenalties
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT PK_GamePenalties PRIMARY KEY
            CONSTRAINT DF_GamePenalties_Id DEFAULT NEWID(),
        GameId UNIQUEIDENTIFIER NOT NULL,
        EventId UNIQUEIDENTIFIER NOT NULL,
        TeamId UNIQUEIDENTIFIER NOT NULL,
        PlayerId UNIQUEIDENTIFIER NOT NULL,
        ServedByPlayerId UNIQUEIDENTIFIER NULL,
        Infraction NVARCHAR(100) NOT NULL,
        DurationMinutes INT NOT NULL,
        Period INT NOT NULL,
        TimeInPeriod NVARCHAR(10) NOT NULL,
        Notes NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_GamePenalties_CreatedAt DEFAULT SYSUTCDATETIME()
    );
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GamePenalties_Games'
)
BEGIN
    ALTER TABLE dbo.GamePenalties
    ADD CONSTRAINT FK_GamePenalties_Games
    FOREIGN KEY (GameId) REFERENCES dbo.Games (GameId);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GamePenalties_GameEvents'
)
BEGIN
    ALTER TABLE dbo.GamePenalties
    ADD CONSTRAINT FK_GamePenalties_GameEvents
    FOREIGN KEY (EventId) REFERENCES dbo.GameEvents (Id);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GamePenalties_Teams'
)
BEGIN
    ALTER TABLE dbo.GamePenalties
    ADD CONSTRAINT FK_GamePenalties_Teams
    FOREIGN KEY (TeamId) REFERENCES dbo.Teams (Id);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GamePenalties_Players_PlayerId'
)
BEGIN
    ALTER TABLE dbo.GamePenalties
    ADD CONSTRAINT FK_GamePenalties_Players_PlayerId
    FOREIGN KEY (PlayerId) REFERENCES dbo.Players (PlayerId);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GamePenalties_Players_ServedByPlayerId'
)
BEGIN
    ALTER TABLE dbo.GamePenalties
    ADD CONSTRAINT FK_GamePenalties_Players_ServedByPlayerId
    FOREIGN KEY (ServedByPlayerId) REFERENCES dbo.Players (PlayerId);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_GamePenalties_GameId_Period_TimeInPeriod'
      AND object_id = OBJECT_ID('dbo.GamePenalties')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_GamePenalties_GameId_Period_TimeInPeriod
    ON dbo.GamePenalties (GameId, Period, TimeInPeriod);
END;
