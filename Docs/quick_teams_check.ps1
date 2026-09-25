$base='http://localhost:7071/api'
$login=Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{email='hermiehockey@outlook.com';password='TipIn2024!'}|ConvertTo-Json)
$h=@{Authorization="Bearer $($login.token)"}
try {
  $t=Invoke-RestMethod -Method Get -Uri "$base/teams" -Headers $h
  Write-Output "TeamsCount=$(@($t).Count)"
} catch {
  Write-Output $_.Exception.Message
}
