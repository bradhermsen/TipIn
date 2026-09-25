using Microsoft.EntityFrameworkCore;
using TipInAPI.Models;

namespace TipInAPI.Infrastructure.Database
{
    public class TipInDbContext : DbContext
    {
        public TipInDbContext(DbContextOptions<TipInDbContext> options)
            : base(options)
        {
        }

        public DbSet<GamePenalty> GamePenalties => Set<GamePenalty>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<GamePenalty>(entity =>
            {
                entity.ToTable("GamePenalties", "dbo");

                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).HasDefaultValueSql("NEWID()");

                entity.Property(e => e.Infraction)
                    .HasMaxLength(100)
                    .IsRequired();

                entity.Property(e => e.TimeInPeriod)
                    .HasMaxLength(10)
                    .IsRequired();

                entity.Property(e => e.CreatedAt)
                    .HasDefaultValueSql("SYSUTCDATETIME()");

                entity.HasIndex(e => new { e.GameId, e.Period, e.TimeInPeriod })
                    .HasDatabaseName("IX_GamePenalties_GameId_Period_TimeInPeriod");
            });
        }
    }
}
