using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.Tasks;
using Azure.Core.Serialization;
using Dapper;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Context.Features;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.DependencyInjection;
using TipInAPI.Functions;
using TipInAPI.Services;
using Xunit;

namespace TipInAPI.Tests
{
    public class MobileEventEditTests
    {
        [Theory]
        [InlineData("Penalty", false)]
        [InlineData("Penalty", true)]
        [InlineData("Goal", false)]
        [InlineData("Goal", true)]
        public async Task EditPersistsDetailsAndPublicSummaryWithoutReplacingEvent(string eventType, bool useClientRef)
        {
            using var db = new TestDatabase();
            using var services = CreateServices();
            var reportService = new GameSummaryReportService(db.Factory);
            var mobile = new MobileGameManagerFunctions(db.Factory, null!, reportService, null!, null!, null!);
            var publicView = new PublicGameViewFunctions(null!, null!, null!, null!, reportService, db.Factory);
            var game = db.AddGame(db.HostTeamId, db.VisitorTeamId, 0, "In Progress");
            var oldPlayer = db.AddPlayer(db.HostOrgId, "Original", "Player", 11, db.HostTeamId);
            var newPlayer = db.AddPlayer(db.VisitorOrgId, "Corrected", "Player", 22, db.VisitorTeamId);
            var assist = db.AddPlayer(db.VisitorOrgId, "Corrected", "Assist", 23, db.VisitorTeamId);
            const string clientRef = "test-local-event";
            using var conn = db.Factory.CreateConnection();
            try
            {
                var create = await Request(services, new
                {
                    teamId = db.HostTeamId, scorerId = oldPlayer, playerId = oldPlayer,
                    period = 1, timeInPeriod = "12:00", infraction = "Hooking", durationMinutes = 2,
                    penaltyType = "Minor", strength = "Even Strength", clientEventId = clientRef
                });
                var created = eventType == "Penalty"
                    ? await mobile.CreateGamePenaltyForMobile(create, game)
                    : await mobile.CreateGameGoalForMobile(create, game);
                Assert.InRange((int)created.StatusCode, 200, 299);
                created.Body.Position = 0;
                using var createdJson = await JsonDocument.ParseAsync(created.Body);
                var eventId = createdJson.RootElement.GetProperty("eventId").GetGuid();
                var createdAt = conn.ExecuteScalar<DateTime>("SELECT CreatedAt FROM GameEvents WHERE Id=@eventId", new { eventId });

                var request = await Request(services, new
                {
                    eventType, teamId = db.VisitorTeamId, playerId = newPlayer,
                    assist1Id = assist, assist2Id = (Guid?)null, strength = "Power Play",
                    period = 2, timeInPeriod = "09:30", infraction = "Tripping", durationMinutes = 5,
                    penaltyType = "Major", suspensionBehavior = "review", requiresRefereeNotes = true, reviewRequired = true
                });
                var eventRef = useClientRef ? clientRef : eventId.ToString();
                Assert.Equal(HttpStatusCode.NoContent, (await mobile.UpdateGameEventForMobile(request, game, eventRef)).StatusCode);
                Assert.Equal(1, conn.ExecuteScalar<int>("SELECT COUNT(*) FROM GameEvents WHERE GameId=@game", new { game }));
                Assert.Equal(createdAt, conn.ExecuteScalar<DateTime>("SELECT CreatedAt FROM GameEvents WHERE Id=@eventId", new { eventId }));
                Assert.Equal(newPlayer, conn.ExecuteScalar<Guid>("SELECT PlayerId FROM GameEvents WHERE Id=@eventId", new { eventId }));
                Assert.Equal(db.VisitorTeamId, conn.ExecuteScalar<Guid>("SELECT TeamId FROM GameEvents WHERE Id=@eventId", new { eventId }));
                Assert.Equal(clientRef, conn.ExecuteScalar<string>("SELECT JSON_VALUE(Details,'$.ClientEventId') FROM GameEvents WHERE Id=@eventId", new { eventId }));
                if (eventType == "Penalty")
                {
                    Assert.Equal("Major", conn.ExecuteScalar<string>("SELECT JSON_VALUE(Details,'$.PenaltyType') FROM GameEvents WHERE Id=@eventId", new { eventId }));
                    Assert.Equal("true", conn.ExecuteScalar<string>("SELECT JSON_VALUE(Details,'$.ReviewRequired') FROM GameEvents WHERE Id=@eventId", new { eventId }));
                }

                var summary = await publicView.GetSummary(new TestRequest(new TestContext(services)), game);
                Assert.Equal(HttpStatusCode.OK, summary.StatusCode);
                summary.Body.Position = 0;
                using var json = await JsonDocument.ParseAsync(summary.Body);
                var row = json.RootElement.GetProperty(eventType == "Penalty" ? "penalties" : "goals")[0];
                Assert.Contains("Corrected Player", row.GetProperty(eventType == "Penalty" ? "playerName" : "scorerName").GetString());
                Assert.Equal(2, row.GetProperty("period").GetInt32());
                Assert.Equal("09:30", row.GetProperty("timeInPeriod").GetString());
                if (eventType == "Penalty")
                {
                    Assert.Equal("Tripping", row.GetProperty("infraction").GetString());
                    Assert.Equal(5, row.GetProperty("durationMinutes").GetInt32());
                }
                else
                {
                    Assert.Contains("Corrected Assist", row.GetProperty("assist1Name").GetString());
                    Assert.Equal("PP", row.GetProperty("strength").GetString());
                    var clearAssist = await Request(services, new
                    {
                        eventType, teamId = db.VisitorTeamId, playerId = newPlayer,
                        assist1Id = (Guid?)null, assist2Id = (Guid?)null, strength = "Even Strength",
                        period = 2, timeInPeriod = "09:30"
                    });
                    Assert.Equal(HttpStatusCode.NoContent, (await mobile.UpdateGameEventForMobile(clearAssist, game, eventRef)).StatusCode);
                    Assert.Null(conn.ExecuteScalar<Guid?>("SELECT Assist1Id FROM GameGoals WHERE EventId=@eventId", new { eventId }));
                }

                var timing = await Request(services, new { eventType, period = 3, timeInPeriod = "08:00" });
                Assert.Equal(HttpStatusCode.NoContent, (await mobile.UpdateGameEventTimingForMobile(timing, game, eventRef)).StatusCode);
                Assert.Equal(newPlayer, conn.ExecuteScalar<Guid>("SELECT PlayerId FROM GameEvents WHERE Id=@eventId", new { eventId }));
            }
            finally
            {
                conn.Execute("DELETE FROM GameGoals WHERE GameId=@game; DELETE FROM GamePenalties WHERE GameId=@game; DELETE FROM GameEvents WHERE GameId=@game;", new { game });
            }
        }

        [Fact]
        public async Task MissingDetailsRollBackEventChangesAndWrongGameDoesNotUpdate()
        {
            using var db = new TestDatabase();
            using var services = CreateServices();
            var mobile = new MobileGameManagerFunctions(db.Factory, null!, null!, null!, null!, null!);
            var game = db.AddGame(db.HostTeamId, db.VisitorTeamId, 0, "In Progress");
            var player = db.AddPlayer(db.HostOrgId, "Test", "Player", 1, db.HostTeamId);
            var id = Guid.NewGuid();
            using var conn = db.Factory.CreateConnection();
            conn.Execute(@"INSERT INTO GameEvents (Id, GameId, EventType, Period, TimeInPeriod, TeamId, PlayerId, CreatedAt)
                VALUES (@id, @game, 'Penalty', 1, '12:00', @team, @player, SYSUTCDATETIME())",
                new { id, game, team = db.HostTeamId, player });
            try
            {
                var body = new
                {
                    eventType = "Penalty", teamId = db.HostTeamId, playerId = player, period = 2,
                    timeInPeriod = "10:00", infraction = "Tripping", durationMinutes = 2, penaltyType = "Minor"
                };
                Assert.Equal(HttpStatusCode.Conflict,
                    (await mobile.UpdateGameEventForMobile(await Request(services, body), game, id.ToString())).StatusCode);
                Assert.Equal(1, conn.ExecuteScalar<int>("SELECT Period FROM GameEvents WHERE Id=@id", new { id }));
                var otherGame = db.AddGame(db.HostTeamId, db.VisitorTeamId, 0, "In Progress");
                Assert.Equal(HttpStatusCode.NotFound,
                    (await mobile.UpdateGameEventForMobile(await Request(services, body), otherGame, id.ToString())).StatusCode);
                Assert.Equal(1, conn.ExecuteScalar<int>("SELECT Period FROM GameEvents WHERE Id=@id", new { id }));
                var wrongTeam = await Request(services, new
                {
                    eventType = "Shot", teamId = db.OtherTeamId, period = 2, timeInPeriod = "10:00"
                });
                Assert.Equal(HttpStatusCode.BadRequest,
                    (await mobile.UpdateGameEventForMobile(wrongTeam, game, id.ToString())).StatusCode);
            }
            finally
            {
                conn.Execute("DELETE FROM GameEvents WHERE Id=@id", new { id });
            }
        }

        [Theory]
        [InlineData("Penalty", null)]
        [InlineData("Penalty", "12:00")]
        [InlineData("Goal", "12:00")]
        [InlineData("Shot", "12:99")]
        [InlineData("Other", "12:00")]
        public async Task InvalidUpdatesReturnBadRequest(string type, string? time)
        {
            using var services = CreateServices();
            var mobile = new MobileGameManagerFunctions(null!, null!, null!, null!, null!, null!);
            var request = await Request(services, new { eventType = type, teamId = Guid.NewGuid(), period = 1, timeInPeriod = time });
            Assert.Equal(HttpStatusCode.BadRequest,
                (await mobile.UpdateGameEventForMobile(request, Guid.NewGuid(), "event")).StatusCode);
        }

        private static async Task<TestRequest> Request(IServiceProvider services, object body)
        {
            var request = new TestRequest(new TestContext(services));
            await JsonSerializer.SerializeAsync(request.Body, body);
            request.Body.Position = 0;
            return request;
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
