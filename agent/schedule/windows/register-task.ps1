# Registra la Tarea Programada de Windows que arranca el agente de
# SCHEDULING (agent/schedule/run.mts) al iniciar sesion. Ejecutar UNA VEZ.
# Independiente por completo de las otras tareas del proyecto.
#
# IMPORTANTE: mantener este archivo en ASCII puro (ver nota en start-agent.ps1).
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$WrapperScript = Join-Path $RepoRoot "agent\schedule\windows\start-agent.ps1"
$TaskName = "VisteapyAgentSchedule"
$TaskPath = "\Visteapy\"

$Action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$WrapperScript`""

$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Days 0) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath `
    -Action $Action -Trigger $Trigger -Settings $Settings `
    -Description "Agente de scheduling (content_metadata ready -> social_posts) - Fase 5.6. Pasadas cada 5 min. Independiente de produccion/analisis/publicacion." `
    -Force

Write-Host "Tarea '$TaskPath$TaskName' registrada."
Write-Host "Se ejecutara automaticamente la proxima vez que inicies sesion en Windows."
Write-Host ""
Write-Host "Para probarla AHORA sin reiniciar el PC:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName' -TaskPath '$TaskPath'"
