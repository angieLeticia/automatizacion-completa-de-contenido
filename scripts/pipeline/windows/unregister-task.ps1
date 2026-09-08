# Elimina UNICAMENTE la Tarea Programada del agente de PRODUCCION, creada por
# register-task.ps1. No toca la tarea del agente de publicacion
# (VisteapyAgentPublicacion), ni state/, ni queue.json, ni agent.lock, ni
# logs, ni ningun archivo de produccion - solo desregistra la tarea de
# Windows. Seguro de correr mas de una vez.
#
# IMPORTANTE: mantener este archivo en ASCII puro (ver nota en start-agent.ps1).
$ErrorActionPreference = "Stop"

$TaskName = "VisteapyAgentProduccion"
$TaskPath = "\Visteapy\"

$existing = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Host "No existe la tarea '$TaskPath$TaskName' - nada que eliminar."
    exit 0
}

Stop-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Confirm:$false

Write-Host "Tarea '$TaskPath$TaskName' eliminada."
Write-Host "Si el agente seguia corriendo, deberia haberse detenido con la tarea."
Write-Host "Si por alguna razon sigue corriendo, buscalo en el Administrador de tareas (proceso 'node.exe' o 'tsx.cmd') y termina el proceso manualmente."
Write-Host ""
Write-Host "Esto NO borro scripts/pipeline/state/ ni logs/ - el estado del agente sigue intacto."
