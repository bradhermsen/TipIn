namespace TipInAPI.DTOs
{
    public class CreateOfficialDto
    {
        public string FirstName { get; set; } = string.Empty;
        public string LastName { get; set; } = string.Empty;
        public string? Email { get; set; }
        public string? Role { get; set; }
        public bool IsActive { get; set; } = true;
    }
}