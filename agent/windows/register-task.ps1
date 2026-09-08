# Registra la Tarea Programada de Windows que arranca el watcher de la Fase 2 al
# iniciar sesion. Ejecutar UNA VEZ. No requiere permisos de Administrador en la
# mayoria de configuraciones (se registra para el usuario actual).
#
# IMPORTANTE: mantener este archivo en ASCII puro (ver nota en start-agent.ps1).
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$WrapperScript = Join-Path $RepoRoot "agent\windows\start-agent.ps1"
$TaskName = "VisteapyAgentPublicacion"
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
    -Description "Agente de deteccion/registro de contenido (Fase 2) para D:\MATERIAL VIDEOS. No publica nada todavia." `
    -Force

Write-Host "Tarea '$TaskPath$TaskName' registrada."
Write-Host "Se ejecutara automaticamente la proxima vez que inicies sesion en Windows."
Write-Host ""
Write-Host "Para probarla AHORA sin reiniciar el PC:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName' -TaskPath '$TaskPath'"
