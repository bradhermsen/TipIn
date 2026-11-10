using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.Tasks;
using Azure.Core.Serialization;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Context.Features;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.DependencyInjection;
using TipInAPI.Functions;
using TipInAPI.Infrastructure.Authorization;
using TipInAPI.Services;
using TipInAPI.Repositories;
using Xunit;

namespace TipInAPI.Tests
{
    public class CoachHttpResponseTests
    {
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
            public TestRequest(FunctionContext context) : base(context) { }
            public override Stream Body { get; } = new MemoryStream();
            public override HttpHeadersCollection Headers { get; } = new();
            public override IReadOnlyCollection<IHttpCookie> Cookies => Array.Empty<IHttpCookie>();
            public override Uri Url => new("https://localhost/api/test");
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
