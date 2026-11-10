using System.Linq;

namespace TipInAPI.Infrastructure
{
    public static class TeamNameFormatter
    {
        public static string Format(string? name, string? level, string? type)
        {
            var label = string.Join(" ", new[] { name?.Trim(), level?.Trim() }
                .Where(part => !string.IsNullOrEmpty(part)));
            return string.IsNullOrWhiteSpace(type) ? label : $"{label} - {type.Trim()}";
        }
    }
}
