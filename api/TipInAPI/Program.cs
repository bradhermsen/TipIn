using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Data.SqlClient;
using System.Data;
using System.Text.Json;

using TipInAPI.Repositories;
using TipInAPI.Services;
using TipInAPI.Infrastructure.Database;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults(worker =>
    {
        worker.Services.Configure<JsonSerializerOptions>(options =>
        {
            options.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
            options.DictionaryKeyPolicy = JsonNamingPolicy.CamelCase;
            options.PropertyNameCaseInsensitive = true;
        });
    })
    .ConfigureAppConfiguration((context, config) =>
    {
        config.AddJsonFile("appsettings.json", optional: true, reloadOnChange: true);
        config.AddJsonFile("local.settings.json", optional: true, reloadOnChange: true);
        config.AddEnvironmentVariables();
    })
    .ConfigureServices((context, services) =>
    {
        // Configuration
        services.AddSingleton<IConfiguration>(context.Configuration);

        // SQL connection factory
        services.AddScoped<ISqlConnectionFactory, SqlConnectionFactory>();


        // Raw DB connection
        var connectionString = context.Configuration.GetConnectionString("DefaultConnection");
        services.AddScoped<IDbConnection>(sp => new SqlConnection(connectionString));

        // Repositories
        services.AddScoped<IOrganizationRepository, OrganizationRepository>();
        services.AddScoped<ILeagueRepository, LeagueRepository>();
        services.AddScoped<ITeamsRepository, TeamsRepository>();
        services.AddScoped<ILevelsRepository, LevelsRepository>();
        services.AddScoped<ISeasonsRepository, SeasonsRepository>();
        services.AddScoped<IPlayersRepository, PlayersRepository>();
        services.AddScoped<IRosterEntriesRepository, RosterEntriesRepository>();
        services.AddScoped<IGameRepository, GameRepository>();

        // MUST come before UsersRepository
        services.AddScoped<ICoachTeamsRepository, CoachTeamsRepository>();

        // Now UsersRepository can resolve both dependencies
        services.AddScoped<IUsersRepository, UsersRepository>();

        // Services
        services.AddScoped<IOrganizationService, OrganizationService>();
        services.AddScoped<ILeagueService, LeagueService>();
        services.AddScoped<ITeamsService, TeamsService>();
        services.AddScoped<ILevelsService, LevelsService>();
        services.AddScoped<ISeasonsService, SeasonsService>();
        services.AddScoped<IPlayersService, PlayersService>();
        services.AddScoped<IRosterEntriesService, RosterEntriesService>();
        services.AddScoped<IGameService, GameService>();
        services.AddScoped<IUsersService, UsersService>();
        services.AddScoped<ICoachTeamsService, CoachTeamsService>();
        services.AddScoped<ITeamAuthorizationService, TeamAuthorizationService>();
        services.AddScoped<IAccessCodeService, AccessCodeService>();
        services.AddScoped<IAccessCodeValidator, AccessCodeValidator>();
        services.AddScoped<IEmailService, SmtpEmailService>();
        services.AddScoped<IGameSummaryReportService, GameSummaryReportService>();
        services.AddSingleton<IGatewaySecretProtector, GatewaySecretProtector>();
        services.AddScoped<IAuthorizationService>(sp =>
        {
            var config = sp.GetRequiredService<IConfiguration>();
            var jwtKey = config["Jwt:Key"];
            return new AuthorizationService(jwtKey ?? "your-super-secret-key-at-least-32-characters-long");
        });
    })
    .Build();

host.Run();
