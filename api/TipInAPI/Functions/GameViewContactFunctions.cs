using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Mail;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using TipInAPI.Services;

namespace TipInAPI.Functions
{
    public class GameViewContactFunctions
    {
        private const string ContactEmail = "info@tipinscoring.com";
        private readonly IEmailService _emailService;
        private readonly ILogger<GameViewContactFunctions> _logger;

        public GameViewContactFunctions(IEmailService emailService, ILogger<GameViewContactFunctions> logger)
        {
            _emailService = emailService;
            _logger = logger;
        }

        [Function("SubmitGameViewContact")]
        public async Task<HttpResponseData> SubmitGameViewContact(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "public/gameview/contact")] HttpRequestData req)
        {
            var payload = await req.ReadFromJsonAsync<ContactRequest>();
            var validationError = Validate(payload);
            if (validationError != null)
            {
                var badRequest = req.CreateResponse(HttpStatusCode.BadRequest);
                await badRequest.WriteAsJsonAsync(new { error = validationError });
                return badRequest;
            }

            if (!string.IsNullOrWhiteSpace(payload!.Website))
            {
                var accepted = req.CreateResponse(HttpStatusCode.OK);
                await accepted.WriteAsJsonAsync(new { message = "Thanks. Your message was sent." });
                return accepted;
            }

            try
            {
                await _emailService.SendAsync(new EmailSendRequest
                {
                    To = new List<string> { ContactEmail },
                    Subject = "TipIn Game View contact form",
                    BodyText = $@"New Game View contact message

Name: {payload.Name.Trim()}
Email: {payload.Email.Trim()}
Subject: {payload.Subject.Trim()}

Message:
{payload.Message.Trim()}
"
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Game View contact email could not be sent");
                var unavailable = req.CreateResponse(HttpStatusCode.ServiceUnavailable);
                await unavailable.WriteAsJsonAsync(new { error = "Your message could not be sent right now. Please email info@tipinscoring.com directly." });
                return unavailable;
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new { message = "Thanks. Your message was sent." });
            return response;
        }

        private static string? Validate(ContactRequest? payload)
        {
            if (payload == null) return "Contact details are required.";
            if (string.IsNullOrWhiteSpace(payload.Name)) return "Your name is required.";
            if (string.IsNullOrWhiteSpace(payload.Email)) return "Your email is required.";
            if (string.IsNullOrWhiteSpace(payload.Subject)) return "A subject is required.";
            if (string.IsNullOrWhiteSpace(payload.Message)) return "A message is required.";
            if (payload.Name.Trim().Length > 160 || payload.Subject.Trim().Length > 160 || payload.Message.Trim().Length > 3000)
                return "One or more fields are too long.";
            try { _ = new MailAddress(payload.Email.Trim()); }
            catch (FormatException) { return "Enter a valid email address."; }
            return null;
        }

        private sealed class ContactRequest
        {
            public string Name { get; set; } = string.Empty;
            public string Email { get; set; } = string.Empty;
            public string Subject { get; set; } = string.Empty;
            public string Message { get; set; } = string.Empty;
            public string? Website { get; set; }
        }
    }
}