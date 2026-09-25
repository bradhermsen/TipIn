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
