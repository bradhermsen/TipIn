SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @Defaults TABLE (Name NVARCHAR(100) NOT NULL PRIMARY KEY);
INSERT INTO @Defaults (Name)
VALUES
    (N'Conference'),
    (N'Non-Conference'),
    (N'Exhibition'),
    (N'Tournament');

INSERT INTO dbo.GameTypes (Name)
SELECT d.Name
FROM @Defaults d
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.GameTypes gt WITH (UPDLOCK, HOLDLOCK)
    WHERE LOWER(LTRIM(RTRIM(gt.Name))) = LOWER(d.Name)
);

DECLARE @LegacyGameTypes TABLE (GameTypeId INT NOT NULL PRIMARY KEY);
INSERT INTO @LegacyGameTypes (GameTypeId)
SELECT GameTypeId
FROM dbo.GameTypes
WHERE Name IN (N'Regular Season', N'Section', N'State');

DELETE gr
FROM dbo.GameRounds gr
JOIN @LegacyGameTypes legacy ON legacy.GameTypeId = gr.GameTypeId
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.Games g
    WHERE g.GameRoundId = gr.GameRoundId
);

DELETE gt
FROM dbo.GameTypes gt
JOIN @LegacyGameTypes legacy ON legacy.GameTypeId = gt.GameTypeId
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.Games g
    WHERE g.GameTypeId = gt.GameTypeId
       OR g.GameRoundId IN (
            SELECT gr.GameRoundId
            FROM dbo.GameRounds gr
            WHERE gr.GameTypeId = gt.GameTypeId
       )
)
AND NOT EXISTS (
    SELECT 1
    FROM dbo.GameRounds gr
    WHERE gr.GameTypeId = gt.GameTypeId
);

SELECT gt.GameTypeId, gt.Name,
       (SELECT COUNT(1)
        FROM dbo.Games g
        WHERE g.GameTypeId = gt.GameTypeId
           OR g.GameRoundId IN (
                SELECT gr.GameRoundId
                FROM dbo.GameRounds gr
                WHERE gr.GameTypeId = gt.GameTypeId
           )) AS GameCount
FROM dbo.GameTypes gt
ORDER BY gt.Name;

COMMIT TRANSACTION;
