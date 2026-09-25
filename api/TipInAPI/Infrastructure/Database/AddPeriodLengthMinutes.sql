ALTER TABLE Games
ADD PeriodLengthMinutes INT NOT NULL CONSTRAINT DF_Games_PeriodLengthMinutes DEFAULT 17;
