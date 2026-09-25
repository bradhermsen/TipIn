using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using Dapper;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using TipInAPI.DTOs;
using TipInAPI.Infrastructure.Authorization;
using TipInAPI.Infrastructure.Database;
using TipInAPI.Services;

namespace TipInAPI.Functions
{
    public class FacilitiesFunctions
    {
        private readonly ISqlConnectionFactory _connectionFactory;
        private readonly IAuthorizationService _authorizationService;
        private readonly IGatewaySecretProtector _secretProtector;

        public FacilitiesFunctions(
            ISqlConnectionFactory connectionFactory,
            IAuthorizationService authorizationService,
            IGatewaySecretProtector secretProtector)
        {
            _connectionFactory = connectionFactory;
            _authorizationService = authorizationService;
            _secretProtector = secretProtector;
        }

        [Function("GetFacilityContext")]
        public async Task<HttpResponseData> GetFacilityContext(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "facilities/context")] HttpRequestData req)
        {
            var context = await AuthorizeAsync(req, requireAdmin: true);
            if (context.Error != null) return context.Error;

            using var connection = _connectionFactory.CreateConnection();
            var organizations = context.IsSuperAdmin
                ? await connection.QueryAsync(@"
                    SELECT OrganizationId, Name FROM dbo.Organizations
                    WHERE IsActive = 1 ORDER BY Name;")
                : await connection.QueryAsync(@"
                    SELECT OrganizationId, Name FROM dbo.Organizations
                    WHERE OrganizationId = @OrganizationId;", new { context.OrganizationId });
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new { context.IsSuperAdmin, organizations });
            return response;
        }

        [Function("GetOrganizationArenas")]
        public async Task<HttpResponseData> GetOrganizationArenas(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "organizations/{organizationId:guid}/arenas")] HttpRequestData req,
            Guid organizationId)
        {
            var context = await AuthorizeOrganizationAsync(req, organizationId, requireAdmin: false);
            if (context.Error != null) return context.Error;

            using var connection = _connectionFactory.CreateConnection();
            var arenas = (await connection.QueryAsync<ArenaDto>(@"
                SELECT a.ArenaId, a.Name, a.StreetAddress, a.City, a.State, a.PostalCode,
                       a.IsActive, ao.AccessLevel, ao.IsPrimary
                FROM dbo.Arenas a
                INNER JOIN dbo.ArenaOrganizations ao ON ao.ArenaId = a.ArenaId
                WHERE ao.OrganizationId = @OrganizationId
                ORDER BY ao.IsPrimary DESC, a.Name;", new { OrganizationId = organizationId })).ToList();

            var canSeeManagedDetails = context.IsFacilityAdmin && (context.IsSuperAdmin || context.OrganizationId == organizationId);
            await PopulateChildrenAsync(connection, arenas, includeInactive: canSeeManagedDetails, includeGatewayDetails: canSeeManagedDetails);
            foreach (var arena in arenas.Where(arena => !arena.AccessLevel.Equals("Manage", StringComparison.OrdinalIgnoreCase)))
            {
                foreach (var rink in arena.Rinks) rink.Gateways.Clear();
            }
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(arenas);
            return response;
        }

        [Function("GetArenaCatalog")]
        public async Task<HttpResponseData> GetArenaCatalog(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "arenas/catalog")] HttpRequestData req)
        {
            var context = await AuthorizeAsync(req, requireAdmin: false);
            if (context.Error != null) return context.Error;

            using var connection = _connectionFactory.CreateConnection();
            var arenas = (await connection.QueryAsync<ArenaDto>(@"
                SELECT a.ArenaId, a.Name, a.StreetAddress, a.City, a.State, a.PostalCode, a.IsActive
                FROM dbo.Arenas a
                WHERE a.IsActive = 1
                ORDER BY a.Name;")).ToList();
            await PopulateChildrenAsync(connection, arenas, includeInactive: false, includeGatewayDetails: context.IsSuperAdmin);

            var arenaIds = arenas.Select(arena => arena.ArenaId).ToArray();
            var associations = arenaIds.Length == 0
                ? new List<ArenaOrganizationSummaryDto>()
                : (await connection.QueryAsync<ArenaOrganizationSummaryDto>(@"
                    SELECT ao.ArenaId, ao.OrganizationId, o.Name, ao.AccessLevel, ao.IsPrimary
                    FROM dbo.ArenaOrganizations ao
                    INNER JOIN dbo.Organizations o ON o.OrganizationId = ao.OrganizationId
                    WHERE ao.ArenaId IN @ArenaIds
                    ORDER BY o.Name;", new { ArenaIds = arenaIds })).ToList();
            foreach (var arena in arenas)
                arena.Organizations = associations.Where(association => association.ArenaId == arena.ArenaId).ToList();

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(arenas);
            return response;
        }

        [Function("RemoveOrganizationArenaAssociation")]
        public async Task<HttpResponseData> RemoveOrganizationArenaAssociation(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "organizations/{organizationId:guid}/arenas/{arenaId:guid}/associate")] HttpRequestData req,
            Guid organizationId,
            Guid arenaId)
        {
            var context = await AuthorizeOrganizationAsync(req, organizationId, requireAdmin: true);
            if (context.Error != null) return context.Error;

            using var connection = _connectionFactory.CreateConnection();
            await connection.ExecuteAsync(@"
                DELETE FROM dbo.ArenaOrganizations
                WHERE ArenaId = @ArenaId AND OrganizationId = @OrganizationId;",
                new { ArenaId = arenaId, OrganizationId = organizationId });
            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        [Function("CreateOrganizationArena")]
        public async Task<HttpResponseData> CreateOrganizationArena(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "organizations/{organizationId:guid}/arenas")] HttpRequestData req,
            Guid organizationId)
        {
            var context = await AuthorizeOrganizationAsync(req, organizationId, requireAdmin: true);
            if (context.Error != null) return context.Error;
            var dto = await req.ReadFromJsonAsync<ArenaCreateUpdateDto>();
            if (dto == null || string.IsNullOrWhiteSpace(dto.Name)) return await BadRequestAsync(req, "Arena name is required.");

            var arenaId = Guid.NewGuid();
            using var connection = _connectionFactory.CreateConnection();
            await connection.ExecuteAsync(@"
                IF @IsPrimary = 1
                    UPDATE dbo.ArenaOrganizations SET IsPrimary = 0 WHERE OrganizationId = @OrganizationId;
                INSERT INTO dbo.Arenas (ArenaId, Name, StreetAddress, City, State, PostalCode, IsActive, CreatedAt, UpdatedAt)
                VALUES (@ArenaId, @Name, @StreetAddress, @City, @State, @PostalCode, @IsActive, SYSUTCDATETIME(), SYSUTCDATETIME());
                INSERT INTO dbo.ArenaOrganizations (ArenaId, OrganizationId, AccessLevel, IsPrimary, CreatedAt)
                VALUES (@ArenaId, @OrganizationId, 'Manage', @IsPrimary, SYSUTCDATETIME());",
                new { ArenaId = arenaId, OrganizationId = organizationId, Name = dto.Name.Trim(), dto.StreetAddress, dto.City, dto.State, dto.PostalCode, dto.IsActive, dto.IsPrimary });

            var response = req.CreateResponse(HttpStatusCode.Created);
            await response.WriteAsJsonAsync(new { arenaId });
            return response;
        }

        [Function("AssociateOrganizationArena")]
        public async Task<HttpResponseData> AssociateOrganizationArena(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "organizations/{organizationId:guid}/arenas/{arenaId:guid}/associate")] HttpRequestData req,
            Guid organizationId,
            Guid arenaId)
        {
            var context = await AuthorizeOrganizationAsync(req, organizationId, requireAdmin: true);
            if (context.Error != null) return context.Error;
            var dto = await req.ReadFromJsonAsync<ArenaAssociationDto>() ?? new ArenaAssociationDto();
            var accessLevel = dto.AccessLevel.Equals("Manage", StringComparison.OrdinalIgnoreCase) ? "Manage" : "Use";

            using var connection = _connectionFactory.CreateConnection();
            if (accessLevel == "Manage" && !context.IsSuperAdmin)
            {
                var alreadyManages = await connection.ExecuteScalarAsync<bool>(@"
                    SELECT CAST(CASE WHEN EXISTS (
                        SELECT 1 FROM dbo.ArenaOrganizations
                        WHERE ArenaId = @ArenaId AND OrganizationId = @OrganizationId AND AccessLevel = 'Manage'
                    ) THEN 1 ELSE 0 END AS bit);", new { ArenaId = arenaId, OrganizationId = organizationId });
                if (!alreadyManages)
                    return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin can grant Manage access to an existing arena.");
            }

            await connection.ExecuteAsync(@"
                IF @IsPrimary = 1
                    UPDATE dbo.ArenaOrganizations SET IsPrimary = 0 WHERE OrganizationId = @OrganizationId;
                MERGE dbo.ArenaOrganizations AS target
                USING (SELECT @ArenaId AS ArenaId, @OrganizationId AS OrganizationId) AS source
                ON target.ArenaId = source.ArenaId AND target.OrganizationId = source.OrganizationId
                WHEN MATCHED THEN UPDATE SET AccessLevel = @AccessLevel, IsPrimary = @IsPrimary
                WHEN NOT MATCHED THEN INSERT (ArenaId, OrganizationId, AccessLevel, IsPrimary, CreatedAt)
                    VALUES (@ArenaId, @OrganizationId, @AccessLevel, @IsPrimary, SYSUTCDATETIME());",
                new { ArenaId = arenaId, OrganizationId = organizationId, AccessLevel = accessLevel, dto.IsPrimary });
            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        [Function("UpdateArena")]
        public async Task<HttpResponseData> UpdateArena(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "arenas/{arenaId:guid}")] HttpRequestData req,
            Guid arenaId)
        {
            var context = await AuthorizeArenaManagerAsync(req, arenaId);
            if (context.Error != null) return context.Error;
            var dto = await req.ReadFromJsonAsync<ArenaCreateUpdateDto>();
            if (dto == null || string.IsNullOrWhiteSpace(dto.Name)) return await BadRequestAsync(req, "Arena name is required.");

            using var connection = _connectionFactory.CreateConnection();
            await connection.ExecuteAsync(@"
                UPDATE dbo.Arenas SET Name = @Name, StreetAddress = @StreetAddress, City = @City,
                    State = @State, PostalCode = @PostalCode, IsActive = @IsActive, UpdatedAt = SYSUTCDATETIME()
                WHERE ArenaId = @ArenaId;",
                new { ArenaId = arenaId, Name = dto.Name.Trim(), dto.StreetAddress, dto.City, dto.State, dto.PostalCode, dto.IsActive });
            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        [Function("DeactivateArena")]
        public async Task<HttpResponseData> DeactivateArena(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "arenas/{arenaId:guid}")] HttpRequestData req,
            Guid arenaId)
        {
            var context = await AuthorizeArenaManagerAsync(req, arenaId);
            if (context.Error != null) return context.Error;
            using var connection = _connectionFactory.CreateConnection();
            var associationCount = await connection.ExecuteScalarAsync<int>(@"
                SELECT COUNT(1) FROM dbo.ArenaOrganizations WHERE ArenaId = @ArenaId;",
                new { ArenaId = arenaId });
            if (!context.IsSuperAdmin && associationCount > 1)
                return await AuthorizationHelper.ForbiddenResponse(req, "Only SuperAdmin can delete an Arena shared by multiple organizations.");
            await connection.ExecuteAsync("UPDATE dbo.Arenas SET IsActive = 0, UpdatedAt = SYSUTCDATETIME() WHERE ArenaId = @ArenaId;", new { ArenaId = arenaId });
            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        [Function("CreateRink")]
        public async Task<HttpResponseData> CreateRink(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "arenas/{arenaId:guid}/rinks")] HttpRequestData req,
            Guid arenaId)
        {
            var context = await AuthorizeArenaManagerAsync(req, arenaId);
            if (context.Error != null) return context.Error;
            var dto = await req.ReadFromJsonAsync<RinkCreateUpdateDto>();
            if (dto == null || string.IsNullOrWhiteSpace(dto.Name)) return await BadRequestAsync(req, "Rink name is required.");

            var rinkId = Guid.NewGuid();
            using var connection = _connectionFactory.CreateConnection();
            await connection.ExecuteAsync(@"
                INSERT INTO dbo.Rinks (RinkId, ArenaId, Name, DisplayOrder, IsActive, CreatedAt, UpdatedAt)
                VALUES (@RinkId, @ArenaId, @Name, @DisplayOrder, @IsActive, SYSUTCDATETIME(), SYSUTCDATETIME());",
                new { RinkId = rinkId, ArenaId = arenaId, Name = dto.Name.Trim(), dto.DisplayOrder, dto.IsActive });
            var response = req.CreateResponse(HttpStatusCode.Created);
            await response.WriteAsJsonAsync(new { rinkId });
            return response;
        }

        [Function("UpdateRink")]
        public async Task<HttpResponseData> UpdateRink(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "rinks/{rinkId:guid}")] HttpRequestData req,
            Guid rinkId)
        {
            var arenaId = await GetArenaIdForRinkAsync(rinkId);
            if (!arenaId.HasValue) return req.CreateResponse(HttpStatusCode.NotFound);
            var context = await AuthorizeArenaManagerAsync(req, arenaId.Value);
            if (context.Error != null) return context.Error;
            var dto = await req.ReadFromJsonAsync<RinkCreateUpdateDto>();
            if (dto == null || string.IsNullOrWhiteSpace(dto.Name)) return await BadRequestAsync(req, "Rink name is required.");

            using var connection = _connectionFactory.CreateConnection();
            await connection.ExecuteAsync(@"
                UPDATE dbo.Rinks SET Name = @Name, DisplayOrder = @DisplayOrder, IsActive = @IsActive,
                    UpdatedAt = SYSUTCDATETIME() WHERE RinkId = @RinkId;",
                new { RinkId = rinkId, Name = dto.Name.Trim(), dto.DisplayOrder, dto.IsActive });
            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        [Function("CreateGateway")]
        public async Task<HttpResponseData> CreateGateway(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "rinks/{rinkId:guid}/gateways")] HttpRequestData req,
            Guid rinkId)
        {
            var arenaId = await GetArenaIdForRinkAsync(rinkId);
            if (!arenaId.HasValue) return req.CreateResponse(HttpStatusCode.NotFound);
            var context = await AuthorizeArenaManagerAsync(req, arenaId.Value);
            if (context.Error != null) return context.Error;
            var dto = await req.ReadFromJsonAsync<ScoreboardGatewayCreateUpdateDto>();
            var validation = ValidateGateway(dto, requireSecret: true);
            if (validation != null) return await BadRequestAsync(req, validation);

            var gatewayId = Guid.NewGuid();
            using var connection = _connectionFactory.CreateConnection();
            using var transaction = connection.BeginTransaction();
            if (dto!.IsPrimary)
                await connection.ExecuteAsync("UPDATE dbo.ScoreboardGateways SET IsPrimary = 0, UpdatedAt = SYSUTCDATETIME() WHERE RinkId = @RinkId;", new { RinkId = rinkId }, transaction);
            await connection.ExecuteAsync(@"
                INSERT INTO dbo.ScoreboardGateways
                    (GatewayId, RinkId, Name, DeviceMacAddress, Host, Port, WebSocketSecretEncrypted, IsPrimary, IsActive, CreatedAt, UpdatedAt)
                VALUES (@GatewayId, @RinkId, @Name, @DeviceMacAddress, @Host, @Port, @Secret, @IsPrimary, @IsActive, SYSUTCDATETIME(), SYSUTCDATETIME());",
                new { GatewayId = gatewayId, RinkId = rinkId, Name = dto.Name.Trim(), DeviceMacAddress = dto.DeviceMacAddress.Trim(), Host = dto.Host.Trim(), dto.Port, Secret = _secretProtector.Protect(dto.WebSocketSecret!), dto.IsPrimary, dto.IsActive }, transaction);
            transaction.Commit();
            var response = req.CreateResponse(HttpStatusCode.Created);
            await response.WriteAsJsonAsync(new { gatewayId });
            return response;
        }

        [Function("UpdateGateway")]
        public async Task<HttpResponseData> UpdateGateway(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "gateways/{gatewayId:guid}")] HttpRequestData req,
            Guid gatewayId)
        {
            using var lookupConnection = _connectionFactory.CreateConnection();
            var link = await lookupConnection.QueryFirstOrDefaultAsync<GatewayLinkRow>(@"
                SELECT g.RinkId, r.ArenaId FROM dbo.ScoreboardGateways g
                INNER JOIN dbo.Rinks r ON r.RinkId = g.RinkId WHERE g.GatewayId = @GatewayId;", new { GatewayId = gatewayId });
            if (link == null) return req.CreateResponse(HttpStatusCode.NotFound);
            var context = await AuthorizeArenaManagerAsync(req, link.ArenaId);
            if (context.Error != null) return context.Error;
            var dto = await req.ReadFromJsonAsync<ScoreboardGatewayCreateUpdateDto>();
            var validation = ValidateGateway(dto, requireSecret: false);
            if (validation != null) return await BadRequestAsync(req, validation);

            using var connection = _connectionFactory.CreateConnection();
            using var transaction = connection.BeginTransaction();
            if (dto!.IsPrimary)
                await connection.ExecuteAsync("UPDATE dbo.ScoreboardGateways SET IsPrimary = 0, UpdatedAt = SYSUTCDATETIME() WHERE RinkId = @RinkId AND GatewayId <> @GatewayId;", new { link.RinkId, GatewayId = gatewayId }, transaction);
            await connection.ExecuteAsync(@"
                UPDATE dbo.ScoreboardGateways SET Name = @Name, DeviceMacAddress = @DeviceMacAddress,
                    Host = @Host, Port = @Port,
                    WebSocketSecretEncrypted = COALESCE(@Secret, WebSocketSecretEncrypted),
                    IsPrimary = @IsPrimary, IsActive = @IsActive, UpdatedAt = SYSUTCDATETIME()
                WHERE GatewayId = @GatewayId;",
                new { GatewayId = gatewayId, Name = dto.Name.Trim(), DeviceMacAddress = dto.DeviceMacAddress.Trim(), Host = dto.Host.Trim(), dto.Port, Secret = string.IsNullOrWhiteSpace(dto.WebSocketSecret) ? null : _secretProtector.Protect(dto.WebSocketSecret), dto.IsPrimary, dto.IsActive }, transaction);
            transaction.Commit();
            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        private async Task PopulateChildrenAsync(System.Data.IDbConnection connection, List<ArenaDto> arenas, bool includeInactive, bool includeGatewayDetails)
        {
            if (arenas.Count == 0) return;
            var arenaIds = arenas.Select(a => a.ArenaId).ToArray();
            var rinks = (await connection.QueryAsync<RinkDto>(@"
                SELECT r.RinkId, r.ArenaId, r.Name, r.DisplayOrder, r.IsActive,
                       CAST(CASE WHEN EXISTS (
                           SELECT 1 FROM dbo.ScoreboardGateways sg
                           WHERE sg.RinkId = r.RinkId AND sg.IsPrimary = 1 AND sg.IsActive = 1
                       ) THEN 1 ELSE 0 END AS bit) AS GatewayAvailable
                FROM dbo.Rinks r
                WHERE r.ArenaId IN @ArenaIds AND (@IncludeInactive = 1 OR r.IsActive = 1)
                ORDER BY r.DisplayOrder, r.Name;", new { ArenaIds = arenaIds, IncludeInactive = includeInactive })).ToList();
            var rinkIds = rinks.Select(r => r.RinkId).ToArray();
            var gateways = !includeGatewayDetails || rinkIds.Length == 0 ? new List<ScoreboardGatewayDto>() : (await connection.QueryAsync<ScoreboardGatewayDto>(@"
                SELECT GatewayId, RinkId, Name, DeviceMacAddress, Host, Port,
                       CAST(CASE WHEN WebSocketSecretEncrypted <> '' THEN 1 ELSE 0 END AS bit) AS HasSecret,
                       IsPrimary, IsActive, LastSeenAt
                FROM dbo.ScoreboardGateways
                WHERE RinkId IN @RinkIds AND (@IncludeInactive = 1 OR IsActive = 1)
                ORDER BY IsPrimary DESC, Name;", new { RinkIds = rinkIds, IncludeInactive = includeInactive })).ToList();
            foreach (var rink in rinks) rink.Gateways = gateways.Where(g => g.RinkId == rink.RinkId).ToList();
            foreach (var arena in arenas) arena.Rinks = rinks.Where(r => r.ArenaId == arena.ArenaId).ToList();
        }

        private async Task<Guid?> GetArenaIdForRinkAsync(Guid rinkId)
        {
            using var connection = _connectionFactory.CreateConnection();
            return await connection.QueryFirstOrDefaultAsync<Guid?>("SELECT ArenaId FROM dbo.Rinks WHERE RinkId = @RinkId;", new { RinkId = rinkId });
        }

        private async Task<AuthContext> AuthorizeArenaManagerAsync(HttpRequestData req, Guid arenaId)
        {
            var context = await AuthorizeAsync(req, requireAdmin: true);
            if (context.Error != null || context.IsSuperAdmin) return context;
            using var connection = _connectionFactory.CreateConnection();
            var canManage = await connection.ExecuteScalarAsync<bool>(@"
                SELECT CAST(CASE WHEN EXISTS (
                    SELECT 1 FROM dbo.ArenaOrganizations
                    WHERE ArenaId = @ArenaId AND OrganizationId = @OrganizationId AND AccessLevel = 'Manage'
                ) THEN 1 ELSE 0 END AS bit);", new { ArenaId = arenaId, context.OrganizationId });
            return canManage ? context : context with { Error = await AuthorizationHelper.ForbiddenResponse(req, "Manage access to this arena is required.") };
        }

        private async Task<AuthContext> AuthorizeOrganizationAsync(HttpRequestData req, Guid organizationId, bool requireAdmin)
        {
            var context = await AuthorizeAsync(req, requireAdmin);
            if (context.Error != null || context.IsSuperAdmin || !requireAdmin || context.OrganizationId == organizationId) return context;
            return context with { Error = await AuthorizationHelper.ForbiddenResponse(req, "This organization is outside your access scope.") };
        }

        private async Task<AuthContext> AuthorizeAsync(HttpRequestData req, bool requireAdmin)
        {
            var token = AuthorizationHelper.ExtractBearerToken(req);
            if (string.IsNullOrWhiteSpace(token))
                return new AuthContext(false, false, Guid.Empty, null, await AuthorizationHelper.UnauthorizedResponse(req, "No authorization token provided."));
            var (isValid, userId, role) = _authorizationService.ValidateToken(token);
            if (!isValid || !Guid.TryParse(userId, out var parsedUserId))
                return new AuthContext(false, false, Guid.Empty, null, await AuthorizationHelper.UnauthorizedResponse(req, "Invalid or expired token."));
            var isSuperAdmin = role.Equals("SuperAdmin", StringComparison.OrdinalIgnoreCase);
            var isFacilityAdmin = isSuperAdmin || role.Equals("OrgAdmin", StringComparison.OrdinalIgnoreCase) || role.Equals("OrgOwner", StringComparison.OrdinalIgnoreCase);
            var allowed = requireAdmin
                ? isSuperAdmin || role.Equals("OrgAdmin", StringComparison.OrdinalIgnoreCase) || role.Equals("OrgOwner", StringComparison.OrdinalIgnoreCase)
                : isSuperAdmin || _authorizationService.HasAnyRole(role, "OrgAdmin", "OrgOwner", "TeamManager", "Coach", "Viewer");
            if (!allowed)
                return new AuthContext(isSuperAdmin, isFacilityAdmin, Guid.Empty, null, await AuthorizationHelper.ForbiddenResponse(req, "Insufficient facility permissions."));

            using var connection = _connectionFactory.CreateConnection();
            var organizationId = await connection.QueryFirstOrDefaultAsync<Guid?>("SELECT OrganizationId FROM dbo.Users WHERE Id = @UserId;", new { UserId = parsedUserId });
            return new AuthContext(isSuperAdmin, isFacilityAdmin, parsedUserId, organizationId, null);
        }

        private static string? ValidateGateway(ScoreboardGatewayCreateUpdateDto? dto, bool requireSecret)
        {
            if (dto == null) return "Gateway details are required.";
            if (string.IsNullOrWhiteSpace(dto.Name)) return "Gateway name is required.";
            if (string.IsNullOrWhiteSpace(dto.DeviceMacAddress)) return "Device MAC address is required.";
            if (string.IsNullOrWhiteSpace(dto.Host)) return "Gateway host or IP address is required.";
            if (dto.Port is < 1 or > 65535) return "Gateway port must be between 1 and 65535.";
            if (requireSecret && string.IsNullOrWhiteSpace(dto.WebSocketSecret)) return "Gateway authentication secret is required.";
            return null;
        }

        private static async Task<HttpResponseData> BadRequestAsync(HttpRequestData req, string message)
        {
            var response = req.CreateResponse(HttpStatusCode.BadRequest);
            await response.WriteAsJsonAsync(new { error = message });
            return response;
        }

        private sealed record AuthContext(bool IsSuperAdmin, bool IsFacilityAdmin, Guid UserId, Guid? OrganizationId, HttpResponseData? Error);

        private sealed class GatewayLinkRow
        {
            public Guid RinkId { get; set; }
            public Guid ArenaId { get; set; }
        }
    }
}