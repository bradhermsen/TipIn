$ErrorActionPreference = 'Stop'
$settingsRaw = Get-Content 'c:\TipIn\api\TipInAPI\local.settings.json' -Raw
$match = [regex]::Match($settingsRaw, '"DefaultConnection"\s*:\s*"([^"]+)"')
if (-not $match.Success) {
    throw 'Could not locate DefaultConnection in local.settings.json'
}
$connString = $match.Groups[1].Value
$sql = Get-Content 'c:\TipIn\Docs\apply_teamtype_migration.sql' -Raw

$conn = New-Object System.Data.SqlClient.SqlConnection($connString)
try {
    $conn.Open()
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    $cmd.CommandTimeout = 120
    $null = $cmd.ExecuteNonQuery()
    Write-Output 'Migration SQL applied successfully.'
} finally {
    if ($conn.State -ne [System.Data.ConnectionState]::Closed) {
        $conn.Close()
    }
}
