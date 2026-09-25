using System;
using System.Net;
using System.Threading.Tasks;
using System.Linq;
using Microsoft.Azure.Functions.Worker.Http;

namespace TipInAPI.Infrastructure.Authorization
{
    public static class AuthorizationHelper
    {
        /// <summary>
        /// Extract Bearer token from Authorization header.
        /// </summary>
        public static string ExtractBearerToken(HttpRequestData req)
        {
            // Dotnet‑isolated Functions store headers case‑insensitively.
            if (req.Headers.TryGetValues("authorization", out var values) ||
                req.Headers.TryGetValues("Authorization", out values))
            {
                var header = values.FirstOrDefault();
                if (!string.IsNullOrEmpty(header) &&
                    header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
                {
                    return header.Substring("Bearer ".Length);
                }
            }

            return null;
        }




        /// <summary>
        /// Create Unauthorized response (401).
        /// </summary>
        public static async Task<HttpResponseData> UnauthorizedResponse(HttpRequestData req, string message = "Unauthorized")
        {
            var response = req.CreateResponse(HttpStatusCode.Unauthorized);
            await response.WriteAsJsonAsync(new { error = message });
            return response;
        }

        /// <summary>
        /// Create Forbidden response (403).
        /// </summary>
        public static async Task<HttpResponseData> ForbiddenResponse(HttpRequestData req, string message = "Forbidden")
        {
            var response = req.CreateResponse(HttpStatusCode.Forbidden);
            await response.WriteAsJsonAsync(new { error = message });
            return response;
        }

        /// <summary>
        /// Create BadRequest response (400).
        /// </summary>
        public static async Task<HttpResponseData> BadRequestResponse(HttpRequestData req, string message = "Bad Request")
        {
            var response = req.CreateResponse(HttpStatusCode.BadRequest);
            await response.WriteAsJsonAsync(new { error = message });
            return response;
        }
    }
}
