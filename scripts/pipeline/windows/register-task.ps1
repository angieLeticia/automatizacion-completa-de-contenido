# Registra la Tarea Programada de Windows que arranca el agente de
# PRODUCCION (Fase 2-3.1, scripts/pipeline/agent.mts) al iniciar sesion.
# Ejecutar UNA VEZ. No requiere permisos de Administrador en la mayoria de
# configuraciones (se registra para el usuario actual).
#
# Independiente por completo del agente de PUBLICACION (agent/windows/*.ps1,
# tarea "VisteapyAgentPublicacion") - nombre de tarea distinto, script
# distinto, no se tocan ni se comparten entre si.
#
# IMPORTANTE: mantener este archivo en ASCII puro (ver nota en start-agent.ps1).
$ErrorActionPreference = "Stop"

# Este script vive en scripts\pipeline\windows\ - tres niveles bajo la raiz
# del repo (a diferencia de agent\windows\, que son solo dos). Subir la
# cantidad equivocada de niveles apuntaria el directorio de trabajo a
# scripts\ en vez de la raiz real, asi que se calcula con cuidado.
$RepoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$WrapperScript = Join-Path $RepoRoot "scripts\pipeline\windows\start-agent.ps1"
$TaskName = "VisteapyAgentProduccion"
$TaskPath = "\Visteapy\"

$Action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$WrapperScript`""

$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Mismo patron ya probado y en uso ahora mismo en esta maquina para el agente
# de publicacion (RestartCount/RestartInterval/MultipleInstances) - esa tarea
# ya demuestra que estas propiedades son validas en esta version de Windows/
# PowerShell, no hace falta redescubrirlo.
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Days 0) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath `
    -Action $Action -Trigger $Trigger -Settings $Settings `
    -Description "Agente de produccion audiovisual (Fase 2-3.1) para D:\MATERIAL VIDEOS. Independiente del agente de publicacion." `
    -Force

Write-Host "Tarea '$TaskPath$TaskName' registrada."
Write-Host "Se ejecutara automaticamente la proxima vez que inicies sesion en Windows."
Write-Host ""
Write-Host "Para probarla AHORA sin reiniciar el PC:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName' -TaskPath '$TaskPath'"
