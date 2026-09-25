using System;

namespace TipInAPI.Services
{
    public interface IAccessCodeValidator
    {
        bool ValidateAccessCode(string providedCode, string? storedCode, DateTime? expiresAt, DateTime gameDateTime);
        ValidationResult GetValidationResult(string providedCode, string? storedCode, DateTime? expiresAt, DateTime gameDateTime);
    }

    public class ValidationResult
    {
        public bool IsValid { get; set; }
        public string Message { get; set; }
    }

    public class AccessCodeValidator : IAccessCodeValidator
    {
        private readonly IAccessCodeService _accessCodeService;

        public AccessCodeValidator(IAccessCodeService accessCodeService)
        {
            _accessCodeService = accessCodeService;
        }

        /// <summary>
        /// Validate an access code against stored code with expiration and game day checks.
        /// </summary>
        public bool ValidateAccessCode(string providedCode, string? storedCode, DateTime? expiresAt, DateTime gameDateTime)
        {
            var result = GetValidationResult(providedCode, storedCode, expiresAt, gameDateTime);
            return result.IsValid;
        }

        /// <summary>
        /// Get detailed validation result explaining why code is invalid.
        /// </summary>
        public ValidationResult GetValidationResult(string providedCode, string? storedCode, DateTime? expiresAt, DateTime gameDateTime)
        {
            // Check if code exists
            if (string.IsNullOrEmpty(storedCode))
                return new ValidationResult { IsValid = false, Message = "No access code configured for this team" };

            // Check if provided code matches stored code
            if (!providedCode.Equals(storedCode, StringComparison.OrdinalIgnoreCase))
                return new ValidationResult { IsValid = false, Message = "Invalid access code" };

            // Check if code has expired (if expiration is set)
            if (_accessCodeService.IsCodeExpired(expiresAt))
                return new ValidationResult { IsValid = false, Message = "Access code has expired" };

            // Check if it's game day (valid from 12:01 AM game day)
            if (!_accessCodeService.IsValidGameDay(gameDateTime))
                return new ValidationResult { IsValid = false, Message = "Access code is not valid for today" };

            return new ValidationResult { IsValid = true, Message = "Access code is valid" };
        }
    }
}
