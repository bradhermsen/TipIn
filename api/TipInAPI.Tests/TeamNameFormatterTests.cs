using System.Text.Json;
using TipInAPI.DTOs;
using TipInAPI.Infrastructure;
using TipInAPI.Services;
using Xunit;

namespace TipInAPI.Tests
{
    public class TeamNameFormatterTests
    {
        [Theory]
        [InlineData("Riverbend", "JV", "Boys", "Riverbend JV - Boys")]
        [InlineData("Riverbend", "Varsity", "Girls", "Riverbend Varsity - Girls")]
        [InlineData("Riverbend", "JV", "Co-Ed", "Riverbend JV - Co-Ed")]
        [InlineData(" Riverbend ", " JV ", " Boys ", "Riverbend JV - Boys")]
        [InlineData("Riverbend", null, "Boys", "Riverbend - Boys")]
        [InlineData("Riverbend", "JV", null, "Riverbend JV")]
        [InlineData("Riverbend", " ", "", "Riverbend")]
        public void FormatsTeamLevelAndType(string name, string? level, string? type, string expected)
        {
            Assert.Equal(expected, TeamNameFormatter.Format(name, level, type));
        }

        [Fact]
        public void DisplayNamesSerializeWithoutChangingRawNames()
        {
            var options = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
            var team = new CoachTeamDetailDto { TeamName = "Riverbend", LevelName = "JV", TeamType = "Boys" };
            using var json = JsonDocument.Parse(JsonSerializer.Serialize(team, options));
            Assert.Equal("Riverbend", json.RootElement.GetProperty("teamName").GetString());
            Assert.Equal("Riverbend JV - Boys", json.RootElement.GetProperty("teamDisplayName").GetString());

            var game = new CoachGameItem { OpponentName = "Riverbend", OpponentLevelName = "JV", OpponentTeamType = "Boys" };
            using var gameJson = JsonDocument.Parse(JsonSerializer.Serialize(game, options));
            Assert.Equal("Riverbend JV - Boys", gameJson.RootElement.GetProperty("opponentDisplayName").GetString());
        }
    }
}
