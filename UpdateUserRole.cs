using System;
using System.Data.SqlClient;
using Dapper;

class Program
{
    static void Main(string[] args)
    {
        const string connectionString = "Server=TipIn-sql.database.windows.net;Database=TipInDB;User Id=sa;Password=P@ssw0rd123!;Encrypt=true;TrustServerCertificate=false;Connection Timeout=30;";
        
        try
        {
            using (SqlConnection connection = new SqlConnection(connectionString))
            {
                connection.Open();
                Console.WriteLine("✅ Connected to database");

                // Update the role
                const string updateQuery = "UPDATE AuthUsers SET Role = @Role WHERE Email = @Email";
                int rowsAffected = connection.Execute(updateQuery, new 
                { 
                    Role = "SuperAdmin",
                    Email = "hermiehockey@outlook.com"
                });
                Console.WriteLine($"✅ Updated {rowsAffected} row(s)");

                // Verify the update
                const string selectQuery = "SELECT Id, Email, Role, IsActive FROM AuthUsers WHERE Email = @Email";
                dynamic user = connection.QueryFirstOrDefault(selectQuery, new { Email = "hermiehockey@outlook.com" });
                
                if (user != null)
                {
                    Console.WriteLine($"\n✅ User Updated Successfully:");
                    Console.WriteLine($"   Id: {user.Id}");
                    Console.WriteLine($"   Email: {user.Email}");
                    Console.WriteLine($"   Role: {user.Role}");
                    Console.WriteLine($"   IsActive: {user.IsActive}");
                }
                else
                {
                    Console.WriteLine("⚠️ User not found");
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"❌ Error: {ex.Message}");
            Environment.Exit(1);
        }
    }
}
