using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Text;
using System.Security.Claims;
using Microsoft.IdentityModel.Tokens;
using TipInAPI.Infrastructure.Configuration;

namespace TipInAPI.Services
{
    public interface IAuthorizationService
    {
        (bool IsValid, string UserId, string Role) ValidateToken(string bearerToken);
        bool HasRole(string role, params string[] allowedRoles);
        bool HasAnyRole(string role, params string[] allowedRoles);
    }

    public class AuthorizationService : IAuthorizationService
    {
        private readonly string _jwtSecret;
        private readonly JwtSecurityTokenHandler _tokenHandler = new JwtSecurityTokenHandler();

        public AuthorizationService(string jwtSecret = "your-super-secret-key-at-least-32-characters-long")
        {
            _jwtSecret = jwtSecret;
        }

        /// <summary>
        /// Validate a Bearer token from Authorization header.
        /// Returns (IsValid, UserId, Role).
        /// </summary>
        public (bool IsValid, string UserId, string Role) ValidateToken(string bearerToken)
        {
            if (string.IsNullOrEmpty(bearerToken))
                return (false, null, null);

            try
            {
                // Remove "Bearer " prefix if present
                string token = bearerToken.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
                    ? bearerToken.Substring("Bearer ".Length)
                    : bearerToken;

                var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwtSecret));
                var validationParameters = new TokenValidationParameters
                {
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = key,
                    ValidateIssuer = false,
                    ValidateAudience = false,
                    ValidateLifetime = true,
                    ClockSkew = TimeSpan.Zero
                };

                var principal = _tokenHandler.ValidateToken(token, validationParameters, out var validatedToken);

                // Extract claims. Login tokens emit custom "uid" and "role" claims.
                var userIdClaim = principal.FindFirst("uid")?.Value
                    ?? principal.FindFirst("sub")?.Value
                    ?? principal.FindFirst("nameid")?.Value;
                var roleClaim = principal.FindFirst("role")?.Value
                    ?? principal.FindFirst(ClaimTypes.Role)?.Value
                    ?? principal.FindFirst("http://schemas.microsoft.com/ws/2008/06/identity/claims/role")?.Value;

                if (string.IsNullOrEmpty(userIdClaim))
                    return (false, null, null);

                return (true, userIdClaim, roleClaim ?? "Viewer");
            }
            catch
            {
                return (false, null, null);
            }
        }

        /// <summary>
        /// Check if user's role matches one of the allowed roles.
        /// </summary>
        public bool HasRole(string role, params string[] allowedRoles)
        {
            if (string.IsNullOrEmpty(role))
                return false;

            return allowedRoles.Contains(role, StringComparer.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Check if user's role matches any of the allowed roles (alias for HasRole).
        /// </summary>
        public bool HasAnyRole(string role, params string[] allowedRoles)
        {
            return HasRole(role, allowedRoles);
        }
    }
}
