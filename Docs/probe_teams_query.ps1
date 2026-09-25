$ErrorActionPreference='Stop'
$settingsRaw = Get-Content 'c:\TipIn\api\TipInAPI\local.settings.json' -Raw
$match = [regex]::Match($settingsRaw, '"DefaultConnection"\s*:\s*"([^"]+)"')
$connString = $match.Groups[1].Value
$conn = New-Object Microsoft.Data.SqlClient.SqlConnection($connString)
try {
  $conn.Open()
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = @"
SELECT TOP 5
  t.Id AS TeamId,
  t.OrganizationId,
  t.TeamType,
  COALESCE(NULLIF(t.TeamMascot, ''), o.Mascot) AS TeamMascot,
  t.Name
FROM Teams t
LEFT JOIN Organizations o ON t.OrganizationId = o.OrganizationId
ORDER BY t.Name;
"@
  $r=$cmd.ExecuteReader()
  while($r.Read()) { Write-Output ("{0} | {1} | {2}" -f $r['TeamId'],$r['TeamType'],$r['TeamMascot']) }
  $r.Close()
} finally { if($conn.State -ne 'Closed'){ $conn.Close() } }
