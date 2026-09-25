using System;
using System.Collections.Generic;

namespace TipInAPI.DTOs
{
    public class UpdateUserDto
    {
        public string Email { get; set; } = "";
        public string FirstName { get; set; } = "";
        public string LastName { get; set; } = "";
        public Guid? OrganizationId { get; set; }
        public string Role { get; set; } = "";
        public bool IsActive { get; set; }
        public string? Password { get; set; }
        public List<Guid> TeamIds { get; set; } = new();
    }
}
