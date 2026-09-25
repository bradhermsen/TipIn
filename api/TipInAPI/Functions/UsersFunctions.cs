using System;
using System.Collections.Generic;
using System.Net;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using TipInAPI.DTOs;
using TipInAPI.Services;
using TipInAPI.Infrastructure.Authorization;

namespace TipInAPI.Functions
{
    public class UsersFunctions
    {
        private readonly IUsersService _service;
        private readonly IAuthorizationService _authorizationService;

        public UsersFunctions(IUsersService service, IAuthorizationService authorizationService)
        {
            _service = service;
            _authorizationService = authorizationService;
        }

        // ============================================================
        // CREATE USER
        // ============================================================
        [Function("CreateUser")]
        public async Task<HttpResponseData> CreateUser(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "users")] HttpRequestData req)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // Only SuperAdmin and OrgAdmin can create users
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin or OrgAdmin can create users");

            CreateUserDto dto;

            try
            {
                dto = await req.ReadFromJsonAsync<CreateUserDto>();

                if (dto == null)
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteStringAsync("Request body could not be deserialized into CreateUserDto.");
                    return bad;
                }
            }
            catch (Exception ex)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteStringAsync($"JSON deserialization error: {ex.Message}");
                return bad;
            }

            try
            {
                var created = await _service.CreateUserAsync(
                    dto.Email,
                    dto.Password,
                    dto.Role,
                    dto.OrganizationId,
                    dto.FirstName,
                    dto.LastName,
                    dto.TeamIds ?? new List<Guid>()
                );

                var res = req.CreateResponse(HttpStatusCode.OK);
                await res.WriteAsJsonAsync(created);
                return res;
            }
            catch (Exception ex)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteStringAsync(ex.Message);
                return bad;
            }
        }

        // ============================================================
        // GET ALL USERS
        // ============================================================
        [Function("GetUsers")]
        public async Task<HttpResponseData> GetUsers(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "users")] HttpRequestData req)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // Only SuperAdmin and OrgAdmin can get all users
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin or OrgAdmin can view all users");

            var users = await _service.GetAllAsync();

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(users);
            return response;
        }

        // ============================================================
        // GET USER BY ID — Unified ID Model + Teams + Auth Info
        // ============================================================
        [Function("GetUserById")]
        public async Task<HttpResponseData> GetUserById(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "users/{id:guid}")] HttpRequestData req,
            Guid id)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // SuperAdmin bypass - full access
            if (role == "SuperAdmin")
            {
                var user = await _service.GetByIdAsync(id);
                if (user == null)
                    return req.CreateResponse(HttpStatusCode.NotFound);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(user);
                return response;
            }

            // Users can view their own record, OrgAdmin can view org users
            if (!_authorizationService.HasAnyRole(role, "OrgAdmin", "Viewer"))
            {
                if (Guid.Parse(userId) != id)
                    return await AuthorizationHelper.ForbiddenResponse(req, "You can only view your own user record");
            }

            var userData = await _service.GetByIdAsync(id);
            if (userData == null)
                return req.CreateResponse(HttpStatusCode.NotFound);
            var result = req.CreateResponse(HttpStatusCode.OK);
            await result.WriteAsJsonAsync(userData);
            return result;
        }


        // ============================================================
        // UPDATE USER
        // ============================================================
        [Function("UpdateUser")]
        public async Task<HttpResponseData> UpdateUser(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "users/{id:guid}")] HttpRequestData req,
            Guid id)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // User can update own record, or SuperAdmin/OrgAdmin can update any user
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
            {
                if (Guid.Parse(userId) != id)
                    return await AuthorizationHelper.ForbiddenResponse(req, "You can only update your own user record");
            }

            var dto = await req.ReadFromJsonAsync<UpdateUserDto>();

            try
            {
                await _service.UpdateUserAsync(
                    id,
                    dto.Email,
                    dto.FirstName,
                    dto.LastName,
                    dto.OrganizationId,
                    dto.Role,
                    dto.IsActive,
                    dto.Password,
                    dto.TeamIds ?? new List<Guid>()
                );

                var res = req.CreateResponse(HttpStatusCode.OK);
                await res.WriteAsJsonAsync(new { success = true });
                return res;
            }
            catch (Exception ex)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteStringAsync(ex.Message);
                return bad;
            }
        }

        // ============================================================
        // RESET PASSWORD
        // ============================================================
        [Function("ResetPassword")]
        public async Task<HttpResponseData> ResetPassword(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "users/{id:guid}/password")] HttpRequestData req,
            Guid id)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // User can reset own password, or SuperAdmin/OrgAdmin can reset any password
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
            {
                if (Guid.Parse(userId) != id)
                    return await AuthorizationHelper.ForbiddenResponse(req, "You can only reset your own password");
            }

            var dto = await req.ReadFromJsonAsync<ResetPasswordDto>();

            try
            {
                await _service.ResetPasswordAsync(id, dto.NewPassword);
                return req.CreateResponse(HttpStatusCode.NoContent);
            }
            catch (Exception ex)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteStringAsync(ex.Message);
                return bad;
            }
        }

        // ============================================================
        // GET USER BY EMAIL
        // ============================================================
        [Function("GetUserByEmail")]
        public async Task<HttpResponseData> GetUserByEmail(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "users/by-email")] HttpRequestData req)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // SuperAdmin bypass - full access
            if (role == "SuperAdmin")
            {
                var query = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
                var email = query["email"];

                if (string.IsNullOrWhiteSpace(email))
                    return req.CreateResponse(HttpStatusCode.BadRequest);

                var user = await _service.GetByEmailAsync(email);
                if (user == null)
                    return req.CreateResponse(HttpStatusCode.NotFound);

                var ok = req.CreateResponse(HttpStatusCode.OK);
                await ok.WriteAsJsonAsync(user);
                return ok;
            }

            // OrgAdmin can view users in their org
            if (!_authorizationService.HasAnyRole(role, "OrgAdmin", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view user by email");

            var queryData = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
            var emailData = queryData["email"];

            if (string.IsNullOrWhiteSpace(emailData))
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteStringAsync("Email is required");
                return bad;
            }

            var userData = await _service.GetByEmailAsync(emailData);

            if (userData == null)
            {
                var notFound = req.CreateResponse(HttpStatusCode.NotFound);
                await notFound.WriteStringAsync("User not found");
                return notFound;
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(userData);
            return response;
        }

        // ============================================================
        // DELETE USER
        // ============================================================
        [Function("DeleteUser")]
        public async Task<HttpResponseData> DeleteUser(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "users/{id:guid}")] HttpRequestData req,
            Guid id)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // Only SuperAdmin and OrgAdmin can delete users
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin or OrgAdmin can delete users");

            try
            {
                await _service.DeleteUserAsync(id);
                return req.CreateResponse(HttpStatusCode.NoContent);
            }
            catch (Exception ex)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteStringAsync(ex.Message);
                return bad;
            }
        }
    }
}
