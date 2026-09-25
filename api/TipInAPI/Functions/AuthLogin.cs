using System;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Threading.Tasks;
using BCrypt.Net;
using Dapper;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using TipInAPI.Infrastructure.Database;

namespace TipInAPI.Functions
{
    public class AuthLogin
    {
        private readonly ISqlConnectionFactory _connectionFactory;
        private readonly IConfiguration _config;
        private readonly ILogger<AuthLogin> _logger;

        public AuthLogin(ISqlConnectionFactory connectionFactory, IConfiguration config, ILogger<AuthLogin> logger)
        {
            _connectionFactory = connectionFactory;
            _config = config;
            _logger = logger;
        }

        [Function("AuthLogin")]
        public async Task<HttpResponseData> Run(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "auth/login")] HttpRequestData req)
        {
            try
            {
                var body = await req.ReadFromJsonAsync<LoginRequest>();
                if (body == null || string.IsNullOrWhiteSpace(body.Email) || string.IsNullOrWhiteSpace(body.Password))
                {
                    var bad = req.CreateResponse(System.Net.HttpStatusCode.BadRequest);
                    await bad.WriteStringAsync("Email and password are required.");
                    return bad;
                }

                using var conn = _connectionFactory.CreateConnection();

                var user = await conn.QueryFirstOrDefaultAsync<AuthUser>(@"
                    SELECT TOP 1
                        au.Id,
                        au.Email,
                        au.PasswordHash,
                        au.Role,
                        o.OrganizationType
                    FROM dbo.AuthUsers au
                    LEFT JOIN dbo.Users u ON u.Id = au.Id
                    LEFT JOIN dbo.Organizations o ON o.OrganizationId = u.OrganizationId
                    WHERE au.Email = @Email AND au.IsActive = 1;",
                    new { Email = body.Email });

                if (user == null)
                {
                    var unauthorized = req.CreateResponse(System.Net.HttpStatusCode.Unauthorized);
                    await unauthorized.WriteStringAsync("Invalid login.");
                    return unauthorized;
                }

                // Verify password
                if (!BCrypt.Net.BCrypt.Verify(body.Password, user.PasswordHash))
                {
                    var unauthorized = req.CreateResponse(System.Net.HttpStatusCode.Unauthorized);
                    await unauthorized.WriteStringAsync("Invalid login.");
                    return unauthorized;
                }

                if (!string.Equals(user.Role, "SuperAdmin", StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(user.OrganizationType, "External", StringComparison.OrdinalIgnoreCase))
                {
                    var forbidden = req.CreateResponse(System.Net.HttpStatusCode.Forbidden);
                    await forbidden.WriteStringAsync("External Organizations do not have portal access.");
                    return forbidden;
                }

                // Generate JWT
                var token = GenerateJwtToken(user);

                var response = req.CreateResponse(System.Net.HttpStatusCode.OK);
                await response.WriteAsJsonAsync(new
                {
                    token,
                    role = user.Role,
                    userId = user.Id
                });

                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Login error");
                var error = req.CreateResponse(System.Net.HttpStatusCode.InternalServerError);
                await error.WriteStringAsync("Server error.");
                return error;
            }
        }

        private string GenerateJwtToken(AuthUser user)
        {
            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_config["Jwt:Key"]));
            var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

            var claims = new[]
            {
                new Claim(JwtRegisteredClaimNames.Sub, user.Email),
                new Claim("role", user.Role),
                new Claim("uid", user.Id.ToString())
            };

            var token = new JwtSecurityToken(
                issuer: _config["Jwt:Issuer"],
                audience: _config["Jwt:Audience"],
                claims: claims,
                expires: DateTime.UtcNow.AddHours(12),
                signingCredentials: creds
            );

            return new JwtSecurityTokenHandler().WriteToken(token);
        }

        private class LoginRequest
        {
            public string Email { get; set; }
            public string Password { get; set; }
        }

        private class AuthUser
        {
            public Guid Id { get; set; }
            public string Email { get; set; }
            public string PasswordHash { get; set; }
            public string Role { get; set; }
            public string? OrganizationType { get; set; }
        }
    }
}
