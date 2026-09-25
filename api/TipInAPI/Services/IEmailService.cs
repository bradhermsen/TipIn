using System.Collections.Generic;
using System.Threading.Tasks;

namespace TipInAPI.Services
{
    public class EmailServerSettings
    {
        public bool Enabled { get; set; }
        public string SmtpHost { get; set; } = "localhost";
        public int SmtpPort { get; set; } = 1025;
        public bool UseSsl { get; set; }
        public string? Username { get; set; }
        public string? Password { get; set; }
        public string FromAddress { get; set; } = "no-reply@tipinscoring.local";
        public string FromName { get; set; } = "TipIn Scoring";
        public bool HasPassword => !string.IsNullOrWhiteSpace(Password);
    }

    public class EmailSendRequest
    {
        public List<string> To { get; set; } = new List<string>();
        public string Subject { get; set; } = string.Empty;
        public string BodyText { get; set; } = string.Empty;
        public List<EmailAttachment> Attachments { get; set; } = new List<EmailAttachment>();
    }

    public class MediaOutletRecipient
    {
        public string Name { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
    }

    public class EmailAttachment
    {
        public string FileName { get; set; } = "attachment.bin";
        public string ContentType { get; set; } = "application/octet-stream";
        public byte[] Content { get; set; } = System.Array.Empty<byte>();
    }

    public interface IEmailService
    {
        Task<EmailServerSettings> GetSettingsAsync(bool includeSecret = false);
        Task<EmailServerSettings> SaveSettingsAsync(EmailServerSettings settings);
        Task<IReadOnlyList<MediaOutletRecipient>> GetMediaOutletsAsync();
        Task<IReadOnlyList<MediaOutletRecipient>> SaveMediaOutletsAsync(IEnumerable<MediaOutletRecipient> outlets);
        Task SendAsync(EmailSendRequest request);
    }
}