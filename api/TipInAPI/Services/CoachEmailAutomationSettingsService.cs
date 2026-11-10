using System.Threading;
using System.Threading.Tasks;
using System.Text.Json.Serialization;
using Dapper;
using TipInAPI.Infrastructure.Database;

namespace TipInAPI.Services
{
    /// <summary>Global switches for automatic coach emails; manual invitations are unaffected.</summary>
    public sealed record CoachEmailAutomationSettings
    {
        [JsonRequired] public bool AutomaticInvitations { get; init; }
        [JsonRequired] public bool RosterReminders { get; init; }
        [JsonRequired] public bool LineupReminders { get; init; }
    }

    public interface ICoachEmailAutomationSettingsService
    {
        Task<CoachEmailAutomationSettings> GetAsync(CancellationToken cancellationToken = default);
        Task SaveAsync(CoachEmailAutomationSettings settings, CancellationToken cancellationToken = default);
    }

    public sealed class CoachEmailAutomationSettingsService : ICoachEmailAutomationSettingsService
    {
        private readonly ISqlConnectionFactory _db;
        public CoachEmailAutomationSettingsService(ISqlConnectionFactory db) { _db = db; }

        public async Task<CoachEmailAutomationSettings> GetAsync(CancellationToken cancellationToken = default)
        {
            using var conn = _db.CreateConnection();
            return await conn.QuerySingleAsync<CoachEmailAutomationSettings>(new CommandDefinition(@"
                SELECT AutomaticInvitations,RosterReminders,LineupReminders
                FROM dbo.CoachEmailAutomationSettings WHERE Id=1;", cancellationToken: cancellationToken));
        }

        public async Task SaveAsync(CoachEmailAutomationSettings settings, CancellationToken cancellationToken = default)
        {
            using var conn = _db.CreateConnection();
            await conn.ExecuteAsync(new CommandDefinition(@"
                UPDATE dbo.CoachEmailAutomationSettings SET AutomaticInvitations=@AutomaticInvitations,
                    RosterReminders=@RosterReminders,LineupReminders=@LineupReminders,UpdatedAtUtc=SYSUTCDATETIME()
                WHERE Id=1;
                IF @@ROWCOUNT <> 1 THROW 51000,'Coach email automation settings are missing; apply the migration.',1;",
                settings, cancellationToken: cancellationToken));
        }
    }
}
