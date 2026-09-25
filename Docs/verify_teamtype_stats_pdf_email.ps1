$ErrorActionPreference = 'Stop'
$base = 'http://localhost:7071/api'

$loginBody = @{ email='hermiehockey@outlook.com'; password='TipIn2024!' } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body $loginBody
$token = $login.token
$headers = @{ Authorization = "Bearer $token" }

$orgs = Invoke-RestMethod -Method Get -Uri "$base/organizations" -Headers $headers
$levels = Invoke-RestMethod -Method Get -Uri "$base/levels" -Headers $headers
$seasons = Invoke-RestMethod -Method Get -Uri "$base/seasons" -Headers $headers
$teams = Invoke-RestMethod -Method Get -Uri "$base/teams" -Headers $headers
$games = Invoke-RestMethod -Method Get -Uri "$base/games" -Headers $headers

$activeSeason = $seasons | Where-Object { $_.isActive -eq $true } | Select-Object -First 1
if (-not $activeSeason) { $activeSeason = $seasons | Select-Object -First 1 }
$level = $levels | Select-Object -First 1

$orgWithMascot = $orgs | Where-Object { $_.mascot -and $_.mascot.Trim().Length -gt 0 } | Select-Object -First 1
if (-not $orgWithMascot) { throw 'No organization with mascot found for inheritance test.' }

$internalTeam = $teams | Where-Object { $_.organizationId -eq $orgWithMascot.organizationId -and -not $_.isExternal } | Select-Object -First 1
if (-not $internalTeam) { throw 'No internal team found for update inheritance test.' }
$internalDetail = Invoke-RestMethod -Method Get -Uri "$base/teams/$($internalTeam.teamId)" -Headers $headers

$updatePayload = @{
  organizationId = $internalDetail.organizationId
  conferenceDistrictId = $internalDetail.conferenceDistrictId
  sectionRegionId = $internalDetail.sectionRegionId
  levelId = $internalDetail.levelId
  seasonId = $internalDetail.seasonId
  name = $internalDetail.name
  gender = $internalDetail.gender
  abbreviation = $internalDetail.abbreviation
  teamType = ($(if($internalDetail.teamType){$internalDetail.teamType}else{'Co-Ed'}))
  teamMascot = $null
  headCoachName = $internalDetail.headCoachName
  assistantCoach1Name = $internalDetail.assistantCoach1Name
  assistantCoach2Name = $internalDetail.assistantCoach2Name
  assistantCoach3Name = $internalDetail.assistantCoach3Name
  assistantCoach4Name = $internalDetail.assistantCoach4Name
  headCoachEmail = $internalDetail.headCoachEmail
  assistantCoach1Email = $internalDetail.assistantCoach1Email
  assistantCoach2Email = $internalDetail.assistantCoach2Email
  assistantCoach3Email = $internalDetail.assistantCoach3Email
  assistantCoach4Email = $internalDetail.assistantCoach4Email
  assistantCoach1HasLogin = [bool]$internalDetail.assistantCoach1HasLogin
  assistantCoach2HasLogin = [bool]$internalDetail.assistantCoach2HasLogin
  assistantCoach3HasLogin = [bool]$internalDetail.assistantCoach3HasLogin
  assistantCoach4HasLogin = [bool]$internalDetail.assistantCoach4HasLogin
  notes = $internalDetail.notes
  gameManagerCode = $internalDetail.gameManagerCode
  statManagerCode = $internalDetail.statManagerCode
  isExternal = $false
  isActive = [bool]$internalDetail.isActive
}
$null = Invoke-RestMethod -Method Put -Uri "$base/teams/$($internalTeam.teamId)" -Headers $headers -ContentType 'application/json' -Body ($updatePayload | ConvertTo-Json -Depth 8)
$updatedDetail = Invoke-RestMethod -Method Get -Uri "$base/teams/$($internalTeam.teamId)" -Headers $headers

$invalidTypePayload = @{
  organizationId = $orgWithMascot.organizationId
  levelId = $level.levelId
  seasonId = $activeSeason.seasonId
  name = "ZZ InvalidType Test"
  abbreviation = "ZZ-INV-$((Get-Random -Minimum 1000 -Maximum 9999))"
  teamType = 'InvalidType'
  teamMascot = 'MascotX'
  isExternal = $false
  isActive = $true
}
$invalidTypeStatus = $null
$invalidTypeError = $null
try {
  $resp = Invoke-WebRequest -Method Post -Uri "$base/teams" -Headers $headers -ContentType 'application/json' -Body ($invalidTypePayload | ConvertTo-Json -Depth 5)
  $invalidTypeStatus = [int]$resp.StatusCode
  if ($invalidTypeStatus -ge 400) { $invalidTypeError = $resp.Content }
} catch {
  $invalidTypeStatus = [int]$_.Exception.Response.StatusCode
  $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
  $invalidTypeError = $sr.ReadToEnd()
}

$externalNoMascotPayload = @{
  organizationId = $null
  levelId = $level.levelId
  seasonId = $activeSeason.seasonId
  name = "ZZ External NoMascot"
  abbreviation = "ZZ-EXT-$((Get-Random -Minimum 1000 -Maximum 9999))"
  teamType = 'Boys'
  teamMascot = $null
  isExternal = $true
  isActive = $true
}
$externalNoMascotStatus = $null
$externalNoMascotError = $null
try {
  $resp = Invoke-WebRequest -Method Post -Uri "$base/teams" -Headers $headers -ContentType 'application/json' -Body ($externalNoMascotPayload | ConvertTo-Json -Depth 5)
  $externalNoMascotStatus = [int]$resp.StatusCode
  if ($externalNoMascotStatus -ge 400) { $externalNoMascotError = $resp.Content }
} catch {
  $externalNoMascotStatus = [int]$_.Exception.Response.StatusCode
  $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
  $externalNoMascotError = $sr.ReadToEnd()
}

$allTeamTypes = @($teams | ForEach-Object { $_.teamType } | Where-Object { $_ } | Sort-Object -Unique)
if ($allTeamTypes.Count -eq 0) { throw 'No team types found in team data for stats filter test.' }
$filterType = $allTeamTypes[0]
$statsFiltered = Invoke-RestMethod -Method Get -Uri "$base/stats/team?teamType=$([uri]::EscapeDataString($filterType))" -Headers $headers
$statsMismatch = @($statsFiltered | Where-Object { $_.teamType -ne $filterType }).Count

$finalGame = $games | Where-Object { @('Final','Completed','Closed') -contains $_.status } | Select-Object -First 1
if (-not $finalGame) { throw 'No final/completed game found for summary PDF/email check.' }
$pdfPath = 'c:\TipIn\Docs\verify-summary.pdf'
Invoke-WebRequest -Uri "$base/games/$($finalGame.gameId)/summary-pdf" -Headers $headers -OutFile $pdfPath

$emailSettingsPayload = @{
  smtpHost = 'localhost'
  smtpPort = 1025
  smtpUsername = ''
  smtpPassword = ''
  fromAddress = 'no-reply@TipIn.local'
  fromName = 'TipIn'
  useSsl = $false
  enabled = $true
}
$null = Invoke-RestMethod -Method Put -Uri "$base/email/settings" -Headers $headers -ContentType 'application/json' -Body ($emailSettingsPayload | ConvertTo-Json)

$completePayload = @{
  notes = 'Live verification pass for teamType/mascot formatting.'
  emailDispatch = @{
    to = @('qa@TipIn.local')
    subject = 'TipIn Game Finalized - Verification Pass'
  }
}
$completeResult = Invoke-RestMethod -Method Post -Uri "$base/games/$($finalGame.gameId)/complete" -ContentType 'application/json' -Body ($completePayload | ConvertTo-Json -Depth 6)

$mailhog = Invoke-RestMethod -Method Get -Uri 'http://localhost:8025/api/v2/messages?limit=20'
$mhItem = $mailhog.items | Where-Object { $_.Content.Headers.Subject -contains 'TipIn Game Finalized - Verification Pass' } | Select-Object -First 1

$result = [ordered]@{
  updateInternalInheritance = [ordered]@{
    teamId = $internalTeam.teamId
    orgMascot = $orgWithMascot.mascot
    returnedTeamMascot = $updatedDetail.teamMascot
    pass = (($updatedDetail.teamMascot -eq $orgWithMascot.mascot) -or ([string]::IsNullOrWhiteSpace($updatedDetail.teamMascot) -and [string]::IsNullOrWhiteSpace($orgWithMascot.mascot)))
  }
  createInvalidType = [ordered]@{
    status = $invalidTypeStatus
    pass = ($invalidTypeStatus -eq 400)
    response = $invalidTypeError
  }
  createExternalWithoutMascot = [ordered]@{
    status = $externalNoMascotStatus
    pass = ($externalNoMascotStatus -eq 400)
    response = $externalNoMascotError
  }
  statsTypeFilter = [ordered]@{
    requestedType = $filterType
    rows = @($statsFiltered).Count
    mismatchedRows = $statsMismatch
    pass = ($statsMismatch -eq 0)
  }
  pdfCheck = [ordered]@{
    gameId = $finalGame.gameId
    status = $finalGame.status
    pdfPath = $pdfPath
  }
  emailCheck = [ordered]@{
    completeEndpoint = $completeResult
    mailhogFound = [bool]$mhItem
    mailhogSubject = $(if($mhItem){($mhItem.Content.Headers.Subject | Select-Object -First 1)}else{$null})
    mailhogBodySnippet = $(if($mhItem){$mhItem.Content.Body.Substring(0, [Math]::Min(300, $mhItem.Content.Body.Length))}else{$null})
  }
}

$result | ConvertTo-Json -Depth 12 | Set-Content -Path 'c:\TipIn\Docs\verify_live_results.json' -Encoding utf8
Write-Output 'WROTE:c:\TipIn\Docs\verify_live_results.json'
Write-Output 'WROTE:c:\TipIn\Docs\verify-summary.pdf'
