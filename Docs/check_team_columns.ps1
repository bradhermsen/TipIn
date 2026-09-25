$ErrorActionPreference = 'Stop'
$settingsRaw = Get-Content 'c:\TipIn\api\TipInAPI\local.settings.json' -Raw
$match = [regex]::Match($settingsRaw, '"DefaultConnection"\s*:\s*"([^"]+)"')
$connString = $match.Groups[1].Value
$conn = New-Object System.Data.SqlClient.SqlConnection($connString)
try {
  $conn.Open()
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = "SELECT DB_NAME() AS DbName, COL_LENGTH('dbo.Teams','TeamType') AS TeamTypeLen, COL_LENGTH('dbo.Teams','TeamMascot') AS TeamMascotLen;"
  $r = $cmd.ExecuteReader()
  while($r.Read()) {
    Write-Output ("DB={0}; TeamTypeLen={1}; TeamMascotLen={2}" -f $r['DbName'], $r['TeamTypeLen'], $r['TeamMascotLen'])
  }
  $r.Close()
} finally { if ($conn.State -ne [System.Data.ConnectionState]::Closed) { $conn.Close() } }
