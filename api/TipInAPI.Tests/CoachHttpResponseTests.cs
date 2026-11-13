using System;
using System.Collections.Generic;
using System.IO;
using System.Globalization;
using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.Tasks;
using System.Threading;
using Azure.Core.Serialization;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Context.Features;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using TipInAPI.Functions;
using TipInAPI.Infrastructure.Authorization;
using TipInAPI.Services;
using TipInAPI.Repositories;
using Dapper;
using Xunit;

namespace TipInAPI.Tests
{
    public class CoachHttpResponseTests
    {
        [Theory]
        [InlineData("Scheduled", 5, 425)]
        [InlineData("Scheduled", 4, 200)]
        [InlineData("In Progress", 5, 200)]
        [InlineData("Final", -1, 410)]
        [InlineData("Scheduled", 50, 404)]
        public async Task MobileNextGame_PreservesStatus_AndUsesScheduledCentralLoginWindow(string gameStatus, int hoursAhead, int expectedStatus)
        {
            using var db = new TestDatabase();
            using var services = CreateServices();
            using var conn = db.Factory.CreateConnection();
            var start = CoachReminderSchedule.LocalNow(DateTime.UtcNow).AddHours(hoursAhead);
            start = start.AddTicks(-(start.Ticks % TimeSpan.TicksPerSecond));
            var game = db.AddGame(db.HostTeamId, db.VisitorTeamId, 0, gameStatus);
            conn.Execute(@"UPDATE Games SET GameDateTime=@start WHERE GameId=@game;
                UPDATE Teams SET Name='Winona',TeamType='Girls' WHERE Id=@home;
                UPDATE Teams SET Name='South Central' WHERE Id=@away;",
                new { start, game, home = db.HostTeamId, away = db.VisitorTeamId });
            var level = conn.ExecuteScalar<string>(
                "SELECT l.Name FROM Teams t JOIN Levels l ON l.Id=t.LevelId WHERE t.Id=@home",
                new { home = db.HostTeamId });
            var functions = new MobileGameManagerFunctions(db.Factory, null!, null!, null!,
                new AccessCodeService(), new LineupService(db.Factory));
            var response = await functions.GetTeamNextGame(new TestRequest(new TestContext(services)), db.HostTeamId);
            Assert.Equal((HttpStatusCode)expectedStatus, response.StatusCode);
            if (expectedStatus == 404) return;
            response.Body.Position = 0;
            using var json = await JsonDocument.ParseAsync(response.Body);
            var body = json.RootElement;
            if (expectedStatus == 425)
            {
                Assert.Equal("login_too_early", body.GetProperty("error").GetString());
                Assert.Equal("Login Not Open Yet", body.GetProperty("title").GetString());
                Assert.Equal("Winona", body.GetProperty("teamName").GetString());
                Assert.Equal(level, body.GetProperty("levelName").GetString());
                Assert.Equal("Girls", body.GetProperty("teamType").GetString());
                Assert.Equal("South Central", body.GetProperty("opponentName").GetString());
                Assert.Equal(start.AddHours(-4), body.GetProperty("loginOpensAt").GetDateTime());
                Assert.Equal("America/Chicago", body.GetProperty("timeZone").GetString());
                var zone = CoachReminderSchedule.Central.IsDaylightSavingTime(start) ? "CDT" : "CST";
                var culture = CultureInfo.GetCultureInfo("en-US");
                Assert.Equal("Your access code is valid. Game Manager login opens four hours before the scheduled game time.\n\n"
                    + $"Team: Winona\nLevel: {level}\nType: Girls\nOpponent: South Central\n"
                    + $"Game time: {start.ToString("dddd, MMMM d 'at' h:mm tt", culture)} {zone}\n"
                    + $"Login opens: {start.AddHours(-4).ToString("dddd, MMMM d 'at' h:mm tt", culture)} {zone}\n\n"
                    + "Please try again when login opens.", body.GetProperty("message").GetString());
            }
            else if (expectedStatus == 200)
            {
                Assert.Equal(game, body.GetProperty("gameId").GetGuid());
                Assert.Equal(db.HostTeamId, body.GetProperty("homeTeamId").GetGuid());
            }
            else
            {
                Assert.True(body.GetProperty("isClosed").GetBoolean());
            }
        }

        [Theory]
        [InlineData("2026-11-14T13:00:00", "Saturday, November 14 at 1:00 PM CST", "Saturday, November 14 at 9:00 AM CST")]
        [InlineData("2026-07-14T13:00:00", "Tuesday, July 14 at 1:00 PM CDT", "Tuesday, July 14 at 9:00 AM CDT")]
        [InlineData("2026-11-14T02:00:00", "Saturday, November 14 at 2:00 AM CST", "Friday, November 13 at 10:00 PM CST")]
        public void MobileLoginNotice_FormatsGameAndOpeningDatesInCentralTime(string scheduled, string gameTime, string opensAt)
        {
            var start = DateTime.Parse(scheduled, CultureInfo.InvariantCulture);
            var method = typeof(MobileGameManagerFunctions).GetMethod("FormatGameLoginTime", BindingFlags.NonPublic | BindingFlags.Static)!;
            Assert.Equal(gameTime, method.Invoke(null, new object[] { start }));
            Assert.Equal(opensAt, method.Invoke(null, new object[] { start.AddHours(-4) }));
        }

        [Fact]
        public async Task GameManagerAccessEndpoint_RequiresAuthenticationAndScope_AndIsNeverCached()
        {
            using var db = new TestDatabase();
            using var services = CreateServices();
            var head = db.AddCoach(db.HostTeamId);
            using var conn = db.Factory.CreateConnection();
            conn.Execute(@"UPDATE dbo.Teams SET ScorekeeperCode='GM-ABC123',
                HeadCoachEmail=(SELECT Email FROM dbo.AuthUsers WHERE Id=@head) WHERE Id=@t",
                new { head, t = db.HostTeamId });
            var game = db.AddGame(db.HostTeamId, db.VisitorTeamId, 0, "Scheduled");
            var functions = new LineupFunctions(new LineupService(db.Factory), new TestAuthorization(head, "Coach"),
                new TeamAuthorizationService(db.Factory), new CoachTeamsService(new CoachTeamsRepository(db.Factory)),
                db.Factory, new AccessCodeService());
            var request = new TestRequest(new TestContext(services));
            Assert.Equal(HttpStatusCode.Unauthorized,
                (await functions.CoachGetGameManagerAccess(request, game, db.HostTeamId, default)).StatusCode);
            request.Headers.Add("Authorization", "Bearer fixture");
            Assert.Equal(HttpStatusCode.Forbidden,
                (await functions.CoachGetGameManagerAccess(request, game, db.OtherTeamId, default)).StatusCode);
            var response = await functions.CoachGetGameManagerAccess(request, game, db.HostTeamId, default);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Contains("no-store", response.Headers.GetValues("Cache-Control"));
            response.Body.Position = 0;
            using var json = await JsonDocument.ParseAsync(response.Body);
            Assert.Equal("GM-ABC123", json.RootElement.GetProperty("code").GetString());
        }

        private sealed class AutomationState : ICoachEmailAutomationSettingsService
        {
            public CoachEmailAutomationSettings Settings = new();
            public Task<CoachEmailAutomationSettings> GetAsync(CancellationToken cancellationToken = default) => Task.FromResult(Settings);
            public Task SaveAsync(CoachEmailAutomationSettings settings, CancellationToken cancellationToken = default)
            {
                Settings = settings; return Task.CompletedTask;
            }
        }

        [Theory]
        [InlineData("OrgAdmin")]
        [InlineData("Coach")]
        [InlineData("TeamManager")]
        [InlineData("Viewer")]
        public async Task AutomationEndpoints_RejectNonSuperAdmins_ForReadAndWrite(string role)
        {
            using var services = CreateServices();
            var state = new AutomationState();
            var functions = new CoachEmailAutomationFunctions(new TestAuthorization(Guid.NewGuid(), role), state, new ConfigurationBuilder().Build(), new EmailLogState());
            var request = new TestRequest(new TestContext(services));
            request.Headers.Add("Authorization", "Bearer fixture");
            Assert.Equal(HttpStatusCode.Forbidden, (await functions.Get(request, default)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await functions.Put(request, default)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await functions.GetLog(request, default)).StatusCode);
            Assert.False(state.Settings.AutomaticInvitations);
        }

        [Fact]
        public async Task AutomationEndpoints_DefaultOff_PersistEachSwitch_AndRejectMalformedJson()
        {
            using var services = CreateServices();
            var state = new AutomationState();
            var functions = new CoachEmailAutomationFunctions(new TestAuthorization(Guid.NewGuid(), "SuperAdmin"), state, new ConfigurationBuilder().Build(), new EmailLogState());
            var request = new TestRequest(new TestContext(services));
            Assert.Equal(HttpStatusCode.Unauthorized, (await functions.Get(request, default)).StatusCode);
            request.Headers.Add("Authorization", "Bearer fixture");
            var response = await functions.Get(request, default);
            response.Body.Position = 0;
            using (var json = await JsonDocument.ParseAsync(response.Body))
            {
                Assert.False(json.RootElement.GetProperty("automaticInvitations").GetBoolean());
                Assert.False(json.RootElement.GetProperty("rosterReminders").GetBoolean());
                Assert.False(json.RootElement.GetProperty("lineupReminders").GetBoolean());
            }
            await JsonSerializer.SerializeAsync(request.Body, new { automaticInvitations = true, rosterReminders = false, lineupReminders = true });
            request.Body.Position = 0;
            Assert.Equal(HttpStatusCode.OK, (await functions.Put(request, default)).StatusCode);
            Assert.True(state.Settings.AutomaticInvitations);
            Assert.False(state.Settings.RosterReminders);
            Assert.True(state.Settings.LineupReminders);
            request.Body.SetLength(0);
            await request.Body.WriteAsync(System.Text.Encoding.UTF8.GetBytes("{\"automaticInvitations\":\"bad\"}"));
            request.Body.Position = 0;
            Assert.Equal(HttpStatusCode.BadRequest, (await functions.Put(request, default)).StatusCode);
            request.Body.SetLength(0);
            await request.Body.WriteAsync(System.Text.Encoding.UTF8.GetBytes("{}"));
            request.Body.Position = 0;
            Assert.Equal(HttpStatusCode.BadRequest, (await functions.Put(request, default)).StatusCode);
            Assert.True(state.Settings.AutomaticInvitations);
        }

        [Theory]
        [InlineData("Coach", true, HttpStatusCode.OK)]
        [InlineData("TeamManager", true, HttpStatusCode.OK)]
        [InlineData("Coach", false, HttpStatusCode.Forbidden)]
        [InlineData("TeamManager", false, HttpStatusCode.Forbidden)]
        [InlineData("Viewer", true, HttpStatusCode.Forbidden)]
        [InlineData("OrgAdmin", true, HttpStatusCode.OK)]
        [InlineData("OrgAdmin", false, HttpStatusCode.Forbidden)]
        [InlineData("SuperAdmin", false, HttpStatusCode.OK)]
        public async Task StaffEndpoints_EnforceRosterRoleAndTeamScope(string role, bool assigned, HttpStatusCode expected)
        {
            using var db = new TestDatabase();
            using var services = CreateServices();
            var user = role == "OrgAdmin" ? db.HostAdminId : db.AddCoach(db.HostTeamId);
            var team = assigned ? db.HostTeamId : db.OtherTeamId;
            var functions = new CoachRosterFunctions(new CoachRosterService(db.Factory),
                new TestAuthorization(user, role), new TeamAuthorizationService(db.Factory),
                new CoachTeamsService(new CoachTeamsRepository(db.Factory)));
            var request = new TestRequest(new TestContext(services));
            request.Headers.Add("Authorization", "Bearer fixture");
            Assert.Equal(expected, (await functions.GetStaff(request, team)).StatusCode);
            var rosterRequest = new TestRequest(new TestContext(services), "?includeInactive=true");
            rosterRequest.Headers.Add("Authorization", "Bearer test");
            Assert.Equal(expected, (await functions.GetRoster(rosterRequest, team)).StatusCode);
            await JsonSerializer.SerializeAsync(request.Body, new { name = "Test Assistant" });
            request.Body.Position = 0;
            Assert.Equal(expected, (await functions.UpdateAssistant(request, team, 1)).StatusCode);
        }

        [Fact]
        public async Task StaffEndpoints_RequireAuthentication()
        {
            using var services = CreateServices();
            var functions = new CoachRosterFunctions(null!, null!, null!, null!);
            var request = new TestRequest(new TestContext(services));
            Assert.Equal(HttpStatusCode.Unauthorized, (await functions.GetStaff(request, Guid.NewGuid())).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await functions.GetRoster(request, Guid.NewGuid())).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await functions.UpdateAssistant(request, Guid.NewGuid(), 1)).StatusCode);
        }

        private sealed class TestAuthorization : IAuthorizationService
        {
            private readonly Guid _user;
            private readonly string _role;
            public TestAuthorization(Guid user, string role) { _user = user; _role = role; }
            public (bool IsValid, string UserId, string Role) ValidateToken(string bearerToken) => (true, _user.ToString(), _role);
            public bool HasRole(string role, params string[] allowedRoles) => Array.IndexOf(allowedRoles, role) >= 0;
            public bool HasAnyRole(string role, params string[] allowedRoles) => HasRole(role, allowedRoles);
        }

        [Theory]
        [InlineData(typeof(LineupFunctions))]
        [InlineData(typeof(CoachRosterFunctions))]
        public async Task SuccessfulResponses_PreservePayload(Type functionType)
        {
            using var services = CreateServices();
            var request = new TestRequest(new TestContext(services));
            var result = CoachRosterResult.Ok(new LineupState { Version = 2 });
            var method = functionType.GetMethod("ToResponseAsync", BindingFlags.NonPublic | BindingFlags.Static)!;
            var response = await (Task<HttpResponseData>)method.Invoke(null, new object[] { request, result })!;
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            response.Body.Position = 0;
            using var json = await JsonDocument.ParseAsync(response.Body);
            Assert.Equal(2, json.RootElement.GetProperty("version").GetInt32());
            Assert.Equal(JsonValueKind.Array, json.RootElement.GetProperty("participantIds").ValueKind);
            Assert.Equal(JsonValueKind.Array, json.RootElement.GetProperty("starterIds").ValueKind);
        }

        [Theory]
        [InlineData(typeof(LineupFunctions), CoachRosterOutcome.Invalid, HttpStatusCode.BadRequest)]
        [InlineData(typeof(LineupFunctions), CoachRosterOutcome.Warning, HttpStatusCode.Conflict)]
        [InlineData(typeof(LineupFunctions), CoachRosterOutcome.NotFound, HttpStatusCode.NotFound)]
        [InlineData(typeof(CoachRosterFunctions), CoachRosterOutcome.Invalid, HttpStatusCode.BadRequest)]
        [InlineData(typeof(CoachRosterFunctions), CoachRosterOutcome.Warning, HttpStatusCode.Conflict)]
        [InlineData(typeof(CoachRosterFunctions), CoachRosterOutcome.NotFound, HttpStatusCode.NotFound)]
        public async Task ValidationResponses_PreserveStatusAndMessage(Type functionType, CoachRosterOutcome outcome, HttpStatusCode status)
        {
            using var services = CreateServices();
            var request = new TestRequest(new TestContext(services));
            var result = new CoachRosterResult
            {
                Outcome = outcome,
                Message = "Goalie selection required. Select a goalie as a starter.",
                Data = new { code = "STALE_VERSION" }
            };
            var method = functionType.GetMethod("ToResponseAsync", BindingFlags.NonPublic | BindingFlags.Static)!;
            var response = await (Task<HttpResponseData>)method.Invoke(null, new object[] { request, result })!;
            Assert.Equal(status, response.StatusCode);
            response.Body.Position = 0;
            using var json = await JsonDocument.ParseAsync(response.Body);
            Assert.Equal(result.Message, json.RootElement.GetProperty("error").GetString());
            if (outcome == CoachRosterOutcome.Warning)
                Assert.Equal("STALE_VERSION", json.RootElement.GetProperty("details").GetProperty("code").GetString());
        }

        [Theory]
        [InlineData(HttpStatusCode.BadRequest)]
        [InlineData(HttpStatusCode.Unauthorized)]
        [InlineData(HttpStatusCode.Forbidden)]
        public async Task AuthorizationResponses_PreserveErrorStatus(HttpStatusCode status)
        {
            using var services = CreateServices();
            var request = new TestRequest(new TestContext(services));
            var response = status switch
            {
                HttpStatusCode.BadRequest => await AuthorizationHelper.BadRequestResponse(request),
                HttpStatusCode.Unauthorized => await AuthorizationHelper.UnauthorizedResponse(request),
                _ => await AuthorizationHelper.ForbiddenResponse(request)
            };
            Assert.Equal(status, response.StatusCode);
        }

        [Theory]
        [InlineData("?includeInactive=true", HttpStatusCode.OK, 2)]
        [InlineData("?includeInactive=false", HttpStatusCode.OK, 1)]
        [InlineData("", HttpStatusCode.OK, 1)]
        [InlineData("?includeInactive=garbage", HttpStatusCode.BadRequest, 0)]
        public async Task RosterEndpoint_ValidatesInclusiveFlag_AndReturnsInactiveStatus(string query, HttpStatusCode expected, int count)
        {
            using var db = new TestDatabase();
            using var services = CreateServices();
            var user = db.AddCoach(db.HostTeamId);
            var service = new CoachRosterService(db.Factory);
            await service.AddPlayerAsync(user, db.HostTeamId, new AddRosterPlayerRequest
                { FirstName = "Active", LastName = "Player", JerseyNumber = 1 });
            await service.AddPlayerAsync(user, db.HostTeamId, new AddRosterPlayerRequest
                { FirstName = "Removed", LastName = "Player", JerseyNumber = 2 });
            using var conn = db.Factory.CreateConnection();
            conn.Execute("UPDATE RosterEntries SET RemovedAtUtc=SYSUTCDATETIME() WHERE TeamId=@team AND JerseyNumber=2",
                new { team = db.HostTeamId });
            var functions = new CoachRosterFunctions(service, new TestAuthorization(user, "Coach"),
                new TeamAuthorizationService(db.Factory), new CoachTeamsService(new CoachTeamsRepository(db.Factory)));
            var request = new TestRequest(new TestContext(services), query);
            request.Headers.Add("Authorization", "Bearer test");
            var response = await functions.GetRoster(request, db.HostTeamId);
            Assert.Equal(expected, response.StatusCode);
            if (expected != HttpStatusCode.OK) return;
            Assert.Contains("no-store", response.Headers.GetValues("Cache-Control"));
            response.Body.Position = 0;
            using var json = await JsonDocument.ParseAsync(response.Body);
            Assert.Equal(count, json.RootElement.GetArrayLength());
            Assert.True(json.RootElement[0].GetProperty("isRosterActive").GetBoolean());
            if (count == 2) Assert.False(json.RootElement[1].GetProperty("isRosterActive").GetBoolean());
        }

        private sealed class EmailLogState : ICoachEmailLogService
        {
            public int Calls;
            public Task<CoachEmailLogResponse> GetAsync(DateOnly date, int page, CancellationToken cancellationToken)
            {
                Calls++;
                return Task.FromResult(new CoachEmailLogResponse(date.ToString("yyyy-MM-dd"), page, false,
                    Array.Empty<CoachEmailLogEntry>()));
            }
        }

        [Theory]
        [InlineData("?date=2026-02-30")]
        [InlineData("?date=2026-11-11&page=0")]
        [InlineData("?date=2026-11-11&page=10001")]
        [InlineData("?date=9999-12-31")]
        [InlineData("?date=")]
        [InlineData("?page=abc")]
        public async Task EmailLog_RejectsInvalidFiltersBeforeQuerying(string query)
        {
            using var services = CreateServices();
            var log = new EmailLogState();
            var functions = new CoachEmailAutomationFunctions(new TestAuthorization(Guid.NewGuid(), "SuperAdmin"),
                new AutomationState(), new ConfigurationBuilder().Build(), log);
            var request = new TestRequest(new TestContext(services), query);
            request.Headers.Add("Authorization", "Bearer test");
            Assert.Equal(HttpStatusCode.BadRequest, (await functions.GetLog(request, default)).StatusCode);
            Assert.Equal(0, log.Calls);
        }

        [Fact]
        public async Task EmailLog_RequiresAuthentication_ReturnsRequestedPage_AndDisablesCaching()
        {
            using var services = CreateServices();
            var log = new EmailLogState();
            var functions = new CoachEmailAutomationFunctions(new TestAuthorization(Guid.NewGuid(), "SuperAdmin"),
                new AutomationState(), new ConfigurationBuilder().Build(), log);
            var request = new TestRequest(new TestContext(services), "?date=2026-11-11&page=2");
            Assert.Equal(HttpStatusCode.Unauthorized, (await functions.GetLog(request, default)).StatusCode);
            Assert.Equal(0, log.Calls);
            request.Headers.Add("Authorization", "Bearer test");
            var response = await functions.GetLog(request, default);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Contains("no-store", response.Headers.GetValues("Cache-Control"));
            response.Body.Position = 0;
            using var json = await JsonDocument.ParseAsync(response.Body);
            Assert.Equal("2026-11-11", json.RootElement.GetProperty("date").GetString());
            Assert.Equal(2, json.RootElement.GetProperty("page").GetInt32());
            Assert.Empty(json.RootElement.GetProperty("items").EnumerateArray());
        }

        private static ServiceProvider CreateServices()
        {
            var services = new ServiceCollection();
            services.AddOptions<WorkerOptions>().Configure(options =>
                options.Serializer = new JsonObjectSerializer(new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
            return services.BuildServiceProvider();
        }

        private sealed class TestContext : FunctionContext
        {
            public TestContext(IServiceProvider services) { InstanceServices = services; }
            public override string InvocationId => "test";
            public override string FunctionId => "test";
            public override TraceContext TraceContext => throw new NotSupportedException();
            public override BindingContext BindingContext => throw new NotSupportedException();
            public override RetryContext RetryContext => throw new NotSupportedException();
            public override IServiceProvider InstanceServices { get; set; }
            public override FunctionDefinition FunctionDefinition => throw new NotSupportedException();
            public override IDictionary<object, object> Items { get; set; } = new Dictionary<object, object>();
            public override IInvocationFeatures Features => throw new NotSupportedException();
        }

        private sealed class TestRequest : HttpRequestData
        {
            private readonly string _query;
            public TestRequest(FunctionContext context, string query = "") : base(context) { _query = query; }
            public override Stream Body { get; } = new MemoryStream();
            public override HttpHeadersCollection Headers { get; } = new();
            public override IReadOnlyCollection<IHttpCookie> Cookies => Array.Empty<IHttpCookie>();
            public override Uri Url => new("https://localhost/api/test" + _query);
            public override IEnumerable<ClaimsIdentity> Identities => Array.Empty<ClaimsIdentity>();
            public override string Method => "PUT";
            public override HttpResponseData CreateResponse() => new TestResponse(FunctionContext);
        }

        private sealed class TestResponse : HttpResponseData
        {
            public TestResponse(FunctionContext context) : base(context) { }
            public override HttpStatusCode StatusCode { get; set; }
            public override HttpHeadersCollection Headers { get; set; } = new();
            public override Stream Body { get; set; } = new MemoryStream();
            public override HttpCookies Cookies => throw new NotSupportedException();
        }
    }
}
