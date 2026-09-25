$ErrorActionPreference = 'Stop'
$settingsRaw = Get-Content 'c:\TipIn\api\TipInAPI\local.settings.json' -Raw
$match = [regex]::Match($settingsRaw, '"DefaultConnection"\s*:\s*"([^"]+)"')
$connString = $match.Groups[1].Value
$conn = New-Object System.Data.SqlClient.SqlConnection($connString)
try {
  $conn.Open()
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = @"
SELECT s.name AS SchemaName, t.name AS TableName,
       COL_LENGTH(QUOTENAME(s.name)+'.'+QUOTENAME(t.name),'TeamType') AS TeamTypeLen,
       COL_LENGTH(QUOTENAME(s.name)+'.'+QUOTENAME(t.name),'TeamMascot') AS TeamMascotLen
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE t.name = 'Teams';
"@
  $r = $cmd.ExecuteReader()
  while($r.Read()) {
    Write-Output ("{0}.{1} TeamTypeLen={2} TeamMascotLen={3}" -f $r['SchemaName'],$r['TableName'],$r['TeamTypeLen'],$r['TeamMascotLen'])
  }
  $r.Close()

  $cmd2 = $conn.CreateCommand()
  $cmd2.CommandText = "SELECT TOP 1 t.Id, t.TeamType, t.TeamMascot FROM Teams t;"
  $r2 = $cmd2.ExecuteReader()
  if($r2.Read()) { Write-Output ("Unqualified Teams SELECT OK. SampleId={0}" -f $r2['Id']) }
  $r2.Close()
} finally { if ($conn.State -ne [System.Data.ConnectionState]::Closed) { $conn.Close() } }
