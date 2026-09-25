IF OBJECT_ID('dbo.Officials', 'U') IS NULL
BEGIN
    RAISERROR('Officials table does not exist. Run CreateOfficialsAndLinkGameOfficials.sql first.', 16, 1);
    RETURN;
END;

;WITH SeedData AS
(
    SELECT N'Aaron' AS FirstName, N'Bennett' AS LastName, N'Referee' AS Role UNION ALL
    SELECT N'Carson', N'Brooks', N'Referee' UNION ALL
    SELECT N'Luke', N'Foster', N'Referee' UNION ALL
    SELECT N'Nolan', N'Hayes', N'Referee' UNION ALL
    SELECT N'Isaac', N'Mitchell', N'Referee' UNION ALL
    SELECT N'Ethan', N'Ramsey', N'Referee' UNION ALL
    SELECT N'Connor', N'Stewart', N'Referee' UNION ALL
    SELECT N'Logan', N'Walker', N'Referee' UNION ALL
    SELECT N'Brady', N'Allen', N'Linesman' UNION ALL
    SELECT N'Wyatt', N'Campbell', N'Linesman' UNION ALL
    SELECT N'Noah', N'Erickson', N'Linesman' UNION ALL
    SELECT N'Parker', N'Garcia', N'Linesman' UNION ALL
    SELECT N'Cole', N'Jensen', N'Linesman' UNION ALL
    SELECT N'Gavin', N'Morris', N'Linesman' UNION ALL
    SELECT N'Caleb', N'Nelson', N'Linesman' UNION ALL
    SELECT N'Owen', N'Thompson', N'Linesman'
)
MERGE dbo.Officials AS target
USING SeedData AS src
ON target.FirstName = src.FirstName
   AND target.LastName = src.LastName
   AND ISNULL(target.Role, '') = ISNULL(src.Role, '')
WHEN MATCHED THEN
    UPDATE SET
        IsActive = 1,
        UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT
    (
        OfficialId,
        FirstName,
        LastName,
        Role,
        IsActive,
        CreatedAt,
        UpdatedAt
    )
    VALUES
    (
        NEWID(),
        src.FirstName,
        src.LastName,
        src.Role,
        1,
        SYSUTCDATETIME(),
        SYSUTCDATETIME()
    );
