using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net.Mail;
using System.Threading.Tasks;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using TipInAPI.Infrastructure.Database;

namespace TipInAPI.Services
{
    public sealed class CoachReminderCandidate
    {
        public Guid GameId { get; set; }
        public Guid TeamId { get; set; }
        public string Email { get; set; } = "";
        public string TeamName { get; set; } = "";
        public string? LevelName { get; set; }
        public string? TeamType { get; set; }
        public DateTime GameDateTime { get; set; }
        public string ReminderType { get; set; } = "";
        public bool HasTeamAccess { get; set; }
        public bool InvitationOnly { get; set; }
    }

    public class CoachReminderService
    {
        private readonly ISqlConnectionFactory _db;
        private readonly ICoachInvitationService _invitations;
        private readonly IEmailService _email;
        private readonly IConfiguration _config;
        private readonly ILogger<CoachReminderService> _logger;
        private readonly ICoachEmailAutomationSettingsService _automation;
        private const string EligibleGame = @"
            t.IsActive=1 AND LOWER(LTRIM(RTRIM(ISNULL(g.Status, '')))) NOT IN
            ('final','completed','closed','cancelled','canceled','postponed','in progress','inprogress','live')
            AND ISNULL((SELECT TOP 1 e.EventType FROM dbo.GameLineupEvents e
                WHERE e.GameId=g.GameId AND e.TeamId=t.Id ORDER BY e.CreatedAtUtc DESC,e.EventId DESC),'') <> 'Sign'";
        private const string ManagedGame = @"
            EXISTS (SELECT 1 FROM dbo.Teams homeTeam
                JOIN dbo.Organizations homeOrg ON homeOrg.OrganizationId=homeTeam.OrganizationId
                WHERE homeTeam.Id=g.HomeTeamId AND homeOrg.OrganizationType='Managed'
                    AND ISNULL(homeTeam.IsExternal,0)=0)";
        private const string Contacts = @"
            SELECT LOWER(LTRIM(RTRIM(a.Email))) AS Email FROM dbo.CoachTeams ct
                JOIN dbo.AuthUsers a ON a.Id=ct.UserId
                WHERE ct.TeamId=t.Id AND a.IsActive=1 AND a.Role IN ('Coach','TeamManager','OrgAdmin','SuperAdmin')
            UNION
            SELECT LOWER(LTRIM(RTRIM(t.HeadCoachEmail))) WHERE NULLIF(LTRIM(RTRIM(t.HeadCoachEmail)),'') IS NOT NULL";
        private const string AuthorizedForTeam = @"
            (a.Role='SuperAdmin'
                OR (a.Role='OrgAdmin' AND EXISTS (SELECT 1 FROM dbo.Users u
                    WHERE u.Id=a.Id AND u.OrganizationId=t.OrganizationId AND u.OrganizationId IS NOT NULL))
                OR (a.Role IN ('Coach','TeamManager') AND EXISTS (SELECT 1 FROM dbo.CoachTeams ct
                    WHERE ct.UserId=a.Id AND ct.TeamId=t.Id)))";
        private const string AccessQuery = @"
            SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.Teams t CROSS JOIN dbo.AuthUsers a
                WHERE t.Id=@teamId AND LOWER(LTRIM(RTRIM(a.Email)))=@email
                AND a.IsActive=1 AND " + AuthorizedForTeam + ") THEN 1 ELSE 0 END";
        private const string AllowedAccount = @"
            NOT EXISTS (SELECT 1 FROM dbo.AuthUsers a WHERE LOWER(LTRIM(RTRIM(a.Email)))=c.Email
                AND (a.IsActive=0 OR a.Role NOT IN ('Coach','TeamManager','OrgAdmin','SuperAdmin')
                    OR (a.Role IN ('OrgAdmin','SuperAdmin') AND NOT " + AuthorizedForTeam + @")))
            AND (EXISTS (SELECT 1 FROM dbo.AuthUsers a WHERE LOWER(LTRIM(RTRIM(a.Email)))=c.Email
                    AND a.IsActive=1 AND " + AuthorizedForTeam + @")
                OR (ISNULL((SELECT TOP 1 i.Status FROM dbo.CoachInvitations i
                        WHERE i.TeamId=t.Id AND i.Email=c.Email ORDER BY i.CreatedAtUtc DESC,i.InvitationId DESC),'Pending')='Pending'
                    AND NOT EXISTS (SELECT 1 FROM dbo.CoachInvitations i
                        WHERE i.TeamId=t.Id AND i.Email=c.Email AND i.Status='Pending' AND i.FailedAttempts >= 5)))";

        public CoachReminderService(ISqlConnectionFactory db, ICoachInvitationService invitations,
            IEmailService email, IConfiguration config, ILogger<CoachReminderService> logger,
            ICoachEmailAutomationSettingsService automation)
        {
            _db = db; _invitations = invitations; _email = email; _config = config; _logger = logger; _automation = automation;
        }

        public async Task<IReadOnlyList<CoachReminderCandidate>> PreviewAsync(DateTime utcNow)
        {
            using var conn = _db.CreateConnection();
            var settings = await _automation.GetAsync();
            var today = CoachReminderSchedule.LocalNow(utcNow).Date;
            var candidates = await conn.QueryAsync<CoachReminderCandidate>($@"
                SELECT g.GameId,t.Id AS TeamId,t.Name AS TeamName,l.Name AS LevelName,t.TeamType,
                    g.GameDateTime,c.Email
                FROM dbo.Games g JOIN dbo.Teams t ON t.Id IN(g.HomeTeamId,g.AwayTeamId)
                LEFT JOIN dbo.Levels l ON l.Id=t.LevelId
                CROSS APPLY ({Contacts}) c
                WHERE g.GameDateTime >= @today AND g.GameDateTime < @end
                    AND {ManagedGame} AND {EligibleGame} AND {AllowedAccount}
                ORDER BY g.GameDateTime,g.GameId,t.Id,c.Email;",
                new { today, end = today.AddDays(4) });
            var due = new List<CoachReminderCandidate>();
            foreach (var candidate in candidates)
            {
                var type = CoachReminderSchedule.DueType(candidate.GameDateTime, utcNow);
                if (type == null) continue;
                candidate.ReminderType = type;
                if (!MailAddress.TryCreate(candidate.Email, out var address) || address.Address != candidate.Email)
                {
                    _logger.LogWarning("Skipping invalid coach email contact for game {GameId}, team {TeamId}.", candidate.GameId, candidate.TeamId);
                    continue;
                }
                candidate.HasTeamAccess = await conn.ExecuteScalarAsync<bool>(AccessQuery,
                    new { teamId = candidate.TeamId, email = candidate.Email });
                var pending = await conn.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM dbo.CoachInvitations WHERE TeamId=@TeamId AND Email=@Email AND Status='Pending'
                        AND ExpiresAtUtc > SYSUTCDATETIME() AND FailedAttempts < 5;", candidate) > 0;
                var stageEnabled = type == "RosterReview" ? settings.RosterReminders : settings.LineupReminders;
                if (!candidate.HasTeamAccess && !pending)
                {
                    if (!settings.AutomaticInvitations) continue;
                    candidate.InvitationOnly = true;
                    candidate.ReminderType = "Invitation";
                }
                else if (!stageEnabled) continue;
                var delivered = await conn.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM dbo.CoachReminderDeliveries
                    WHERE TeamId=@TeamId AND Email=@Email
                        AND ((GameId=@GameId AND ReminderType=@ReminderType) OR Status IN ('Sending','NeedsReview'));", candidate);
                if (delivered == 0) due.Add(candidate);
            }
            return due;
        }

        public async Task<int> RunAsync(DateTime utcNow)
        {
            if (_config.GetValue<bool?>("CoachReminders:Enabled") == false) return 0;
            var settings = await _automation.GetAsync();
            if (!settings.AutomaticInvitations && !settings.RosterReminders && !settings.LineupReminders) return 0;
            if (!(await _email.GetSettingsAsync()).Enabled)
            {
                _logger.LogWarning("Coach reminders are enabled but SMTP delivery is disabled; no deliveries were claimed.");
                return 0;
            }
            var baseUrl = _config["CoachApp:BaseUrl"]?.TrimEnd('/');
            if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var coachUri) || coachUri.Scheme != Uri.UriSchemeHttps
                || !string.IsNullOrEmpty(coachUri.Query) || !string.IsNullOrEmpty(coachUri.Fragment)
                || !string.IsNullOrEmpty(coachUri.UserInfo))
                throw new InvalidOperationException("CoachApp:BaseUrl must be the configured HTTPS coach site URL before enabling reminders.");
            using var conn = _db.CreateConnection();
            var acquired = await conn.ExecuteScalarAsync<int>(@"
                DECLARE @result int;
                EXEC @result=sys.sp_getapplock @Resource='tipin-coach-reminder-dispatch',
                    @LockMode='Exclusive',@LockOwner='Session',@LockTimeout=0;
                SELECT @result;");
            if (acquired == -1) return 0;
            if (acquired < 0) throw new InvalidOperationException("Could not acquire coach reminder dispatch lock.");
            var sent = 0;
            var failures = 0;
            var elapsed = Stopwatch.StartNew();
            try
            {
                var uncertain = await conn.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM dbo.CoachReminderDeliveries WHERE Status='NeedsReview'
                        OR (Status='Sending' AND ClaimedAtUtc < DATEADD(minute,-30,SYSUTCDATETIME()));");
                if (uncertain > 0) _logger.LogWarning("{UncertainCount} coach reminder deliveries require operator review; affected contacts are paused.", uncertain);
                var candidates = await PreviewAsync(utcNow);
                foreach (var candidate in candidates)
                {
                    // Recheck the game, latest signature, contact authorization and account immediately before claiming.
                    var eligible = await conn.ExecuteScalarAsync<int>($@"
                        SELECT COUNT(*) FROM dbo.Games g JOIN dbo.Teams t ON t.Id IN(g.HomeTeamId,g.AwayTeamId)
                        CROSS APPLY ({Contacts}) c
                        WHERE g.GameId=@GameId AND t.Id=@TeamId AND c.Email=@Email
                            AND {ManagedGame} AND {EligibleGame} AND {AllowedAccount}
                            AND g.GameDateTime=@GameDateTime;", candidate);
                    if (eligible == 0 || !IsDue(candidate, utcNow + elapsed.Elapsed)) continue;
                    var claimed = await conn.ExecuteAsync(@"
                        INSERT INTO dbo.CoachReminderDeliveries(GameId,TeamId,Email,ReminderType,Status)
                        SELECT @GameId,@TeamId,@Email,@ReminderType,'Sending'
                        WHERE NOT EXISTS (SELECT 1 FROM dbo.CoachReminderDeliveries
                            WHERE TeamId=@TeamId AND Email=@Email
                                AND ((GameId=@GameId AND ReminderType=@ReminderType) OR Status IN ('Sending','NeedsReview')));", candidate);
                    if (claimed == 0) continue;
                    Task ReleaseClaimAsync() => conn.ExecuteAsync(@"DELETE FROM dbo.CoachReminderDeliveries
                        WHERE GameId=@GameId AND TeamId=@TeamId AND Email=@Email AND ReminderType=@ReminderType;", candidate);
                    try
                    {
                        var game = await conn.QuerySingleAsync<CoachInvitationGame>(@"
                            SELECT g.GameId,g.GameDateTime,g.ArenaName,g.RinkName,
                                h.Name AS HomeTeamName,a.Name AS AwayTeamName,
                                COALESCE(h.TeamType,a.TeamType) AS TeamType,COALESCE(hl.Name,al.Name) AS LevelName
                            FROM dbo.Games g JOIN dbo.Teams h ON h.Id=g.HomeTeamId JOIN dbo.Teams a ON a.Id=g.AwayTeamId
                            LEFT JOIN dbo.Levels hl ON hl.Id=h.LevelId LEFT JOIN dbo.Levels al ON al.Id=a.LevelId
                            WHERE g.GameId=@GameId;", candidate);
                        candidate.HasTeamAccess = await conn.ExecuteScalarAsync<bool>(AccessQuery,
                            new { teamId = candidate.TeamId, email = candidate.Email });
                        CreatedCoachInvitation invite;
                        if (candidate.HasTeamAccess)
                        {
                            invite = new CreatedCoachInvitation
                            {
                                TeamId = candidate.TeamId, TeamName = candidate.TeamName, LevelName = candidate.LevelName,
                                TeamType = candidate.TeamType, Email = candidate.Email, Game = game
                            };
                        }
                        else
                        {
                            settings = await _automation.GetAsync();
                            if (!settings.AutomaticInvitations && candidate.InvitationOnly)
                            {
                                await ReleaseClaimAsync();
                                continue;
                            }
                            invite = await _invitations.CreateForReminderAsync(candidate.TeamId, candidate.Email, game, settings.AutomaticInvitations);
                        }
                        if (candidate.InvitationOnly && (candidate.HasTeamAccess || invite.ReusedPendingInvitation))
                        {
                            await ReleaseClaimAsync();
                            continue;
                        }
                        var invitationId = invite.InvitationId == Guid.Empty ? (Guid?)null : invite.InvitationId;
                        await conn.ExecuteAsync(@"
                            UPDATE dbo.CoachReminderDeliveries SET InvitationId=@invitationId
                            WHERE GameId=@GameId AND TeamId=@TeamId AND Email=@Email AND ReminderType=@ReminderType;",
                            new { candidate.GameId, candidate.TeamId, candidate.Email, candidate.ReminderType, invitationId });
                        var link = candidate.HasTeamAccess
                            ? $"{baseUrl}/teams/{candidate.TeamId}/games/{candidate.GameId}"
                            : invite.ReusedPendingInvitation ? $"{baseUrl}/login" : $"{baseUrl}/accept#token={invite.Token}";
                        var message = candidate.InvitationOnly
                            ? CoachInvitationEmail.Create(invite, link)
                            : CoachInvitationEmail.CreateReminder(invite, link, candidate.ReminderType,
                                candidate.HasTeamAccess, utcNow + elapsed.Elapsed);
                        var stillEligible = await conn.ExecuteScalarAsync<int>($@"
                            SELECT COUNT(*) FROM dbo.Games g JOIN dbo.Teams t ON t.Id IN(g.HomeTeamId,g.AwayTeamId)
                            CROSS APPLY ({Contacts}) c
                            WHERE g.GameId=@GameId AND t.Id=@TeamId AND c.Email=@Email
                                AND {ManagedGame} AND {EligibleGame} AND {AllowedAccount}
                                AND g.GameDateTime=@GameDateTime;", candidate);
                        var invitationValid = invitationId == null || await conn.ExecuteScalarAsync<int>(@"
                            SELECT COUNT(*) FROM dbo.CoachInvitations WHERE InvitationId=@invitationId AND Status='Pending'
                                AND ExpiresAtUtc > SYSUTCDATETIME() AND FailedAttempts < 5;", new { invitationId }) == 1;
                        settings = await _automation.GetAsync();
                        var automationEnabled = candidate.InvitationOnly ? settings.AutomaticInvitations
                            : candidate.ReminderType == "RosterReview" ? settings.RosterReminders : settings.LineupReminders;
                        if (stillEligible == 0 || !invitationValid || !automationEnabled || _config.GetValue<bool?>("CoachReminders:Enabled") == false
                            || !IsDue(candidate, utcNow + elapsed.Elapsed))
                        {
                            // A newly generated link was never sent. Do not leave it masquerading as an original email.
                            await conn.ExecuteAsync(@"
                                DELETE FROM dbo.CoachInvitations WHERE InvitationId=@unsentInvitation
                                    AND Status='Pending' AND CreatedByUserId IS NULL;
                                DELETE FROM dbo.CoachReminderDeliveries
                                    WHERE GameId=@GameId AND TeamId=@TeamId AND Email=@Email AND ReminderType=@ReminderType;",
                                new { candidate.GameId, candidate.TeamId, candidate.Email, candidate.ReminderType,
                                    unsentInvitation = !candidate.HasTeamAccess && !invite.ReusedPendingInvitation ? invitationId : null });
                            continue;
                        }
                        // SMTP has no exactly-once protocol. Once attempted, uncertain outcomes require operator review.
                        var deliveredStage = CoachReminderSchedule.DueType(candidate.GameDateTime, utcNow + elapsed.Elapsed);
                        await _email.SendAsync(message);
                        await conn.ExecuteAsync(@"
                            UPDATE dbo.CoachReminderDeliveries SET Status='Sent',SentAtUtc=SYSUTCDATETIME(),InvitationId=@invitationId
                            WHERE GameId=@GameId AND TeamId=@TeamId AND Email=@Email AND ReminderType=@ReminderType;
                            IF @InvitationOnly=1
                                INSERT INTO dbo.CoachReminderDeliveries(GameId,TeamId,Email,ReminderType,Status,SentAtUtc,InvitationId)
                                SELECT @GameId,@TeamId,@Email,@stage,'Sent',SYSUTCDATETIME(),@invitationId
                                WHERE NOT EXISTS (SELECT 1 FROM dbo.CoachReminderDeliveries
                                    WHERE GameId=@GameId AND TeamId=@TeamId AND Email=@Email AND ReminderType=@stage);",
                            new { candidate.GameId, candidate.TeamId, candidate.Email, candidate.ReminderType,
                                invitationId, candidate.InvitationOnly,
                                stage = deliveredStage ?? candidate.ReminderType });
                        sent++;

                    }
                    catch (Exception ex)
                    {
                        failures++;
                        _logger.LogError("Coach reminder needs review: game {GameId}, team {TeamId}, type {ReminderType}, failure {FailureType}.",
                            candidate.GameId, candidate.TeamId, candidate.ReminderType, ex.GetType().Name);
                        await conn.ExecuteAsync(@"
                            UPDATE dbo.CoachReminderDeliveries SET Status='NeedsReview'
                            WHERE GameId=@GameId AND TeamId=@TeamId AND Email=@Email AND ReminderType=@ReminderType;", candidate);
                    }
                }
            }
            finally
            {
                await conn.ExecuteAsync("EXEC sys.sp_releaseapplock @Resource='tipin-coach-reminder-dispatch',@LockOwner='Session';");
            }
            if (failures > 0) throw new InvalidOperationException($"{failures} coach reminder deliveries require operator review. See CoachReminderDeliveries and application logs.");
            _logger.LogInformation("Coach reminders sent: {SentCount}.", sent);
            return sent;
        }

        private static bool IsDue(CoachReminderCandidate candidate, DateTime utcNow)
        {
            var type = CoachReminderSchedule.DueType(candidate.GameDateTime, utcNow);
            return type != null && (candidate.InvitationOnly || candidate.ReminderType == type);
        }
    }
}
