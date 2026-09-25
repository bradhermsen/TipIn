using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TipInAPI.Infrastructure.Database.Migrations
{
    public partial class CreateGamePenalties : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "GamePenalties",
                schema: "dbo",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false, defaultValueSql: "NEWID()"),
                    GameId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    EventId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TeamId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PlayerId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ServedByPlayerId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Infraction = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    DurationMinutes = table.Column<int>(type: "int", nullable: false),
                    Period = table.Column<int>(type: "int", nullable: false),
                    TimeInPeriod = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    Notes = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "SYSUTCDATETIME()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GamePenalties", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GamePenalties_GameEvents",
                        column: x => x.EventId,
                        principalSchema: "dbo",
                        principalTable: "GameEvents",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_GamePenalties_Games",
                        column: x => x.GameId,
                        principalSchema: "dbo",
                        principalTable: "Games",
                        principalColumn: "GameId");
                    table.ForeignKey(
                        name: "FK_GamePenalties_Players_PlayerId",
                        column: x => x.PlayerId,
                        principalSchema: "dbo",
                        principalTable: "Players",
                        principalColumn: "PlayerId");
                    table.ForeignKey(
                        name: "FK_GamePenalties_Players_ServedByPlayerId",
                        column: x => x.ServedByPlayerId,
                        principalSchema: "dbo",
                        principalTable: "Players",
                        principalColumn: "PlayerId");
                    table.ForeignKey(
                        name: "FK_GamePenalties_Teams",
                        column: x => x.TeamId,
                        principalSchema: "dbo",
                        principalTable: "Teams",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_GamePenalties_EventId",
                schema: "dbo",
                table: "GamePenalties",
                column: "EventId");

            migrationBuilder.CreateIndex(
                name: "IX_GamePenalties_GameId_Period_TimeInPeriod",
                schema: "dbo",
                table: "GamePenalties",
                columns: new[] { "GameId", "Period", "TimeInPeriod" });

            migrationBuilder.CreateIndex(
                name: "IX_GamePenalties_PlayerId",
                schema: "dbo",
                table: "GamePenalties",
                column: "PlayerId");

            migrationBuilder.CreateIndex(
                name: "IX_GamePenalties_ServedByPlayerId",
                schema: "dbo",
                table: "GamePenalties",
                column: "ServedByPlayerId");

            migrationBuilder.CreateIndex(
                name: "IX_GamePenalties_TeamId",
                schema: "dbo",
                table: "GamePenalties",
                column: "TeamId");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GamePenalties",
                schema: "dbo");
        }
    }
}
