# Wrapper que la Tarea Programada de Windows ejecuta al iniciar sesion. Mantiene
# vivo el watcher de la Fase 2 (agent/run.mts): si el proceso se cierra por
# cualquier motivo, espera unos segundos y lo vuelve a lanzar, indefinidamente.
# No hace nada de publicacion/scheduler/Claude - solo relanza el mismo watcher
# probado manualmente en la Fase 2.
#
# IMPORTANTE: este archivo debe mantenerse en ASCII puro (sin tildes, enes ni
# guiones largos) porque Windows PowerShell 5.1 puede romper el parseo de un
# .ps1 con caracteres no-ASCII si no tiene BOM UTF-8.
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $RepoRoot

$LogDir = Join-Path $RepoRoot "agent\logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$WrapperLog = Join-Path $LogDir "task-wrapper.log"

function Write-WrapperLog {
    param([string]$Message)
    $line = "[$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')] $Message"
    Add-Content -Path $WrapperLog -Value $line
}

Write-WrapperLog "Tarea Programada iniciada - arrancando el watcher de la Fase 2 (solo deteccion/registro)."

$TsxBin = Join-Path $RepoRoot "node_modules\.bin\tsx.cmd"
if (-not (Test-Path $TsxBin)) {
    Write-WrapperLog "ERROR FATAL: no se encontro $TsxBin - falta correr 'npm install' en el repo. Se detiene el wrapper."
    exit 1
}

while ($true) {
    Write-WrapperLog "Lanzando: tsx agent/run.mts"
    $process = Start-Process -FilePath $TsxBin -ArgumentList "agent/run.mts" `
        -WorkingDirectory $RepoRoot -NoNewWindow -PassThru -Wait
    Write-WrapperLog "El watcher se cerro (codigo de salida $($process.ExitCode)) - reiniciando en 5 segundos..."
    Start-Sleep -Seconds 5
}
