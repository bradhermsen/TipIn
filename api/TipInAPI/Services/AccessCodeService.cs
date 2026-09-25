using System;
using System.Security.Cryptography;
using TipInAPI.Infrastructure.Configuration;

namespace TipInAPI.Services
{
    public interface IAccessCodeService
    {
        string GenerateGameManagerCode();
        string GenerateStatManagerCode();
        bool IsValidGameDay(DateTime gameDateTime);
        bool IsCodeExpired(DateTime? codeExpiresAt);
        DateTime CalculateCodeExpiration(DateTime gameFinalTime);
    }

    public class AccessCodeService : IAccessCodeService
    {
        /// <summary>
        /// Generate a Game Manager access code: GM-XXXXXX
        /// Uses cryptographically secure random for uniqueness.
        /// </summary>
        public string GenerateGameManagerCode()
        {
            const string prefix = "GM-";
            return prefix + GenerateRandomSegment(6);
        }

        /// <summary>
        /// Generate a Stat Manager access code: SM-XXXXXX
        /// Uses cryptographically secure random for uniqueness.
        /// </summary>
        public string GenerateStatManagerCode()
        {
            const string prefix = "SM-";
            return prefix + GenerateRandomSegment(6);
        }

        /// <summary>
        /// Check if code is still valid (not expired).
        /// Returns true if codeExpiresAt is null or in the future.
        /// </summary>
        public bool IsCodeExpired(DateTime? codeExpiresAt)
        {
            if (codeExpiresAt == null)
                return false; // No expiration set, still valid

            return DateTime.UtcNow > codeExpiresAt;
        }

        /// <summary>
        /// Check if access is allowed on game day.
        /// Valid starting at 12:01 AM on game day.
        /// </summary>
        public bool IsValidGameDay(DateTime gameDateTime)
        {
            DateTime today = DateTime.UtcNow.Date;
            DateTime gameDay = gameDateTime.Date;

            // Allow access from game day 12:01 AM onwards
            DateTime gameDay_12_01_AM = gameDay.AddHours(0).AddMinutes(1);

            return DateTime.UtcNow >= gameDay_12_01_AM && DateTime.UtcNow < gameDay.AddDays(1);
        }

        /// <summary>
        /// Calculate when a code expires: 2 hours after game marked final.
        /// </summary>
        public DateTime CalculateCodeExpiration(DateTime gameFinalTime)
        {
            return gameFinalTime.AddHours(2);
        }

        /// <summary>
        /// Generate a random alphanumeric segment for access codes.
        /// Uses uppercase letters and numbers (16 characters).
        /// </summary>
        private string GenerateRandomSegment(int length)
        {
            const string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            using (var rng = new RNGCryptoServiceProvider())
            {
                byte[] data = new byte[length];
                rng.GetBytes(data);

                char[] result = new char[length];
                for (int i = 0; i < length; i++)
                {
                    result[i] = chars[data[i] % chars.Length];
                }

                return new string(result);
            }
        }
    }
}
