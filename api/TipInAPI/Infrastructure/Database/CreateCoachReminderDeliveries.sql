SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID('dbo.CoachReminderDeliveries', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CoachReminderDeliveries
    (
        GameId UNIQUEIDENTIFIER NOT NULL,
        TeamId UNIQUEIDENTIFIER NOT NULL,
        Email NVARCHAR(256) NOT NULL,
        ReminderType VARCHAR(20) NOT NULL,
        Status VARCHAR(20) NOT NULL,
        ClaimedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        SentAtUtc DATETIME2 NULL,
        InvitationId UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_CoachReminderDeliveries PRIMARY KEY (GameId, TeamId, Email, ReminderType),
        CONSTRAINT CK_CoachReminderDeliveries_Type CHECK (ReminderType IN ('Invitation', 'RosterReview', 'LineupReminder')),
        CONSTRAINT CK_CoachReminderDeliveries_Status CHECK (Status IN ('Sending', 'Sent', 'NeedsReview'))
    );
END;

ALTER TABLE dbo.CoachReminderDeliveries DROP CONSTRAINT CK_CoachReminderDeliveries_Type;
ALTER TABLE dbo.CoachReminderDeliveries ADD CONSTRAINT CK_CoachReminderDeliveries_Type
    CHECK (ReminderType IN ('Invitation','RosterReview','LineupReminder'));

IF OBJECT_ID('dbo.CoachEmailAutomationSettings','U') IS NULL
BEGIN
    CREATE TABLE dbo.CoachEmailAutomationSettings
    (
        Id INT NOT NULL CONSTRAINT PK_CoachEmailAutomationSettings PRIMARY KEY,
        AutomaticInvitations BIT NOT NULL DEFAULT 0,
        RosterReminders BIT NOT NULL DEFAULT 0,
        LineupReminders BIT NOT NULL DEFAULT 0,
        UpdatedAtUtc DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_CoachEmailAutomationSettings_Id CHECK (Id=1)
    );
END;
IF NOT EXISTS (SELECT 1 FROM dbo.CoachEmailAutomationSettings WHERE Id=1)
    INSERT INTO dbo.CoachEmailAutomationSettings(Id) VALUES(1);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.CoachReminderDeliveries')
    AND name='IX_CoachReminderDeliveries_Contact')
    CREATE INDEX IX_CoachReminderDeliveries_Contact
        ON dbo.CoachReminderDeliveries(TeamId, Email, Status);

-- NULL identifies an automated invitation, not an administrator impersonation.
ALTER TABLE dbo.CoachInvitations ALTER COLUMN CreatedByUserId UNIQUEIDENTIFIER NULL;

COMMIT TRANSACTION;
