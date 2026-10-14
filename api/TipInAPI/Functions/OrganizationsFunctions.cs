using System;
using System.Net;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Data.SqlClient;
using TipInAPI.DTOs;
using TipInAPI.Models;
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

        [Function("FindSimilarOrganizations")]
        public async Task<HttpResponseData> FindSimilarOrganizations(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "organizations/similar")] HttpRequestData req)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrEmpty(token))
                return await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided");

            var (isValid, _, role) = _authorizationService.ValidateToken(token);
            if (!isValid)
                return await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token");
            if (role != "SuperAdmin")
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin can check Organization duplicates");

            var query = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
            var name = query["name"]?.Trim() ?? string.Empty;
            if (!Guid.TryParse(query["leagueId"], out var leagueId) || name.Length < 3)
            {
                var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                await badRequest.WriteStringAsync("A League and at least three name characters are required.");
                return badRequest;
            }

            var normalizedName = NormalizeOrganizationName(name);
            var organizations = await _service.GetAllAsync();
            var matches = organizations
                .Where(org => org.LeagueId == leagueId && !string.IsNullOrWhiteSpace(org.Name))
                .Select(org => new
                {
                    organization = org,
                    normalized = NormalizeOrganizationName(org.Name!)
                })
                .Select(candidate => new
                {
                    candidate.organization,
                    score = SimilarityScore(normalizedName, candidate.normalized)
                })
                .Where(candidate => candidate.score >= 0.72)
                .OrderByDescending(candidate => candidate.score)
                .ThenBy(candidate => candidate.organization.Name)
                .Take(5)
                .Select(candidate => new
                {
                    organizationId = candidate.organization.OrganizationId,
                    name = candidate.organization.Name,
                    city = candidate.organization.City,
                    state = candidate.organization.State,
                    leagueName = candidate.organization.LeagueName,
                    similarityScore = Math.Round(candidate.score * 100, 0)
                });

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(matches);
            return response;
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

            var organizationName = dto.Name?.Trim();
            if (dto.LeagueId == Guid.Empty || string.IsNullOrWhiteSpace(organizationName))
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteStringAsync("Organization name and league are required.");
                return bad;
            }

            var existingOrganizationId = await _service.FindDuplicateIdAsync(organizationName, dto.LeagueId);
            if (existingOrganizationId.HasValue)
            {
                var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                await conflict.WriteAsJsonAsync(new
                {
                    message = "An organization with this name already exists in this league. Reuse it and manage its season participation instead of creating a duplicate.",
                    existingOrganizationId = existingOrganizationId.Value
                });
                return conflict;
            }

            dto.Name = organizationName;

            // Create the organization
            Organization org;
            try
            {
                org = await _service.CreateAsync(dto);
            }
            catch (SqlException ex) when (ex.Number == 51001)
            {
                var duplicateId = await _service.FindDuplicateIdAsync(organizationName, dto.LeagueId);
                var conflict = req.CreateResponse(HttpStatusCode.Conflict);
                await conflict.WriteAsJsonAsync(new
                {
                    message = "An organization with this name already exists in this league. Reuse it and manage its season participation instead of creating a duplicate.",
                    existingOrganizationId = duplicateId
                });
                return conflict;
            }

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

        private static string NormalizeOrganizationName(string name)
        {
            var normalized = name.Trim().ToLowerInvariant();
            normalized = Regex.Replace(normalized, @"\b(?:sr|senior)\b", "senior");
            normalized = Regex.Replace(normalized, @"\b(?:jr|junior)\b", "junior");
            normalized = Regex.Replace(normalized, @"\b(?:hs|high\s+school)\b", "highschool");
            return Regex.Replace(normalized, @"[^a-z0-9]", string.Empty);
        }

        private static double SimilarityScore(string left, string right)
        {
            if (left.Length == 0 || right.Length == 0) return 0;
            if (left == right) return 1;

            var previous = Enumerable.Range(0, right.Length + 1).ToArray();
            var current = new int[right.Length + 1];
            for (var leftIndex = 1; leftIndex <= left.Length; leftIndex++)
            {
                current[0] = leftIndex;
                for (var rightIndex = 1; rightIndex <= right.Length; rightIndex++)
                {
                    var substitutionCost = left[leftIndex - 1] == right[rightIndex - 1] ? 0 : 1;
                    current[rightIndex] = Math.Min(
                        Math.Min(current[rightIndex - 1] + 1, previous[rightIndex] + 1),
                        previous[rightIndex - 1] + substitutionCost);
                }
                (previous, current) = (current, previous);
            }

            return 1d - (double)previous[right.Length] / Math.Max(left.Length, right.Length);
        }
    }
}
