using System;
using System.Net;
using System.Threading.Tasks;
using System.Collections.Generic;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using TipInAPI.DTOs;
using TipInAPI.Services;
using TipInAPI.Infrastructure.Authorization;

namespace TipInAPI.Functions
{
    public class OrganizationFunctions
    {
        private readonly IOrganizationService _service;
        private readonly IAuthorizationService _authorizationService;

        public OrganizationFunctions(IOrganizationService service, IAuthorizationService authorizationService)
        {
            _service = service;
            _authorizationService = authorizationService;
        }

        [Function("GetOrganizations")]
        public async Task<HttpResponseData> GetOrganizations(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "organizations")] HttpRequestData req)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // SuperAdmin bypass - full access to all organizations
            if (role == "SuperAdmin")
            {
                var items = await _service.GetAllAsync();
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(items);
                return response;
            }

            // Other roles can view organizations
            if (!_authorizationService.HasAnyRole(role, "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view organizations");

            var allItems = await _service.GetAllAsync();
            var result = req.CreateResponse(HttpStatusCode.OK);
            await result.WriteAsJsonAsync(allItems);
            return result;
        }

        [Function("GetOrganizationById")]
        public async Task<HttpResponseData> GetOrganizationById(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "organizations/{id:guid}")] HttpRequestData req,
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
                var org = await _service.GetByIdAsync(id);
                if (org == null)
                    return req.CreateResponse(HttpStatusCode.NotFound);
                var response = req.CreateResponse(HttpStatusCode.OK);
                await response.WriteAsJsonAsync(org);
                return response;
            }

            // Other roles can view organizations
            if (!_authorizationService.HasAnyRole(role, "OrgAdmin", "TeamManager", "Coach", "Viewer"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Insufficient permissions to view organization details");

            var orgData = await _service.GetByIdAsync(id);
            if (orgData == null)
                return req.CreateResponse(HttpStatusCode.NotFound);
            var result = req.CreateResponse(HttpStatusCode.OK);
            await result.WriteAsJsonAsync(orgData);
            return result;
        }

        [Function("CreateOrganization")]
        public async Task<HttpResponseData> CreateOrganization(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "organizations")] HttpRequestData req)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // Only SuperAdmin can create organizations
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin can create organizations");

            var dto = await req.ReadFromJsonAsync<CreateOrganizationDto>();
            if (dto == null)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                return bad;
            }

            // Create the organization
            var org = await _service.CreateAsync(dto);

            // ⭐ AUTO‑CREATE ORG OWNER (this is the only new line)
            await _service.CreateOrgOwnerForOrganizationAsync(org);

            var response = req.CreateResponse(HttpStatusCode.Created);
            await response.WriteAsJsonAsync(new { OrganizationId = org.Id });
            return response;
        }

        [Function("UpdateOrganization")]
        public async Task<HttpResponseData> UpdateOrganization(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", "patch", Route = "organizations/{id:guid}")] HttpRequestData req,
            Guid id)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // Only SuperAdmin and OrgAdmin can update organizations
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin", "OrgAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin or OrgAdmin can update organizations");

            var dto = await req.ReadFromJsonAsync<UpdateOrganizationDto>();
            if (dto == null)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                return bad;
            }

            await _service.UpdateAsync(id, dto);
            var response = req.CreateResponse(HttpStatusCode.NoContent);
            return response;
        }

        [Function("DeleteOrganization")]
        public async Task<HttpResponseData> DeleteOrganization(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "organizations/{id:guid}")] HttpRequestData req,
            Guid id)
        {
            // Validate authorization
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");

            // Only SuperAdmin can delete organizations
            if (!_authorizationService.HasAnyRole(role, "SuperAdmin"))
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin can delete organizations");

            await _service.DeleteAsync(id);
            var response = req.CreateResponse(HttpStatusCode.NoContent);
            return response;
        }
    }
}
