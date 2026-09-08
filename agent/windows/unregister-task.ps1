# Elimina la Tarea Programada creada por register-task.ps1.
# IMPORTANTE: mantener este archivo en ASCII puro (ver nota en start-agent.ps1).
$ErrorActionPreference = "Stop"

$TaskName = "VisteapyAgentPublicacion"
$TaskPath = "\Visteapy\"

$existing = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Host "No existe la tarea '$TaskPath$TaskName' - nada que eliminar."
    exit 0
}

Stop-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Confirm:$false

Write-Host "Tarea '$TaskPath$TaskName' eliminada."
Write-Host "Si el watcher seguia corriendo, deberia haberse detenido con la tarea."
Write-Host "Si por alguna razon sigue corriendo, buscalo en el Administrador de tareas (proceso 'node.exe' o 'tsx.cmd') y termina el proceso manualmente."
