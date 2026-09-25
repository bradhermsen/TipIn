namespace TipInAPI.Infrastructure.Configuration
{
    public static class RoleConstants
    {
        // System-wide roles
        public const string SuperAdmin = "SuperAdmin";
        public const string OrgAdmin = "OrgAdmin";
        
        // Organization management
        public const string TeamManager = "TeamManager";
        
        // Coaching & gameplay
        public const string Coach = "Coach";
        
        // Read-only access
        public const string Viewer = "Viewer";

        // Get all valid roles
        public static readonly string[] AllRoles = new[]
        {
            SuperAdmin,
            OrgAdmin,
            TeamManager,
            Coach,
            Viewer
        };
    }
}
