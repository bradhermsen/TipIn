using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using Dapper;
using TipInAPI.Infrastructure.Database;

namespace TipInAPI.Functions
{
    public class DebugPlayerTeams
    {
        private readonly ISqlConnectionFactory _connectionFactory;

        public DebugPlayerTeams(ISqlConnectionFactory connectionFactory)
        {
            _connectionFactory = connectionFactory;
        }

        [Function("DebugPlayerTeams")]
        public async Task<HttpResponseData> Run(
            [HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", Route = "debug/player-teams")] 
            HttpRequestData req,
            ILogger log)
        {
            try
            {
                var query = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
                var playerId = query["playerId"];
                if (string.IsNullOrEmpty(playerId))
                {
                    var res = req.CreateResponse(HttpStatusCode.BadRequest);
                    await res.WriteAsJsonAsync(new { error = "playerId parameter required" });
                    return res;
                }

                if (!Guid.TryParse(playerId, out var playerIdGuid))
                {
                    var res = req.CreateResponse(HttpStatusCode.BadRequest);
                    await res.WriteAsJsonAsync(new { error = "Invalid playerId format" });
                    return res;
                }

                using (var conn = _connectionFactory.CreateConnection())
                {
                    // Check RosterEntries table structure
                    Console.WriteLine("Querying RosterEntries columns...");
                    try
                    {
                        var columnQuery = @"
                            SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
                            FROM INFORMATION_SCHEMA.COLUMNS
                            WHERE TABLE_NAME = 'RosterEntries' AND TABLE_SCHEMA = 'dbo'
                            ORDER BY ORDINAL_POSITION";
                        
                        var columns = await conn.QueryAsync<dynamic>(columnQuery);
                        var columnList = columns.ToList();
                        
                        Console.WriteLine($"RosterEntries has {columnList.Count} columns:");
                        foreach (var col in columnList)
                        {
                            Console.WriteLine($"  - {col.COLUMN_NAME} ({col.DATA_TYPE}, nullable: {col.IS_NULLABLE})");
                        }
                        
                        var okRes = req.CreateResponse(HttpStatusCode.OK);
                        await okRes.WriteAsJsonAsync(new { 
                            success = true, 
                            columns = columnList
                        });
                        return okRes;
                    }
                    catch (Exception queryEx)
                    {
                        Console.WriteLine($"Query error: {queryEx.Message}");
                        log.LogError($"Query error: {queryEx.Message}");
                        
                        var errRes = req.CreateResponse(HttpStatusCode.InternalServerError);
                        await errRes.WriteAsJsonAsync(new { 
                            error = queryEx.Message,
                            innerError = queryEx.InnerException?.Message
                        });
                        return errRes;
                    }
                }
            }
            catch (Exception ex)
            {
                log.LogError($"Error: {ex.GetType().Name}: {ex.Message}");
                if (ex.InnerException != null)
                    log.LogError($"Inner: {ex.InnerException.Message}");
                
                var errRes = req.CreateResponse(HttpStatusCode.InternalServerError);
                await errRes.WriteAsJsonAsync(new { error = ex.Message, inner = ex.InnerException?.Message });
                return errRes;
            }
        }
    }
}
