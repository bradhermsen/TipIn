using System.Net;
using System;
using System.Threading.Tasks;
using Dapper;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using System.Data;
using TipInAPI.Services;
using TipInAPI.Infrastructure.Authorization;
using TipInAPI.DTOs;

namespace TipInAPI.Functions
{
    public class OfficialsFunctions
    {
        private readonly IDbConnection _db;
        private readonly IAuthorizationService _authorizationService;

        public OfficialsFunctions(IDbConnection db, IAuthorizationService authorizationService)
        {
            _db = db;
            _authorizationService = authorizationService;
        }

        private async Task EnsureOfficialsEmailColumnAsync()
        {
            const string sql = @"
                IF COL_LENGTH('dbo.Officials', 'Email') IS NULL
                BEGIN
                    ALTER TABLE dbo.Officials
                    ADD Email NVARCHAR(255) NULL;
                END;";

            await _db.ExecuteAsync(sql);
        }

        [Function("GetOfficials")]
        public async Task<HttpResponseData> GetOfficials(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "officials")] HttpRequestData req)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view officials");

            await EnsureOfficialsEmailColumnAsync();

            var sql = @"
                SELECT
                    OfficialId,
                    FirstName,
                    LastName,
                    Email,
                    Role,
                    LTRIM(RTRIM(CONCAT(FirstName, ' ', LastName))) AS DisplayName
                FROM Officials
                WHERE IsActive = 1
                ORDER BY LastName, FirstName;
            ";

            var rows = await _db.QueryAsync(sql);
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(rows);
            return response;
        }

        [Function("GetAllOfficials")]
        public async Task<HttpResponseData> GetAllOfficials(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "officials/all")] HttpRequestData req)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view officials");

            await EnsureOfficialsEmailColumnAsync();

            var sql = @"
                SELECT
                    OfficialId,
                    FirstName,
                    LastName,
                    Email,
                    Role,
                    IsActive,
                    LTRIM(RTRIM(CONCAT(FirstName, ' ', LastName))) AS DisplayName
                FROM Officials
                ORDER BY LastName, FirstName;
            ";

            var rows = await _db.QueryAsync(sql);
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(rows);
            return response;
        }

        [Function("GetOfficialById")]
        public async Task<HttpResponseData> GetOfficialById(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "officials/{id:guid}")] HttpRequestData req,
            Guid id)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view official details");

            await EnsureOfficialsEmailColumnAsync();

            var sql = @"
                SELECT
                    OfficialId,
                    FirstName,
                    LastName,
                    Email,
                    Role,
                    IsActive,
                    LTRIM(RTRIM(CONCAT(FirstName, ' ', LastName))) AS DisplayName
                FROM Officials
                WHERE OfficialId = @OfficialId;
            ";

            var row = await _db.QuerySingleOrDefaultAsync(sql, new { OfficialId = id });
            if (row == null)
                return req.CreateResponse(HttpStatusCode.NotFound);

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync((object)row);
            return response;
        }

        [Function("CreateOfficial")]
        public async Task<HttpResponseData> CreateOfficial(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "officials")] HttpRequestData req)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin or OrgAdmin can create officials");

            var dto = await req.ReadFromJsonAsync<CreateOfficialDto>();
            if (dto == null || string.IsNullOrWhiteSpace(dto.FirstName) || string.IsNullOrWhiteSpace(dto.LastName))
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { message = "FirstName and LastName are required" });
                return bad;
            }

            await EnsureOfficialsEmailColumnAsync();

            var officialId = Guid.NewGuid();
            var sql = @"
                INSERT INTO Officials
                (
                    OfficialId,
                    FirstName,
                    LastName,
                    Email,
                    Role,
                    IsActive,
                    CreatedAt,
                    UpdatedAt
                )
                VALUES
                (
                    @OfficialId,
                    @FirstName,
                    @LastName,
                    @Email,
                    @Role,
                    @IsActive,
                    SYSUTCDATETIME(),
                    SYSUTCDATETIME()
                );
            ";

            await _db.ExecuteAsync(sql, new
            {
                OfficialId = officialId,
                FirstName = dto.FirstName.Trim(),
                LastName = dto.LastName.Trim(),
                Email = string.IsNullOrWhiteSpace(dto.Email) ? null : dto.Email.Trim(),
                Role = string.IsNullOrWhiteSpace(dto.Role) ? null : dto.Role.Trim(),
                IsActive = dto.IsActive
            });

            var response = req.CreateResponse(HttpStatusCode.Created);
            await response.WriteAsJsonAsync(new { officialId });
            return response;
        }

        [Function("UpdateOfficial")]
        public async Task<HttpResponseData> UpdateOfficial(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "officials/{id:guid}")] HttpRequestData req,
            Guid id)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin or OrgAdmin can update officials");

            var dto = await req.ReadFromJsonAsync<UpdateOfficialDto>();
            if (dto == null || string.IsNullOrWhiteSpace(dto.FirstName) || string.IsNullOrWhiteSpace(dto.LastName))
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { message = "FirstName and LastName are required" });
                return bad;
            }

            await EnsureOfficialsEmailColumnAsync();

            var sql = @"
                UPDATE Officials
                SET
                    FirstName = @FirstName,
                    LastName = @LastName,
                    Email = @Email,
                    Role = @Role,
                    IsActive = @IsActive,
                    UpdatedAt = SYSUTCDATETIME()
                WHERE OfficialId = @OfficialId;
            ";

            var affected = await _db.ExecuteAsync(sql, new
            {
                OfficialId = id,
                FirstName = dto.FirstName.Trim(),
                LastName = dto.LastName.Trim(),
                Email = string.IsNullOrWhiteSpace(dto.Email) ? null : dto.Email.Trim(),
                Role = string.IsNullOrWhiteSpace(dto.Role) ? null : dto.Role.Trim(),
                IsActive = dto.IsActive
            });

            if (affected == 0)
                return req.CreateResponse(HttpStatusCode.NotFound);

            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        [Function("DeleteOfficial")]
        public async Task<HttpResponseData> DeleteOfficial(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "officials/{id:guid}")] HttpRequestData req,
            Guid id)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin or OrgAdmin can delete officials");

            var usageSql = @"
                SELECT COUNT(1)
                FROM GameOfficials
                WHERE OfficialId = @OfficialId;
            ";

            var usageCount = await _db.ExecuteScalarAsync<int>(usageSql, new { OfficialId = id });
            if (usageCount > 0)
            {
                var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                await conflict.WriteAsJsonAsync(new
                {
                    message = "Cannot delete official because they are assigned to one or more games. Remove assignments first."
                });
                return conflict;
            }

            var sql = @"
                DELETE FROM Officials
                WHERE OfficialId = @OfficialId;
            ";

            var affected = await _db.ExecuteAsync(sql, new { OfficialId = id });
            if (affected == 0)
                return req.CreateResponse(HttpStatusCode.NotFound);

            return req.CreateResponse(HttpStatusCode.NoContent);
        }
    }
}