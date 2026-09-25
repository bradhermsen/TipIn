IF OBJECT_ID('dbo.GameEvents', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.GameEvents
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT PK_GameEvents PRIMARY KEY
            CONSTRAINT DF_GameEvents_Id DEFAULT NEWID(),
        GameId UNIQUEIDENTIFIER NOT NULL,
        EventType NVARCHAR(50) NOT NULL,
        Period INT NOT NULL,
        TimeInPeriod NVARCHAR(10) NOT NULL,
        TeamId UNIQUEIDENTIFIER NULL,
        PlayerId UNIQUEIDENTIFIER NULL,
        SecondaryPlayerId UNIQUEIDENTIFIER NULL,
        Zone NVARCHAR(50) NULL,
        Details NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_GameEvents_CreatedAt DEFAULT SYSUTCDATETIME()
    );
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GameEvents_Games'
)
BEGIN
    ALTER TABLE dbo.GameEvents
    ADD CONSTRAINT FK_GameEvents_Games
    FOREIGN KEY (GameId) REFERENCES dbo.Games (GameId);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GameEvents_Teams'
)
BEGIN
    ALTER TABLE dbo.GameEvents
    ADD CONSTRAINT FK_GameEvents_Teams
    FOREIGN KEY (TeamId) REFERENCES dbo.Teams (Id);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GameEvents_Players_PlayerId'
)
BEGIN
    ALTER TABLE dbo.GameEvents
    ADD CONSTRAINT FK_GameEvents_Players_PlayerId
    FOREIGN KEY (PlayerId) REFERENCES dbo.Players (PlayerId);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GameEvents_Players_SecondaryPlayerId'
)
BEGIN
    ALTER TABLE dbo.GameEvents
    ADD CONSTRAINT FK_GameEvents_Players_SecondaryPlayerId
    FOREIGN KEY (SecondaryPlayerId) REFERENCES dbo.Players (PlayerId);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_GameEvents_GameId_Period_TimeInPeriod'
      AND object_id = OBJECT_ID('dbo.GameEvents')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_GameEvents_GameId_Period_TimeInPeriod
    ON dbo.GameEvents (GameId, Period, TimeInPeriod);
END;

IF OBJECT_ID('dbo.GameGoals', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.GameGoals
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT PK_GameGoals PRIMARY KEY
            CONSTRAINT DF_GameGoals_Id DEFAULT NEWID(),
        GameId UNIQUEIDENTIFIER NOT NULL,
        EventId UNIQUEIDENTIFIER NOT NULL,
        ScoringTeamId UNIQUEIDENTIFIER NOT NULL,
        ScorerId UNIQUEIDENTIFIER NOT NULL,
        Assist1Id UNIQUEIDENTIFIER NULL,
        Assist2Id UNIQUEIDENTIFIER NULL,
        GoalieId UNIQUEIDENTIFIER NULL,
        Strength NVARCHAR(10) NOT NULL,
        ShotType NVARCHAR(50) NULL,
        Zone NVARCHAR(50) NULL,
        Period INT NOT NULL,
        TimeInPeriod NVARCHAR(10) NOT NULL,
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_GameGoals_CreatedAt DEFAULT SYSUTCDATETIME()
    );
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GameGoals_Games'
)
BEGIN
    ALTER TABLE dbo.GameGoals
    ADD CONSTRAINT FK_GameGoals_Games
    FOREIGN KEY (GameId) REFERENCES dbo.Games (GameId);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GameGoals_GameEvents'
)
BEGIN
    ALTER TABLE dbo.GameGoals
    ADD CONSTRAINT FK_GameGoals_GameEvents
    FOREIGN KEY (EventId) REFERENCES dbo.GameEvents (Id);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GameGoals_Teams'
)
BEGIN
    ALTER TABLE dbo.GameGoals
    ADD CONSTRAINT FK_GameGoals_Teams
    FOREIGN KEY (ScoringTeamId) REFERENCES dbo.Teams (Id);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GameGoals_Players_ScorerId'
)
BEGIN
    ALTER TABLE dbo.GameGoals
    ADD CONSTRAINT FK_GameGoals_Players_ScorerId
    FOREIGN KEY (ScorerId) REFERENCES dbo.Players (PlayerId);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GameGoals_Players_Assist1Id'
)
BEGIN
    ALTER TABLE dbo.GameGoals
    ADD CONSTRAINT FK_GameGoals_Players_Assist1Id
    FOREIGN KEY (Assist1Id) REFERENCES dbo.Players (PlayerId);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GameGoals_Players_Assist2Id'
)
BEGIN
    ALTER TABLE dbo.GameGoals
    ADD CONSTRAINT FK_GameGoals_Players_Assist2Id
    FOREIGN KEY (Assist2Id) REFERENCES dbo.Players (PlayerId);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = 'FK_GameGoals_Players_GoalieId'
)
BEGIN
    ALTER TABLE dbo.GameGoals
    ADD CONSTRAINT FK_GameGoals_Players_GoalieId
    FOREIGN KEY (GoalieId) REFERENCES dbo.Players (PlayerId);
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_GameGoals_GameId_Period_TimeInPeriod'
      AND object_id = OBJECT_ID('dbo.GameGoals')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_GameGoals_GameId_Period_TimeInPeriod
    ON dbo.GameGoals (GameId, Period, TimeInPeriod);
END;

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