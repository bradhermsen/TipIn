using System;
using System.Collections.Generic;
using System.Data;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.DTOs;

namespace TipInAPI.Repositories
{
    public class GameRepository : IGameRepository
    {
        private readonly IDbConnection _db;

        public GameRepository(IDbConnection db)
        {
            _db = db;
        }

        // =========================================================
        // GET ALL
        // =========================================================
        public async Task<IEnumerable<GameListItemDto>> GetAllAsync()
        {
            var sql = @"
                SELECT 
                    g.GameId,
                    g.HomeTeamId,
                    ht.Name AS HomeTeamName,
                    g.AwayTeamId,
                    at.Name AS AwayTeamName,
                    g.GameDateTime,
                    g.ArenaId,
                    g.RinkId,
                    g.ArenaName,
                    g.RinkName,
                    g.VenueAddress,
                    gt.Name AS GameTypeName,
                    gr.RoundName AS GameRoundName,
                    NULLIF(LTRIM(RTRIM(CONCAT(COALESCE(r1.FirstName, ''), ' ', COALESCE(r1.LastName, '')))), '') AS Referee1,
                    NULLIF(LTRIM(RTRIM(CONCAT(COALESCE(r2.FirstName, ''), ' ', COALESCE(r2.LastName, '')))), '') AS Referee2,
                    NULLIF(LTRIM(RTRIM(CONCAT(COALESCE(l1.FirstName, ''), ' ', COALESCE(l1.LastName, '')))), '') AS Linesman1,
                    NULLIF(LTRIM(RTRIM(CONCAT(COALESCE(l2.FirstName, ''), ' ', COALESCE(l2.LastName, '')))), '') AS Linesman2,
                    g.PeriodLengthMinutes,
                    g.Status
                FROM Games g
                LEFT JOIN Teams ht ON g.HomeTeamId = ht.Id
                LEFT JOIN Teams at ON g.AwayTeamId = at.Id
                LEFT JOIN GameTypes gt ON g.GameTypeId = gt.GameTypeId
                LEFT JOIN GameRounds gr ON g.GameRoundId = gr.GameRoundId
                OUTER APPLY (
                    SELECT TOP 1
                        COALESCE(o.FirstName, go.FirstName) AS FirstName,
                        COALESCE(o.LastName, go.LastName) AS LastName
                    FROM GameOfficials go
                    LEFT JOIN Officials o ON o.OfficialId = go.OfficialId
                    WHERE go.GameId = g.GameId AND go.Role = 'Referee 1'
                ) r1
                OUTER APPLY (
                    SELECT TOP 1
                        COALESCE(o.FirstName, go.FirstName) AS FirstName,
                        COALESCE(o.LastName, go.LastName) AS LastName
                    FROM GameOfficials go
                    LEFT JOIN Officials o ON o.OfficialId = go.OfficialId
                    WHERE go.GameId = g.GameId AND go.Role = 'Referee 2'
                ) r2
                OUTER APPLY (
                    SELECT TOP 1
                        COALESCE(o.FirstName, go.FirstName) AS FirstName,
                        COALESCE(o.LastName, go.LastName) AS LastName
                    FROM GameOfficials go
                    LEFT JOIN Officials o ON o.OfficialId = go.OfficialId
                    WHERE go.GameId = g.GameId AND go.Role = 'Linesman 1'
                ) l1
                OUTER APPLY (
                    SELECT TOP 1
                        COALESCE(o.FirstName, go.FirstName) AS FirstName,
                        COALESCE(o.LastName, go.LastName) AS LastName
                    FROM GameOfficials go
                    LEFT JOIN Officials o ON o.OfficialId = go.OfficialId
                    WHERE go.GameId = g.GameId AND go.Role = 'Linesman 2'
                ) l2
                ORDER BY g.GameDateTime ASC;
            ";

            return await _db.QueryAsync<GameListItemDto>(sql);
        }

        // =========================================================
        // GET DETAIL
        // =========================================================
        public async Task<GameDetailDto?> GetByIdAsync(Guid id)
        {
            var sql = @"
                SELECT 
                    g.GameId,
                    g.HomeTeamId,
                    ht.Name AS HomeTeamName,
                    g.AwayTeamId,
                    at.Name AS AwayTeamName,
                    g.GameDateTime,
                    g.ArenaId,
                    g.RinkId,
                    g.ArenaName,
                    g.RinkName,
                    g.VenueAddress,
                    g.GameTypeId,
                    gt.Name AS GameTypeName,
                    g.GameRoundId,
                    gr.RoundName AS GameRoundName,
                    NULLIF(LTRIM(RTRIM(CONCAT(COALESCE(r1.FirstName, ''), ' ', COALESCE(r1.LastName, '')))), '') AS Referee1,
                    NULLIF(LTRIM(RTRIM(CONCAT(COALESCE(r2.FirstName, ''), ' ', COALESCE(r2.LastName, '')))), '') AS Referee2,
                    NULLIF(LTRIM(RTRIM(CONCAT(COALESCE(l1.FirstName, ''), ' ', COALESCE(l1.LastName, '')))), '') AS Linesman1,
                    NULLIF(LTRIM(RTRIM(CONCAT(COALESCE(l2.FirstName, ''), ' ', COALESCE(l2.LastName, '')))), '') AS Linesman2,
                    r1.OfficialId AS Referee1OfficialId,
                    r2.OfficialId AS Referee2OfficialId,
                    l1.OfficialId AS Linesman1OfficialId,
                    l2.OfficialId AS Linesman2OfficialId,
                    g.PeriodLengthMinutes,
                    g.Notes,
                    g.Status,
                    g.CreatedAt,
                    g.UpdatedAt
                FROM Games g
                LEFT JOIN Teams ht ON g.HomeTeamId = ht.Id
                LEFT JOIN Teams at ON g.AwayTeamId = at.Id
                LEFT JOIN GameTypes gt ON g.GameTypeId = gt.GameTypeId
                LEFT JOIN GameRounds gr ON g.GameRoundId = gr.GameRoundId
                OUTER APPLY (
                    SELECT TOP 1
                        go.OfficialId,
                        COALESCE(o.FirstName, go.FirstName) AS FirstName,
                        COALESCE(o.LastName, go.LastName) AS LastName
                    FROM GameOfficials go
                    LEFT JOIN Officials o ON o.OfficialId = go.OfficialId
                    WHERE go.GameId = g.GameId AND go.Role = 'Referee 1'
                ) r1
                OUTER APPLY (
                    SELECT TOP 1
                        go.OfficialId,
                        COALESCE(o.FirstName, go.FirstName) AS FirstName,
                        COALESCE(o.LastName, go.LastName) AS LastName
                    FROM GameOfficials go
                    LEFT JOIN Officials o ON o.OfficialId = go.OfficialId
                    WHERE go.GameId = g.GameId AND go.Role = 'Referee 2'
                ) r2
                OUTER APPLY (
                    SELECT TOP 1
                        go.OfficialId,
                        COALESCE(o.FirstName, go.FirstName) AS FirstName,
                        COALESCE(o.LastName, go.LastName) AS LastName
                    FROM GameOfficials go
                    LEFT JOIN Officials o ON o.OfficialId = go.OfficialId
                    WHERE go.GameId = g.GameId AND go.Role = 'Linesman 1'
                ) l1
                OUTER APPLY (
                    SELECT TOP 1
                        go.OfficialId,
                        COALESCE(o.FirstName, go.FirstName) AS FirstName,
                        COALESCE(o.LastName, go.LastName) AS LastName
                    FROM GameOfficials go
                    LEFT JOIN Officials o ON o.OfficialId = go.OfficialId
                    WHERE go.GameId = g.GameId AND go.Role = 'Linesman 2'
                ) l2
                WHERE g.GameId = @Id;
            ";

            return await _db.QueryFirstOrDefaultAsync<GameDetailDto>(sql, new { Id = id });
        }

        public async Task<string?> GetTeamLevelNameAsync(Guid teamId)
        {
            var sql = @"
                SELECT TOP 1 l.Name
                FROM Teams t
                LEFT JOIN Levels l ON t.LevelId = l.Id
                WHERE t.Id = @TeamId;
            ";

            return await _db.QueryFirstOrDefaultAsync<string?>(sql, new { TeamId = teamId });
        }

                public async Task<ManagedVenueSnapshotDto?> GetManagedVenueAsync(Guid arenaId, Guid rinkId)
                {
                        return await _db.QueryFirstOrDefaultAsync<ManagedVenueSnapshotDto>(@"
                                SELECT a.ArenaId, r.RinkId, a.Name AS ArenaName, r.Name AS RinkName,
                                             NULLIF(CONCAT_WS(', ', NULLIF(a.StreetAddress, ''), NULLIF(a.City, ''), NULLIF(a.State, ''), NULLIF(a.PostalCode, '')), '') AS VenueAddress
                                FROM dbo.Arenas a
                                INNER JOIN dbo.Rinks r ON r.ArenaId = a.ArenaId
                                WHERE a.ArenaId = @ArenaId AND r.RinkId = @RinkId
                                    AND a.IsActive = 1 AND r.IsActive = 1;",
                                new { ArenaId = arenaId, RinkId = rinkId });
                }

        // =========================================================
        // CREATE
        // =========================================================
        public async Task CreateAsync(GameCreateUpdateDto dto)
        {
            var sql = @"
                INSERT INTO Games (
                    GameId,
                    HomeTeamId,
                    AwayTeamId,
                    GameDateTime,
                    ArenaId,
                    RinkId,
                    ArenaName,
                    RinkName,
                    VenueAddress,
                    GameTypeId,
                    GameRoundId,
                    PeriodLengthMinutes,
                    Notes,
                    Status,
                    CreatedAt,
                    UpdatedAt
                )
                VALUES (
                    @GameId,
                    @HomeTeamId,
                    @AwayTeamId,
                    @GameDateTime,
                    @ArenaId,
                    @RinkId,
                    @ArenaName,
                    @RinkName,
                    @VenueAddress,
                    @GameTypeId,
                    @GameRoundId,
                    @PeriodLengthMinutes,
                    @Notes,
                    @Status,
                    @CreatedAt,
                    @UpdatedAt
                );
            ";

            var now = DateTime.UtcNow;
            var gameId = Guid.NewGuid();

            if (_db.State != ConnectionState.Open)
            {
                _db.Open();
            }

            using var tx = _db.BeginTransaction();

            try
            {
                await _db.ExecuteAsync(sql, new
                {
                    GameId = gameId,
                    dto.HomeTeamId,
                    dto.AwayTeamId,
                    dto.GameDateTime,
                    dto.ArenaId,
                    dto.RinkId,
                    dto.ArenaName,
                    dto.RinkName,
                    dto.VenueAddress,
                    dto.GameTypeId,
                    dto.GameRoundId,
                    PeriodLengthMinutes = dto.PeriodLengthMinutes ?? 17,
                    dto.Notes,
                    Status = "Scheduled",
                    CreatedAt = now,
                    UpdatedAt = now
                }, tx);

                await UpsertGameOfficialsAsync(gameId, dto, tx);
                tx.Commit();
            }
            catch
            {
                tx.Rollback();
                throw;
            }
        }

        // =========================================================
        // UPDATE
        // =========================================================
        public async Task UpdateAsync(Guid id, GameCreateUpdateDto dto)
        {
            var sql = @"
                UPDATE Games
                SET
                    HomeTeamId = @HomeTeamId,
                    AwayTeamId = @AwayTeamId,
                    GameDateTime = @GameDateTime,
                    ArenaId = @ArenaId,
                    RinkId = @RinkId,
                    ArenaName = @ArenaName,
                    RinkName = @RinkName,
                    VenueAddress = @VenueAddress,
                    GameTypeId = @GameTypeId,
                    GameRoundId = @GameRoundId,
                    PeriodLengthMinutes = @PeriodLengthMinutes,
                    Notes = @Notes,
                    Status = @Status,
                    UpdatedAt = @UpdatedAt
                WHERE GameId = @GameId;
            ";

            if (_db.State != ConnectionState.Open)
            {
                _db.Open();
            }

            using var tx = _db.BeginTransaction();

            try
            {
                await _db.ExecuteAsync(sql, new
                {
                    GameId = id,
                    dto.HomeTeamId,
                    dto.AwayTeamId,
                    dto.GameDateTime,
                    dto.ArenaId,
                    dto.RinkId,
                    dto.ArenaName,
                    dto.RinkName,
                    dto.VenueAddress,
                    dto.GameTypeId,
                    dto.GameRoundId,
                    PeriodLengthMinutes = dto.PeriodLengthMinutes ?? 17,
                    dto.Notes,
                    dto.Status,
                    UpdatedAt = DateTime.UtcNow
                }, tx);

                await UpsertGameOfficialsAsync(id, dto, tx);
                tx.Commit();
            }
            catch
            {
                tx.Rollback();
                throw;
            }
        }

        // =========================================================
        // DELETE
        // =========================================================
        public async Task DeleteAsync(Guid id)
        {
            if (_db.State != ConnectionState.Open)
            {
                _db.Open();
            }

            using var tx = _db.BeginTransaction();
            try
            {
                await _db.ExecuteAsync(@"
                    DELETE gos
                    FROM GameOfficialSignatures gos
                    INNER JOIN GameOfficials go ON gos.GameOfficialId = go.Id
                    WHERE go.GameId = @Id;
                ", new { Id = id }, tx);

                await _db.ExecuteAsync("DELETE FROM GameOfficials WHERE GameId = @Id;", new { Id = id }, tx);
                await _db.ExecuteAsync("DELETE FROM Games WHERE GameId = @Id;", new { Id = id }, tx);
                tx.Commit();
            }
            catch
            {
                tx.Rollback();
                throw;
            }
        }

        private async Task UpsertGameOfficialsAsync(Guid gameId, GameCreateUpdateDto dto, IDbTransaction tx)
        {
            await UpsertGameOfficialByRoleAsync(gameId, "Referee 1", dto.Referee1OfficialId, tx);
            await UpsertGameOfficialByRoleAsync(gameId, "Referee 2", dto.Referee2OfficialId, tx);
            await UpsertGameOfficialByRoleAsync(gameId, "Linesman 1", dto.Linesman1OfficialId, tx);
            await UpsertGameOfficialByRoleAsync(gameId, "Linesman 2", dto.Linesman2OfficialId, tx);
        }

        private async Task UpsertGameOfficialByRoleAsync(Guid gameId, string role, Guid? officialId, IDbTransaction tx)
        {
            if (!officialId.HasValue)
            {
                await _db.ExecuteAsync(@"
                    DELETE go
                    FROM GameOfficials go
                    WHERE go.GameId = @GameId
                      AND go.Role = @Role
                      AND NOT EXISTS (
                        SELECT 1 FROM GameOfficialSignatures gos WHERE gos.GameOfficialId = go.Id
                      );
                ", new { GameId = gameId, Role = role }, tx);
                return;
            }

            var official = await _db.QueryFirstOrDefaultAsync<(string FirstName, string LastName)>(@"
                SELECT FirstName, LastName
                FROM Officials
                WHERE OfficialId = @OfficialId;
            ", new { OfficialId = officialId.Value }, tx);

            if (string.IsNullOrWhiteSpace(official.FirstName) && string.IsNullOrWhiteSpace(official.LastName))
            {
                return;
            }

            var existingId = await _db.QueryFirstOrDefaultAsync<Guid?>(@"
                SELECT TOP 1 Id
                FROM GameOfficials
                WHERE GameId = @GameId AND Role = @Role;
            ", new { GameId = gameId, Role = role }, tx);

            if (existingId.HasValue)
            {
                await _db.ExecuteAsync(@"
                    UPDATE GameOfficials
                    SET OfficialId = @OfficialId,
                        FirstName = @FirstName,
                        LastName = @LastName,
                        Role = @Role
                    WHERE Id = @Id;
                ", new
                {
                    Id = existingId.Value,
                    OfficialId = officialId.Value,
                    FirstName = official.FirstName,
                    LastName = official.LastName,
                    Role = role,
                }, tx);
                return;
            }

            await _db.ExecuteAsync(@"
                INSERT INTO GameOfficials (Id, GameId, OfficialId, FirstName, LastName, Role)
                VALUES (@Id, @GameId, @OfficialId, @FirstName, @LastName, @Role);
            ", new
            {
                Id = Guid.NewGuid(),
                GameId = gameId,
                OfficialId = officialId.Value,
                FirstName = official.FirstName,
                LastName = official.LastName,
                Role = role,
            }, tx);
        }
    }
}
