param(
  [int]$OffsetMinutes = [int](-[System.TimeZoneInfo]::Local.GetUtcOffset((Get-Date)).TotalMinutes),
  [Nullable[datetime]]$FromDate = $null,
  [Nullable[datetime]]$ToDate = $null,
  [switch]$Apply,
  [int]$PreviewTop = 25
)

$ErrorActionPreference = 'Stop'

Write-Output 'WARNING: This script is not idempotent. Running with -Apply more than once will keep shifting times.'

$settingsPath = 'c:\TipIn\api\TipInAPI\local.settings.json'
$settingsRaw = Get-Content $settingsPath -Raw
$match = [regex]::Match($settingsRaw, '"DefaultConnection"\s*:\s*"([^"]+)"')
if (-not $match.Success) {
  throw 'Could not locate DefaultConnection in local.settings.json'
}

$connString = $match.Groups[1].Value
$conn = New-Object System.Data.SqlClient.SqlConnection($connString)

function ToSqlDateTimeValue([Nullable[datetime]]$value) {
  if ($null -eq $value) { return [DBNull]::Value }
  return $value.Value
}

try {
  $conn.Open()

  $previewSql = @"
SELECT TOP (@PreviewTop)
  g.GameId,
  g.GameDateTime AS CurrentGameDateTime,
  DATEADD(MINUTE, -@OffsetMinutes, g.GameDateTime) AS CorrectedGameDateTime,
  g.Status,
  g.CreatedAt,
  g.UpdatedAt
FROM Games g
WHERE (@FromDate IS NULL OR g.GameDateTime >= @FromDate)
  AND (@ToDate IS NULL OR g.GameDateTime < @ToDate)
ORDER BY g.GameDateTime ASC;
"@

  $previewCmd = $conn.CreateCommand()
  $previewCmd.CommandText = $previewSql
  $previewCmd.CommandTimeout = 120
  [void]$previewCmd.Parameters.Add('@PreviewTop', [System.Data.SqlDbType]::Int)
  [void]$previewCmd.Parameters.Add('@OffsetMinutes', [System.Data.SqlDbType]::Int)
  [void]$previewCmd.Parameters.Add('@FromDate', [System.Data.SqlDbType]::DateTime)
  [void]$previewCmd.Parameters.Add('@ToDate', [System.Data.SqlDbType]::DateTime)
  $previewCmd.Parameters['@PreviewTop'].Value = $PreviewTop
  $previewCmd.Parameters['@OffsetMinutes'].Value = $OffsetMinutes
  $previewCmd.Parameters['@FromDate'].Value = ToSqlDateTimeValue $FromDate
  $previewCmd.Parameters['@ToDate'].Value = ToSqlDateTimeValue $ToDate

  $reader = $previewCmd.ExecuteReader()
  Write-Output "Previewing up to $PreviewTop rows with offset $OffsetMinutes minute(s):"
  while ($reader.Read()) {
    Write-Output ("{0} | {1:yyyy-MM-dd HH:mm} -> {2:yyyy-MM-dd HH:mm} | {3}" -f $reader['GameId'], $reader['CurrentGameDateTime'], $reader['CorrectedGameDateTime'], $reader['Status'])
  }
  $reader.Close()

  $countSql = @"
SELECT COUNT(1)
FROM Games g
WHERE (@FromDate IS NULL OR g.GameDateTime >= @FromDate)
  AND (@ToDate IS NULL OR g.GameDateTime < @ToDate);
"@

  $countCmd = $conn.CreateCommand()
  $countCmd.CommandText = $countSql
  [void]$countCmd.Parameters.Add('@FromDate', [System.Data.SqlDbType]::DateTime)
  [void]$countCmd.Parameters.Add('@ToDate', [System.Data.SqlDbType]::DateTime)
  $countCmd.Parameters['@FromDate'].Value = ToSqlDateTimeValue $FromDate
  $countCmd.Parameters['@ToDate'].Value = ToSqlDateTimeValue $ToDate
  $targetCount = [int]$countCmd.ExecuteScalar()

  if (-not $Apply) {
    Write-Output "DRY RUN only. Rows in scope: $targetCount"
    Write-Output "Re-run with -Apply to persist updates."
    return
  }

  $updateSql = @"
UPDATE g
SET g.GameDateTime = DATEADD(MINUTE, -@OffsetMinutes, g.GameDateTime),
    g.UpdatedAt = SYSUTCDATETIME()
FROM Games g
WHERE (@FromDate IS NULL OR g.GameDateTime >= @FromDate)
  AND (@ToDate IS NULL OR g.GameDateTime < @ToDate);
"@

  $tx = $conn.BeginTransaction()
  try {
    $updateCmd = $conn.CreateCommand()
    $updateCmd.Transaction = $tx
    $updateCmd.CommandText = $updateSql
    $updateCmd.CommandTimeout = 120
    [void]$updateCmd.Parameters.Add('@OffsetMinutes', [System.Data.SqlDbType]::Int)
    [void]$updateCmd.Parameters.Add('@FromDate', [System.Data.SqlDbType]::DateTime)
    [void]$updateCmd.Parameters.Add('@ToDate', [System.Data.SqlDbType]::DateTime)
    $updateCmd.Parameters['@OffsetMinutes'].Value = $OffsetMinutes
    $updateCmd.Parameters['@FromDate'].Value = ToSqlDateTimeValue $FromDate
    $updateCmd.Parameters['@ToDate'].Value = ToSqlDateTimeValue $ToDate

    $updated = $updateCmd.ExecuteNonQuery()
    $tx.Commit()
    Write-Output "Updated rows: $updated"
  }
  catch {
    $tx.Rollback()
    throw
  }
}
finally {
  if ($conn.State -ne [System.Data.ConnectionState]::Closed) {
    $conn.Close()
  }
}
