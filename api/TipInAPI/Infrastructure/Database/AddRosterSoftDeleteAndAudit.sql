-- Soft delete for roster entries: a coach "removing" a player hides the entry on that team only.
-- The player and other teams' entries are untouched, and past lineups can still reference the entry.
IF COL_LENGTH('dbo.RosterEntries', 'RemovedAtUtc') IS NULL
BEGIN
    ALTER TABLE dbo.RosterEntries ADD RemovedAtUtc DATETIME2 NULL;
END;

IF COL_LENGTH('dbo.RosterEntries', 'RemovedByUserId') IS NULL
BEGIN
    ALTER TABLE dbo.RosterEntries ADD RemovedByUserId UNIQUEIDENTIFIER NULL;
END;

IF OBJECT_ID('dbo.RosterAuditLog', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RosterAuditLog
    (
        RosterAuditLogId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT PK_RosterAuditLog PRIMARY KEY,
        OccurredAtUtc DATETIME2 NOT NULL
            CONSTRAINT DF_RosterAuditLog_OccurredAtUtc DEFAULT SYSUTCDATETIME(),
        ActorUserId UNIQUEIDENTIFIER NOT NULL,
        TeamId UNIQUEIDENTIFIER NOT NULL,
        PlayerId UNIQUEIDENTIFIER NULL,
        RosterEntryId UNIQUEIDENTIFIER NULL,
        -- AddPlayer, AddExistingPlayer, UpdateName, UpdateGrade, UpdateJersey, UpdatePosition,
        -- RemovePlayer, RestorePlayer, DuplicateOverride
        Action NVARCHAR(50) NOT NULL,
        OldValue NVARCHAR(500) NULL,
        NewValue NVARCHAR(500) NULL
    );

    CREATE NONCLUSTERED INDEX IX_RosterAuditLog_Team ON dbo.RosterAuditLog (TeamId, OccurredAtUtc DESC);
    CREATE NONCLUSTERED INDEX IX_RosterAuditLog_Player ON dbo.RosterAuditLog (PlayerId, OccurredAtUtc DESC);
END;

-- Diagnostic (read-only): list triggers on the roster tables. RosterSyncRules.md describes a two-way
-- jersey number sync. If a trigger implements it, coach jersey edits would overwrite Players.JerseyNumber.
-- SELECT t.name, OBJECT_NAME(t.parent_id) AS TableName, OBJECT_DEFINITION(t.object_id) AS Definition
-- FROM sys.triggers t
-- WHERE OBJECT_NAME(t.parent_id) IN ('Players', 'RosterEntries', 'PlayerTeams');
