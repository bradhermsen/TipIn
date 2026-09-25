using System;
using System.Collections.Generic;
using System.Data;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.DTOs;
using TipInAPI.Models;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;

namespace TipInAPI.Repositories
{
    public class RosterEntriesRepository : IRosterEntriesRepository
    {
        private readonly string _connectionString;

        public RosterEntriesRepository(IConfiguration config)
        {
            _connectionString = config.GetConnectionString("DefaultConnection");
        }

        private IDbConnection Connection => new SqlConnection(_connectionString);

        // =========================================================
        // GET ROSTER FOR TEAM (Dapper JOIN)
        // =========================================================
        public async Task<IEnumerable<RosterEntry>> GetByTeamIdAsync(Guid teamId)
        {
            var sql = @"
                SELECT 
                    -- Roster Entry
                    r.Id,
                    r.TeamId,
                    r.PlayerId,
                    r.JerseyNumber,
                    r.Position,
                    r.Shoots,
                    r.gamedayStatus AS GamedayStatus,
                    r.LineNumber,
                    r.Grade,
                    r.Notes,
                    r.IsCaptain,
                    r.IsAssistantCaptain,
                    r.IsGoalie,
                    r.IsActive,
                    r.CreatedAt,
                    r.UpdatedAt,

                    -- Player
                    p.PlayerId,
                    p.FirstName,
                    p.LastName,
                    p.FullName,
                    p.Position,
                    p.Shoots,
                    p.Grade,
                    p.JerseyNumber
                FROM RosterEntries r
                INNER JOIN Players p ON p.PlayerId = r.PlayerId
                WHERE r.TeamId = @TeamId
                ORDER BY r.JerseyNumber ASC;
            ";

            using var conn = Connection;

            var lookup = new Dictionary<Guid, RosterEntry>();

            var result = await conn.QueryAsync<RosterEntry, Player, RosterEntry>(
                sql,
                (r, p) =>
                {
                    if (!lookup.TryGetValue(r.Id, out var entry))
                    {
                        entry = r;
                        lookup.Add(entry.Id, entry);
                    }

                    entry.Player = p;
                    return entry;
                },
                new { TeamId = teamId },
                splitOn: "PlayerId"
            );

            return lookup.Values;
        }

        // =========================================================
        // GET SINGLE ROSTER ENTRY
        // =========================================================
        public async Task<RosterEntry?> GetByIdAsync(Guid id)
        {
            var sql = @"
                SELECT 
                    -- Roster Entry
                    r.Id,
                    r.TeamId,
                    r.PlayerId,
                    r.JerseyNumber,
                    r.Position,
                    r.Shoots,
                    r.gamedayStatus AS GamedayStatus,
                    r.LineNumber,
                    r.Grade,
                    r.Notes,
                    r.IsCaptain,
                    r.IsAssistantCaptain,
                    r.IsGoalie,
                    r.IsActive,
                    r.CreatedAt,
                    r.UpdatedAt,

                    -- Player
                    p.PlayerId,
                    p.FirstName,
                    p.LastName,
                    p.FullName,
                    p.Position,
                    p.Shoots,
                    p.Grade,
                    p.JerseyNumber
                FROM RosterEntries r
                INNER JOIN Players p ON p.PlayerId = r.PlayerId
                WHERE r.Id = @Id;
            ";

            using var conn = Connection;

            RosterEntry? entry = null;

            await conn.QueryAsync<RosterEntry, Player, RosterEntry>(
                sql,
                (r, p) =>
                {
                    if (entry == null)
                        entry = r;

                    entry.Player = p;
                    return entry;
                },
                new { Id = id },
                splitOn: "PlayerId"
            );

            return entry;
        }

        // =========================================================
        // CREATE ROSTER ENTRY
        // =========================================================
        public async Task<Guid> CreateAsync(CreateRosterEntryDto dto)
        {
            var id = Guid.NewGuid();

            var sql = @"
                INSERT INTO RosterEntries (
                    Id, TeamId, PlayerId, JerseyNumber, Position, Shoots, gamedayStatus,
                    LineNumber, Grade, Notes, IsCaptain, IsAssistantCaptain,
                    IsGoalie, IsActive, CreatedAt, UpdatedAt
                )
                VALUES (
                    @Id, @TeamId, @PlayerId, @JerseyNumber, @Position, @Shoots, @GamedayStatus,
                    @LineNumber, @Grade, @Notes, @IsCaptain, @IsAssistantCaptain,
                    @IsGoalie, @IsActive, @CreatedAt, @UpdatedAt
                );
            ";

            using var conn = Connection;

            await conn.ExecuteAsync(sql, new
            {
                Id = id,
                dto.TeamId,
                dto.PlayerId,
                dto.JerseyNumber,
                dto.Position,
                dto.Shoots,
                GamedayStatus = dto.GamedayStatus,
                dto.LineNumber,
                dto.Grade,
                dto.Notes,
                dto.IsCaptain,
                dto.IsAssistantCaptain,
                dto.IsGoalie,
                dto.IsActive,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });

            return id;
        }

        // =========================================================
        // UPDATE ROSTER ENTRY
        // =========================================================
        public async Task UpdateAsync(Guid id, UpdateRosterEntryDto dto)
        {
            var sql = @"
                UPDATE RosterEntries
                SET
                    JerseyNumber = @JerseyNumber,
                    Position = @Position,
                    Shoots = @Shoots,
                    gamedayStatus = @GamedayStatus,
                    LineNumber = @LineNumber,
                    Grade = @Grade,
                    Notes = @Notes,
                    IsCaptain = @IsCaptain,
                    IsAssistantCaptain = @IsAssistantCaptain,
                    IsGoalie = @IsGoalie,
                    IsActive = @IsActive,
                    UpdatedAt = @UpdatedAt
                WHERE Id = @Id;
            ";

            using var conn = Connection;

            await conn.ExecuteAsync(sql, new
            {
                Id = id,
                dto.JerseyNumber,
                dto.Position,
                dto.Shoots,
                GamedayStatus = dto.GamedayStatus,
                dto.LineNumber,
                dto.Grade,
                dto.Notes,
                dto.IsCaptain,
                dto.IsAssistantCaptain,
                dto.IsGoalie,
                dto.IsActive,
                UpdatedAt = DateTime.UtcNow
            });
        }

        // =========================================================
        // DELETE ROSTER ENTRY
        // =========================================================
        public async Task DeleteAsync(Guid id)
        {
            var sql = "DELETE FROM RosterEntries WHERE Id = @Id;";

            using var conn = Connection;

            await conn.ExecuteAsync(sql, new { Id = id });
        }

        // =========================================================
        // GET AVAILABLE PLAYERS FOR TEAM
        // Returns: active players assigned to team but NOT on roster
        // =========================================================
        public async Task<IEnumerable<Player>> GetAvailablePlayersAsync(Guid teamId)
        {
            var sql = @"
                SELECT DISTINCT
                    p.PlayerId,
                    p.FirstName,
                    p.LastName,
                    p.FullName,
                    p.BirthDate,
                    p.Grade,
                    p.HeightInches,
                    p.WeightLbs,
                    p.Shoots,
                    p.Position,
                    p.JerseyNumber,
                    p.IsActive,
                    p.CreatedAt,
                    p.UpdatedAt
                FROM Players p
                INNER JOIN PlayerTeams pt ON pt.PlayerId = p.PlayerId
                WHERE pt.TeamId = @TeamId
                  AND p.IsActive = 1
                  AND p.PlayerId NOT IN (
                      SELECT PlayerId FROM RosterEntries WHERE TeamId = @TeamId
                  )
                ORDER BY p.LastName ASC, p.FirstName ASC;
            ";

            using var conn = Connection;

            var players = await conn.QueryAsync<Player>(sql, new { TeamId = teamId });
            return players;
        }
    }
}
