using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using TipInAPI.Models;
using TipInAPI.DTOs;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;

namespace TipInAPI.Repositories
{
    public class PlayersRepository : IPlayersRepository
    {
        private readonly string _connectionString;

        public PlayersRepository(IConfiguration config)
        {
            _connectionString = config.GetConnectionString("DefaultConnection");
        }

        private IDbConnection Connection => new SqlConnection(_connectionString);

        // =========================================================
        // GET PLAYER BY ID (FULL DTO WITH MULTI-TEAM SUPPORT)
        // =========================================================
        public async Task<PlayerDto?> GetByIdAsync(Guid id)
        {
            const string sql = @"
                SELECT
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
                    p.OrganizationId,
                    o.Name AS OrganizationName,

                    pt.TeamId,
                    t.Name AS TeamName,
                    t.LevelId,
                    l.Name AS LevelName

                FROM Players p
                LEFT JOIN Organizations o ON p.OrganizationId = o.OrganizationId
                LEFT JOIN PlayerTeams pt ON p.PlayerId = pt.PlayerId
                LEFT JOIN Teams t ON pt.TeamId = t.Id
                LEFT JOIN Levels l ON t.LevelId = l.Id
                WHERE p.PlayerId = @Id;
            ";

            using var conn = Connection;

            var lookup = new Dictionary<Guid, PlayerDto>();

            await conn.QueryAsync<PlayerDto, PlayerTeamDto, PlayerDto>(
                sql,
                (player, team) =>
                {
                    if (!lookup.TryGetValue(player.PlayerId, out var dto))
                    {
                        dto = player;
                        dto.Teams = new List<PlayerTeamDto>();
                        lookup.Add(dto.PlayerId, dto);
                    }

                    if (team != null && team.TeamId != Guid.Empty)
                        dto.Teams.Add(team);

                    return dto;
                },
                new { Id = id },
                splitOn: "TeamId"
            );

            return lookup.Values.FirstOrDefault();
        }

        // =========================================================
        // GET ALL PLAYERS (RAW MODEL)
        // =========================================================
        public async Task<IEnumerable<Player>> GetAllAsync()
        {
            const string sql = @"
                SELECT 
                    PlayerId,
                    FirstName,
                    LastName,
                    FullName,
                    BirthDate,
                    Grade,
                    HeightInches,
                    WeightLbs,
                    Shoots,
                    Position,
                    CreatedAt,
                    UpdatedAt,
                    OrganizationId,
                    JerseyNumber,
                    IsActive
                FROM Players
                ORDER BY LastName, FirstName;
            ";

            using var conn = Connection;
            return await conn.QueryAsync<Player>(sql);
        }

        // =========================================================
        // GET ALL PLAYERS (DTO WITH MULTI-TEAM SUPPORT)
        // =========================================================
        public async Task<IEnumerable<PlayerListItemDto>> GetAllDtosAsync()
        {
            const string sql = @"
                SELECT
                    p.PlayerId AS Id,
                    p.FirstName,
                    p.LastName,
                    p.FullName,
                    p.Grade,
                    p.JerseyNumber,
                    p.Position,
                    p.Shoots,
                    p.OrganizationId,
                    o.Name AS OrganizationName,

                    CASE WHEN p.IsActive = 1 THEN 'Active' ELSE 'Inactive' END AS Status,

                    pt.TeamId,
                    t.Name AS TeamName,
                    t.LevelId,
                    l.Name AS LevelName

                FROM Players p
                LEFT JOIN Organizations o ON p.OrganizationId = o.OrganizationId
                LEFT JOIN PlayerTeams pt ON p.PlayerId = pt.PlayerId
                LEFT JOIN Teams t ON pt.TeamId = t.Id
                LEFT JOIN Levels l ON t.LevelId = l.Id
                ORDER BY p.LastName, p.FirstName;
            ";

            using var conn = Connection;

            var lookup = new Dictionary<Guid, PlayerListItemDto>();

            await conn.QueryAsync<PlayerListItemDto, PlayerTeamDto, PlayerListItemDto>(
                sql,
                (player, team) =>
                {
                    if (!lookup.TryGetValue(player.Id, out var dto))
                    {
                        dto = player;
                        dto.Teams = new List<PlayerTeamDto>();
                        lookup.Add(dto.Id, dto);
                    }

                    if (team != null && team.TeamId != Guid.Empty)
                        dto.Teams.Add(team);

                    return dto;
                },
                splitOn: "TeamId"
            );

            return lookup.Values;
        }

        // =========================================================
        // CREATE PLAYER (multi-team)
        // =========================================================
        public async Task<Guid> CreateAsync(CreatePlayerDto dto)
        {
            var id = Guid.NewGuid();

            const string sql = @"
                INSERT INTO Players (
                    PlayerId,
                    FirstName,
                    LastName,
                    BirthDate,
                    Grade,
                    HeightInches,
                    WeightLbs,
                    Shoots,
                    Position,
                    CreatedAt,
                    UpdatedAt,
                    OrganizationId,
                    JerseyNumber,
                    IsActive
                )
                VALUES (
                    @Id,
                    @FirstName,
                    @LastName,
                    @BirthDate,
                    @Grade,
                    @HeightInches,
                    @WeightLbs,
                    @Shoots,
                    @Position,
                    @CreatedAt,
                    @UpdatedAt,
                    @OrganizationId,
                    @JerseyNumber,
                    @IsActive
                );
            ";

            using var conn = Connection;

            await conn.ExecuteAsync(sql, new
            {
                Id = id,
                dto.FirstName,
                dto.LastName,
                dto.BirthDate,
                dto.Grade,
                dto.HeightInches,
                dto.WeightLbs,
                dto.Shoots,
                dto.Position,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
                dto.OrganizationId,
                dto.JerseyNumber,
                dto.IsActive
            });

            // Insert multi-team associations
            if (dto.TeamIds != null)
            {
                foreach (var teamId in dto.TeamIds)
                {
                    await conn.ExecuteAsync(
                        "INSERT INTO PlayerTeams (PlayerId, TeamId) VALUES (@PlayerId, @TeamId)",
                        new { PlayerId = id, TeamId = teamId }
                    );
                }
            }

            return id;
        }

        // =========================================================
        // UPDATE PLAYER (multi-team)
        // =========================================================
        public async Task UpdateAsync(Guid id, UpdatePlayerDto dto)
        {
            const string sqlUpdatePlayer = @"
                UPDATE Players
                SET
                    FirstName = @FirstName,
                    LastName = @LastName,
                    BirthDate = @BirthDate,
                    Grade = @Grade,
                    HeightInches = @HeightInches,
                    WeightLbs = @WeightLbs,
                    Shoots = @Shoots,
                    Position = @Position,
                    UpdatedAt = @UpdatedAt,
                    OrganizationId = @OrganizationId,
                    JerseyNumber = @JerseyNumber,
                    IsActive = @IsActive
                WHERE PlayerId = @Id;
            ";

            using (var conn = Connection)
            {
                // Update player fields
                var affected = await conn.ExecuteAsync(sqlUpdatePlayer, new
                {
                    Id = id,
                    dto.FirstName,
                    dto.LastName,
                    dto.BirthDate,
                    dto.Grade,
                    dto.HeightInches,
                    dto.WeightLbs,
                    dto.Shoots,
                    dto.Position,
                    UpdatedAt = DateTime.UtcNow,
                    dto.OrganizationId,
                    dto.JerseyNumber,
                    dto.IsActive
                });

                if (affected == 0)
                    throw new Exception($"Player with ID {id} not found.");

                // Update team assignments
                if (dto.TeamIds != null && dto.TeamIds.Count > 0)
                {
                    // Test: Only delete RosterEntries, don't touch PlayerTeams
                    Console.WriteLine($"[DEBUG] Step 1: Deleting RosterEntries for player {id}");
                    try
                    {
                        await conn.ExecuteAsync(
                            "DELETE FROM RosterEntries WHERE PlayerId = @PlayerId",
                            new { PlayerId = id }
                        );
                        Console.WriteLine($"[DEBUG] Step 1: SUCCESS - RosterEntries deleted");
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[DEBUG] Step 1: FAILED - {ex.Message}");
                        throw;
                    }
                    
                    Console.WriteLine($"[DEBUG] Step 2: Deleting PlayerTeams for player {id}");
                    try
                    {
                        await conn.ExecuteAsync(
                            "DELETE FROM PlayerTeams WHERE PlayerId = @PlayerId",
                            new { PlayerId = id }
                        );
                        Console.WriteLine($"[DEBUG] Step 2: SUCCESS - PlayerTeams deleted");
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[DEBUG] Step 2: FAILED - {ex.Message}");
                        throw;
                    }

                    Console.WriteLine($"[DEBUG] Step 3: Inserting PlayerTeams");
                    foreach (var teamId in dto.TeamIds)
                    {
                        try
                        {
                            await conn.ExecuteAsync(
                                "INSERT INTO PlayerTeams (PlayerId, TeamId) VALUES (@PlayerId, @TeamId)",
                                new { PlayerId = id, TeamId = teamId }
                            );
                            Console.WriteLine($"[DEBUG] Step 3: SUCCESS - Inserted PlayerId={id}, TeamId={teamId}");
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"[DEBUG] Step 3: FAILED - {ex.Message}");
                            throw;
                        }
                    }
                }
            }
        }

        // =========================================================
        // DELETE PLAYER
        // =========================================================
        public async Task DeleteAsync(Guid id)
        {
            using var conn = Connection;

            await conn.ExecuteAsync("DELETE FROM PlayerTeams WHERE PlayerId = @Id", new { Id = id });
            await conn.ExecuteAsync("DELETE FROM Players WHERE PlayerId = @Id", new { Id = id });
        }
    }
}
