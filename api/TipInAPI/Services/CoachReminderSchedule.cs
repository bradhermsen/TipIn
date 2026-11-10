using System;

namespace TipInAPI.Services
{
    public static class CoachReminderSchedule
    {
        public static TimeZoneInfo Central => TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");

        public static DateTime LocalNow(DateTime utcNow) =>
            TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utcNow, DateTimeKind.Utc), Central);

        public static string? DueType(DateTime gameTime, DateTime utcNow)
        {
            var localNow = LocalNow(utcNow);
            if (localNow >= gameTime) return null;
            var reviewAt = gameTime.Date.AddDays(-3).AddHours(9);
            var finalAt = gameTime.Hour < 10
                ? gameTime.Date.AddDays(-1).AddHours(18)
                : gameTime.Date.AddHours(8);
            if (localNow >= finalAt) return "LineupReminder";
            return localNow >= reviewAt ? "RosterReview" : null;
        }
    }
}
