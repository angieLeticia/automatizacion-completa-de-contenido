# Registra la Tarea Programada de Windows que arranca el agente de ANALISIS
# (agent/analyze/run.mts) al iniciar sesion. Ejecutar UNA VEZ.
#
# Independiente por completo de las otras tareas (VisteapyAgentProduccion,
# VisteapyAgentPublicacion) - nombre de tarea distinto, script distinto, no
# se tocan ni se comparten entre si.
#
# IMPORTANTE: mantener este archivo en ASCII puro (ver nota en start-agent.ps1).
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$WrapperScript = Join-Path $RepoRoot "agent\analyze\windows\start-agent.ps1"
$TaskName = "VisteapyAgentAnalyze"
$TaskPath = "\Visteapy\"

$Action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$WrapperScript`""

$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Mismo patron ya probado y en uso ahora mismo en esta maquina para las otras
# dos tareas (RestartCount/RestartInterval/MultipleInstances).
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Days 0) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath `
    -Action $Action -Trigger $Trigger -Settings $Settings `
    -Description "Agente de analisis (Whisper local + Ollama local) - Fase 5.6. Independiente de produccion/publicacion." `
    -Force

Write-Host "Tarea '$TaskPath$TaskName' registrada."
Write-Host "Se ejecutara automaticamente la proxima vez que inicies sesion en Windows."
Write-Host ""
Write-Host "Para probarla AHORA sin reiniciar el PC:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName' -TaskPath '$TaskPath'"
