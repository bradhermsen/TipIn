using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using Dapper;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using TipInAPI.DTOs;
using TipInAPI.Infrastructure.Database;

namespace TipInAPI.Functions
{
    public class GameOfficialsVerificationFunctions
    {
        private readonly ISqlConnectionFactory _connectionFactory;

        public GameOfficialsVerificationFunctions(ISqlConnectionFactory connectionFactory)
        {
            _connectionFactory = connectionFactory;
        }

        private static Task EnsureOfficialsEmailColumnAsync(System.Data.IDbConnection conn)
        {
            const string sql = @"
                IF COL_LENGTH('dbo.Officials', 'Email') IS NULL
                BEGIN
                    ALTER TABLE dbo.Officials
                    ADD Email NVARCHAR(255) NULL;
                END;";

            return conn.ExecuteAsync(sql);
        }

        [Function("GetGameOfficialsVerification")]
        public async Task<HttpResponseData> GetGameOfficialsVerification(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "games/{gameId:guid}/officials/verification")] HttpRequestData req,
            Guid gameId)
        {
            using var conn = _connectionFactory.CreateConnection();
            await EnsureOfficialsEmailColumnAsync(conn);

            const string gameExistsSql = @"
                SELECT COUNT(1)
                FROM Games
                WHERE GameId = @GameId;
            ";

            var gameExists = await conn.ExecuteScalarAsync<int>(gameExistsSql, new { GameId = gameId }) > 0;
            if (!gameExists)
            {
                return req.CreateResponse(HttpStatusCode.NotFound);
            }

            const string sql = @"
                SELECT
                    go.OfficialId,
                    REPLACE(go.Role, ' ', '') AS Role,
                    LTRIM(RTRIM(
                        COALESCE(
                            NULLIF(CONCAT(o.FirstName, ' ', o.LastName), ' '),
                            NULLIF(CONCAT(go.FirstName, ' ', go.LastName), ' '),
                            ''
                        )
                    )) AS OfficialName,
                    o.Email AS OfficialEmail,
                    gov.SignatureImageBase64,
                    gov.SignedAtUtc
                FROM GameOfficials go
                LEFT JOIN Officials o ON o.OfficialId = go.OfficialId
                LEFT JOIN GameOfficialVerifications gov
                    ON gov.GameId = go.GameId
                   AND REPLACE(gov.Role, ' ', '') = REPLACE(go.Role, ' ', '')
                WHERE go.GameId = @GameId
                ORDER BY
                    CASE REPLACE(go.Role, ' ', '')
                        WHEN 'Referee1' THEN 1
                        WHEN 'Referee2' THEN 2
                        WHEN 'Linesman1' THEN 3
                        WHEN 'Linesman2' THEN 4
                        ELSE 99
                    END,
                    REPLACE(go.Role, ' ', '');
            ";

            var officials = (await conn.QueryAsync<GameOfficialVerificationDto>(sql, new { GameId = gameId })).ToList();

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new GameOfficialsVerificationResponseDto
            {
                GameId = gameId,
                Officials = officials
            });
            return response;
        }

        [Function("SaveGameOfficialsVerification")]
        public async Task<HttpResponseData> SaveGameOfficialsVerification(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "games/{gameId:guid}/officials/verification")] HttpRequestData req,
            Guid gameId)
        {
            var body = await req.ReadFromJsonAsync<SaveGameOfficialsVerificationRequestDto>();
            if (body?.Officials == null || body.Officials.Count == 0)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { message = "At least one official signature payload is required." });
                return bad;
            }

            var submittedRoles = body.Officials
                .Where(x => !string.IsNullOrWhiteSpace(x.Role))
                .Select(x => x.Role.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();

            if (submittedRoles.Length == 0)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { message = "Each official entry must include a role." });
                return bad;
            }

            using var conn = _connectionFactory.CreateConnection();

            const string assignedSql = @"
                SELECT
                    go.OfficialId,
                    REPLACE(go.Role, ' ', '') AS Role,
                    LTRIM(RTRIM(
                        COALESCE(
                            NULLIF(CONCAT(o.FirstName, ' ', o.LastName), ' '),
                            NULLIF(CONCAT(go.FirstName, ' ', go.LastName), ' '),
                            ''
                        )
                    )) AS OfficialName
                FROM GameOfficials go
                LEFT JOIN Officials o ON o.OfficialId = go.OfficialId
                WHERE go.GameId = @GameId;
            ";

            var assigned = (await conn.QueryAsync<GameOfficialVerificationDto>(assignedSql, new { GameId = gameId })).ToList();
            if (assigned.Count == 0)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteAsJsonAsync(new { message = "No officials are assigned to this game." });
                return bad;
            }

            var assignedByRole = assigned
                .GroupBy(x => x.Role, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

            foreach (var role in submittedRoles)
            {
                if (!assignedByRole.ContainsKey(role))
                {
                    var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                    await bad.WriteAsJsonAsync(new { message = $"Role '{role}' is not assigned to this game." });
                    return bad;
                }
            }

            using var tx = conn.BeginTransaction();

            const string upsertSql = @"
                MERGE GameOfficialVerifications AS target
                USING (SELECT @GameId AS GameId, @Role AS Role) AS source
                   ON target.GameId = source.GameId
                                    AND REPLACE(target.Role, ' ', '') = source.Role
                WHEN MATCHED THEN
                    UPDATE SET
                        OfficialId = @OfficialId,
                        OfficialName = @OfficialName,
                        SignatureImageBase64 = @SignatureImageBase64,
                        SignedAtUtc = @SignedAtUtc,
                        UpdatedAtUtc = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN
                    INSERT
                    (
                        GameOfficialVerificationId,
                        GameId,
                        OfficialId,
                        Role,
                        OfficialName,
                        SignatureImageBase64,
                        SignedAtUtc,
                        CreatedAtUtc,
                        UpdatedAtUtc
                    )
                    VALUES
                    (
                        NEWID(),
                        @GameId,
                        @OfficialId,
                        @Role,
                        @OfficialName,
                        @SignatureImageBase64,
                        @SignedAtUtc,
                        SYSUTCDATETIME(),
                        SYSUTCDATETIME()
                    );
            ";

            foreach (var item in body.Officials)
            {
                if (string.IsNullOrWhiteSpace(item.Role))
                {
                    continue;
                }

                var role = item.Role.Trim();
                if (!assignedByRole.TryGetValue(role, out var assignedOfficial))
                {
                    continue;
                }

                var signature = string.IsNullOrWhiteSpace(item.SignatureImageBase64)
                    ? null
                    : item.SignatureImageBase64.Trim();

                await conn.ExecuteAsync(
                    upsertSql,
                    new
                    {
                        GameId = gameId,
                        Role = assignedOfficial.Role,
                        assignedOfficial.OfficialId,
                        OfficialName = string.IsNullOrWhiteSpace(assignedOfficial.OfficialName) ? assignedOfficial.Role : assignedOfficial.OfficialName,
                        SignatureImageBase64 = signature,
                        SignedAtUtc = signature == null ? (DateTime?)null : DateTime.UtcNow
                    },
                    tx);
            }

            tx.Commit();
            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        [Function("GetMobileOfficialOptions")]
        public async Task<HttpResponseData> GetMobileOfficialOptions(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "games/{gameId:guid}/officials/options-mobile")] HttpRequestData req,
            Guid gameId)
        {
            using var conn = _connectionFactory.CreateConnection();
            var authorizationError = await AuthorizeGameManagerAsync(req, conn, gameId);
            if (authorizationError != null) return authorizationError;
            await EnsureOfficialsEmailColumnAsync(conn);

            var officials = await conn.QueryAsync(@"
                SELECT OfficialId, FirstName, LastName, Email, Role,
                       LTRIM(RTRIM(CONCAT(FirstName, ' ', LastName))) AS DisplayName
                FROM dbo.Officials
                WHERE IsActive = 1
                ORDER BY LastName, FirstName;");
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(officials);
            return response;
        }

        [Function("AssignMobileGameOfficial")]
        public async Task<HttpResponseData> AssignMobileGameOfficial(
            [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "games/{gameId:guid}/officials/assignment-mobile")] HttpRequestData req,
            Guid gameId)
        {
            using var conn = _connectionFactory.CreateConnection();
            var authorizationError = await AuthorizeGameManagerAsync(req, conn, gameId);
            if (authorizationError != null) return authorizationError;
            var dto = await req.ReadFromJsonAsync<MobileOfficialAssignmentDto>();
            if (dto == null || !IsValidAssignmentRole(dto.Role)) return await BadRequestAsync(req, "A valid official and assignment role are required.");

            var official = await conn.QuerySingleOrDefaultAsync<MobileOfficialRow>(@"
                SELECT OfficialId, FirstName, LastName, Role FROM dbo.Officials
                WHERE OfficialId = @OfficialId AND IsActive = 1;", new { dto.OfficialId });
            if (official == null) return req.CreateResponse(HttpStatusCode.NotFound);
            if (!OfficialSupportsRole(official.Role, dto.Role)) return await BadRequestAsync(req, "The selected official is not available for this role.");

            using var transaction = conn.BeginTransaction();
            if (!string.IsNullOrWhiteSpace(dto.PreviousRole)
                && IsValidAssignmentRole(dto.PreviousRole)
                && !dto.PreviousRole.Equals(dto.Role, StringComparison.OrdinalIgnoreCase))
            {
                await MoveOfficialAssignmentAsync(conn, transaction, gameId, dto.PreviousRole, dto.Role, official);
            }
            else
            {
                await AssignOfficialAsync(conn, gameId, dto.Role, official, transaction);
            }
            transaction.Commit();
            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        [Function("RemoveMobileGameOfficial")]
        public async Task<HttpResponseData> RemoveMobileGameOfficial(
            [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "games/{gameId:guid}/officials/{role}/assignment-mobile")] HttpRequestData req,
            Guid gameId,
            string role)
        {
            using var conn = _connectionFactory.CreateConnection();
            var authorizationError = await AuthorizeGameManagerAsync(req, conn, gameId);
            if (authorizationError != null) return authorizationError;
            if (!IsValidAssignmentRole(role)) return await BadRequestAsync(req, "A valid official assignment role is required.");

            using var transaction = conn.BeginTransaction();
            await conn.ExecuteAsync(@"
                DELETE FROM dbo.GameOfficialVerifications
                WHERE GameId = @GameId AND REPLACE(Role, ' ', '') = @Role;
                DELETE FROM dbo.GameOfficials
                WHERE GameId = @GameId AND REPLACE(Role, ' ', '') = @Role;",
                new { GameId = gameId, Role = role }, transaction);
            transaction.Commit();
            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        [Function("CreateMobileGameOfficial")]
        public async Task<HttpResponseData> CreateMobileGameOfficial(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "games/{gameId:guid}/officials/mobile")] HttpRequestData req,
            Guid gameId)
        {
            using var conn = _connectionFactory.CreateConnection();
            var authorizationError = await AuthorizeGameManagerAsync(req, conn, gameId);
            if (authorizationError != null) return authorizationError;
            var dto = await req.ReadFromJsonAsync<MobileCreateOfficialDto>();
            if (dto == null || string.IsNullOrWhiteSpace(dto.FirstName) || string.IsNullOrWhiteSpace(dto.LastName))
                return await BadRequestAsync(req, "First name and last name are required.");
            if (!dto.IsReferee && !dto.IsLinesman) return await BadRequestAsync(req, "Select at least one official role.");
            if (!string.IsNullOrWhiteSpace(dto.AssignmentRole) && (!IsValidAssignmentRole(dto.AssignmentRole) || !SupportsSelectedRole(dto, dto.AssignmentRole)))
                return await BadRequestAsync(req, "The assignment slot must match a selected official role.");
            await EnsureOfficialsEmailColumnAsync(conn);

            var official = new MobileOfficialRow
            {
                OfficialId = Guid.NewGuid(),
                FirstName = dto.FirstName.Trim(),
                LastName = dto.LastName.Trim(),
                Role = dto.IsReferee && dto.IsLinesman ? "Referee, Linesman" : dto.IsReferee ? "Referee" : "Linesman"
            };
            using var transaction = conn.BeginTransaction();
            await conn.ExecuteAsync(@"
                INSERT INTO dbo.Officials (OfficialId, FirstName, LastName, Email, Role, IsActive, CreatedAt, UpdatedAt)
                VALUES (@OfficialId, @FirstName, @LastName, @Email, @Role, @IsActive, SYSUTCDATETIME(), SYSUTCDATETIME());",
                new { official.OfficialId, official.FirstName, official.LastName, Email = string.IsNullOrWhiteSpace(dto.Email) ? null : dto.Email.Trim(), official.Role, dto.IsActive }, transaction);
            if (!string.IsNullOrWhiteSpace(dto.AssignmentRole)) await AssignOfficialAsync(conn, gameId, dto.AssignmentRole, official, transaction);
            transaction.Commit();

            var response = req.CreateResponse(HttpStatusCode.Created);
            await response.WriteAsJsonAsync(new { official.OfficialId, official.FirstName, official.LastName, Email = dto.Email, official.Role });
            return response;
        }

        private async Task<HttpResponseData?> AuthorizeGameManagerAsync(HttpRequestData req, System.Data.IDbConnection conn, Guid gameId)
        {
            var accessCode = req.Headers.TryGetValues("x-TipIn-access-code", out var values) ? values.FirstOrDefault()?.Trim().ToUpperInvariant() : null;
            if (string.IsNullOrWhiteSpace(accessCode) || !accessCode.StartsWith("GM-", StringComparison.OrdinalIgnoreCase))
                return await UnauthorizedAsync(req, "A valid Game Manager access code is required.");
            var codeWithoutPrefix = accessCode[3..];
            var isAuthorized = await conn.ExecuteScalarAsync<bool>(@"
                SELECT CAST(CASE WHEN EXISTS (
                SELECT 1 FROM dbo.Games g
                INNER JOIN dbo.Teams t ON t.Id IN (g.HomeTeamId, g.AwayTeamId)
                WHERE g.GameId = @GameId AND (UPPER(ISNULL(t.ScorekeeperCode, '')) IN (@AccessCode, @CodeWithoutPrefix)
                    OR 'GM-' + UPPER(ISNULL(t.ScorekeeperCode, '')) = @AccessCode)
                ) THEN 1 ELSE 0 END AS bit);",
                new { GameId = gameId, AccessCode = accessCode, CodeWithoutPrefix = codeWithoutPrefix });
            return isAuthorized
                ? null
                : await UnauthorizedAsync(req, "The access code is not valid for this game.");
        }

        private static async Task AssignOfficialAsync(System.Data.IDbConnection conn, Guid gameId, string role, MobileOfficialRow official, System.Data.IDbTransaction? transaction = null)
        {
            await conn.ExecuteAsync(@"
                MERGE dbo.GameOfficials AS target
                USING (SELECT @GameId AS GameId, @Role AS Role) AS source
                ON target.GameId = source.GameId AND REPLACE(target.Role, ' ', '') = source.Role
                WHEN MATCHED THEN UPDATE SET OfficialId = @OfficialId, FirstName = @FirstName, LastName = @LastName, Role = @Role
                WHEN NOT MATCHED THEN INSERT (Id, GameId, OfficialId, FirstName, LastName, Role)
                    VALUES (NEWID(), @GameId, @OfficialId, @FirstName, @LastName, @Role);",
                new { GameId = gameId, Role = role.Trim(), official.OfficialId, official.FirstName, official.LastName }, transaction);
        }

        private static async Task MoveOfficialAssignmentAsync(
            System.Data.IDbConnection conn,
            System.Data.IDbTransaction transaction,
            Guid gameId,
            string previousRole,
            string newRole,
            MobileOfficialRow official)
        {
            var sourceId = await conn.QueryFirstOrDefaultAsync<Guid?>(@"
                SELECT TOP 1 Id FROM dbo.GameOfficials
                WHERE GameId = @GameId AND REPLACE(Role, ' ', '') = @PreviousRole AND OfficialId = @OfficialId;",
                new { GameId = gameId, PreviousRole = previousRole, official.OfficialId }, transaction);
            if (!sourceId.HasValue)
            {
                await AssignOfficialAsync(conn, gameId, newRole, official, transaction);
                return;
            }

            var target = await conn.QueryFirstOrDefaultAsync<GameOfficialAssignmentRow>(@"
                SELECT TOP 1 Id, OfficialId, FirstName, LastName FROM dbo.GameOfficials
                WHERE GameId = @GameId AND REPLACE(Role, ' ', '') = @NewRole;",
                new { GameId = gameId, NewRole = newRole }, transaction);

            if (target == null)
            {
                await conn.ExecuteAsync("UPDATE dbo.GameOfficials SET Role = @NewRole WHERE Id = @SourceId;",
                    new { NewRole = newRole, SourceId = sourceId.Value }, transaction);
            }
            else
            {
                var temporaryRole = $"Swap-{Guid.NewGuid():N}";
                await conn.ExecuteAsync("UPDATE dbo.GameOfficials SET Role = @TemporaryRole WHERE Id = @SourceId;",
                    new { TemporaryRole = temporaryRole, SourceId = sourceId.Value }, transaction);
                await conn.ExecuteAsync("UPDATE dbo.GameOfficials SET Role = @PreviousRole WHERE Id = @TargetId;",
                    new { PreviousRole = previousRole, TargetId = target.Id }, transaction);
                await conn.ExecuteAsync("UPDATE dbo.GameOfficials SET Role = @NewRole WHERE Id = @SourceId;",
                    new { NewRole = newRole, SourceId = sourceId.Value }, transaction);
            }

            await conn.ExecuteAsync(@"
                DELETE FROM dbo.GameOfficialVerifications
                WHERE GameId = @GameId AND REPLACE(Role, ' ', '') IN @Roles;",
                new { GameId = gameId, Roles = new[] { previousRole, newRole } }, transaction);
        }

        private static bool IsValidAssignmentRole(string? role) => role is "Referee1" or "Referee2" or "Linesman1" or "Linesman2";
        private static bool OfficialSupportsRole(string? officialRole, string assignmentRole) => assignmentRole.StartsWith("Referee", StringComparison.OrdinalIgnoreCase)
            ? officialRole?.Contains("Referee", StringComparison.OrdinalIgnoreCase) == true
            : officialRole?.Contains("Linesman", StringComparison.OrdinalIgnoreCase) == true;
        private static bool SupportsSelectedRole(MobileCreateOfficialDto dto, string assignmentRole) => assignmentRole.StartsWith("Referee", StringComparison.OrdinalIgnoreCase) ? dto.IsReferee : dto.IsLinesman;
        private static async Task<HttpResponseData> BadRequestAsync(HttpRequestData req, string message) { var response = req.CreateResponse(HttpStatusCode.BadRequest); await response.WriteAsJsonAsync(new { message }); return response; }
        private static async Task<HttpResponseData> UnauthorizedAsync(HttpRequestData req, string message) { var response = req.CreateResponse(HttpStatusCode.Unauthorized); await response.WriteAsJsonAsync(new { message }); return response; }

        private sealed class MobileOfficialRow
        {
            public Guid OfficialId { get; set; }
            public string FirstName { get; set; } = string.Empty;
            public string LastName { get; set; } = string.Empty;
            public string? Role { get; set; }
        }

        private sealed class GameOfficialAssignmentRow
        {
            public Guid Id { get; set; }
            public Guid? OfficialId { get; set; }
            public string FirstName { get; set; } = string.Empty;
            public string LastName { get; set; } = string.Empty;
        }
    }
}