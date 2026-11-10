using System;
using TipInAPI.Services;
using Xunit;

namespace TipInAPI.Tests
{
    public class CoachGameReminderTests
    {
        [Theory]
        [InlineData("Scheduled", 0, false, true)]
        [InlineData("Scheduled", 2, false, true)]
        [InlineData("In Progress", 0, false, true)]
        [InlineData("Scheduled", -1, false, false)]
        [InlineData("Scheduled", 2, true, false)]
        [InlineData("Final", 0, false, false)]
        [InlineData("Completed", 0, false, false)]
        [InlineData("Closed", 0, false, false)]
        [InlineData("Cancelled", 2, false, false)]
        [InlineData("Postponed", 2, false, false)]
        public void NeedsLineup_OnlyForUnsignedCurrentOrUpcomingGames(string status, int days, bool locked, bool expected)
        {
            var game = new CoachGameItem { Status = status, GameDateTime = DateTime.UtcNow.Date.AddDays(days), Locked = locked };
            Assert.Equal(expected, game.NeedsLineup);
        }
    }
}
