using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using TipInAPI.DTOs;
using TipInAPI.Models;
using TipInAPI.Repositories;

namespace TipInAPI.Services
{
    public class RosterEntriesService : IRosterEntriesService
    {
        private readonly IRosterEntriesRepository _repo;
        private readonly IPlayersRepository _playersRepo;
        private readonly ITeamsRepository _teamsRepo;

        public RosterEntriesService(
            IRosterEntriesRepository repo,
            IPlayersRepository playersRepo,
            ITeamsRepository teamsRepo)
        {
            _repo = repo;
            _playersRepo = playersRepo;
            _teamsRepo = teamsRepo;
        }

        // =========================================================
        // GET ROSTER FOR TEAM
        // =========================================================
        public async Task<IEnumerable<RosterEntryDto>> GetByTeamIdAsync(Guid teamId)
        {
            var team = await _teamsRepo.GetByIdAsync(teamId);
            if (team == null)
                throw new Exception("Team not found.");

            var entries = await _repo.GetByTeamIdAsync(teamId);
            var list = new List<RosterEntryDto>();

            foreach (var r in entries)
                list.Add(MapToDto(r));

            return list;
        }

        // =========================================================
        // GET SINGLE ROSTER ENTRY
        // =========================================================
        public async Task<RosterEntryDto?> GetByIdAsync(Guid id)
        {
            var entry = await _repo.GetByIdAsync(id);
            return entry == null ? null : MapToDto(entry);
        }

        // =========================================================
        // CREATE ROSTER ENTRY
        // =========================================================
        public async Task<Guid> CreateAsync(CreateRosterEntryDto dto)
        {
            var team = await _teamsRepo.GetByIdAsync(dto.TeamId);
            if (team == null)
                throw new Exception("Team not found.");

            var player = await _playersRepo.GetByIdAsync(dto.PlayerId);
            if (player == null)
                throw new Exception("Player not found.");

            return await _repo.CreateAsync(dto);
        }

        // =========================================================
        // UPDATE ROSTER ENTRY
        // =========================================================
        public async Task UpdateAsync(Guid id, UpdateRosterEntryDto dto)
        {
            var existing = await _repo.GetByIdAsync(id);
            if (existing == null)
                throw new Exception("Roster entry not found.");

            await _repo.UpdateAsync(id, dto);
        }

        // =========================================================
        // DELETE ROSTER ENTRY
        // =========================================================
        public async Task DeleteAsync(Guid id)
        {
            var existing = await _repo.GetByIdAsync(id);
            if (existing == null)
                throw new Exception("Roster entry not found.");

            await _repo.DeleteAsync(id);
        }

        // =========================================================
        // GET AVAILABLE PLAYERS FOR TEAM (for add modal)
        // =========================================================
        public async Task<IEnumerable<PlayerDto>> GetAvailablePlayersAsync(Guid teamId)
        {
            var players = await _repo.GetAvailablePlayersAsync(teamId);
            var list = new List<PlayerDto>();

            foreach (var p in players)
            {
                list.Add(new PlayerDto
                {
                    PlayerId = p.PlayerId,
                    FirstName = p.FirstName,
                    LastName = p.LastName,
                    FullName = p.FullName,
                    Grade = p.Grade,
                    Shoots = p.Shoots,
                    Position = p.Position,
                    JerseyNumber = p.JerseyNumber,
                    IsActive = p.IsActive
                });
            }

            return list;
        }

        // =========================================================
        // INTERNAL MAPPING
        // =========================================================
        private RosterEntryDto MapToDto(RosterEntry r)
        {
            var p = r.Player;

            return new RosterEntryDto
            {
                RosterEntryId = r.Id,
                TeamId = r.TeamId,
                PlayerId = r.PlayerId,

                // Player identity
                FirstName = p?.FirstName,
                LastName = p?.LastName,
                FullName = p?.FullName,

                // Attributes (roster overrides player)
                Position = r.Position ?? p?.Position,
                Shoots = r.Shoots ?? p?.Shoots,

                // Grade: roster overrides player grade
                Grade = r.Grade ?? p?.Grade,

                // Roster-specific (fall back to player data if not set on roster)
                JerseyNumber = r.JerseyNumber ?? p?.JerseyNumber,
                GamedayStatus = r.GamedayStatus ?? "Active", // Default to "Active" if not set
                LineNumber = r.LineNumber,
                Notes = r.Notes,

                // Flags
                IsCaptain = r.IsCaptain,
                IsAssistantCaptain = r.IsAssistantCaptain,
                IsGoalie = r.IsGoalie,
                IsActive = r.IsActive,

                // System
                CreatedAt = r.CreatedAt,
                UpdatedAt = r.UpdatedAt
            };
        }
    }
}
