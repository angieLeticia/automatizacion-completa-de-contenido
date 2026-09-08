# Wrapper que la Tarea Programada de Windows ejecuta al iniciar sesion.
# Mantiene vivo el agente de PRODUCCION (scripts/pipeline/agent.mts): si el
# proceso se cierra por cualquier motivo, espera unos segundos y lo vuelve a
# lanzar, indefinidamente. No toca publicacion/Remotion/ElevenLabs/Whisper -
# solo relanza el mismo agente ya probado en Fase 2/3/3.1.
#
# IMPORTANTE: este archivo debe mantenerse en ASCII puro (sin tildes, enes ni
# guiones largos) porque Windows PowerShell 5.1 puede romper el parseo de un
# .ps1 con caracteres no-ASCII si no tiene BOM UTF-8.
$ErrorActionPreference = "Stop"

# Tres niveles bajo la raiz (scripts\pipeline\windows\), no dos - ver nota en
# register-task.ps1. No depende del directorio actual de PowerShell al
# arrancar (Task Scheduler no garantiza ninguno en particular).
$RepoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
Set-Location $RepoRoot

# logs\ es la misma carpeta que ya usa scripts/pipeline/logger.mts (logs
# diarios pipeline-YYYY-MM-DD.log) - el wrapper usa un nombre de archivo
# distinto ahi mismo, no un sistema de logging nuevo.
$LogDir = Join-Path $RepoRoot "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$WrapperLog = Join-Path $LogDir "pipeline-task-wrapper.log"

function Write-WrapperLog {
    param([string]$Message)
    $line = "[$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')] $Message"
    Add-Content -Path $WrapperLog -Value $line
}

Write-WrapperLog "Tarea Programada iniciada - arrancando el agente de produccion (scripts/pipeline/agent.mts)."

$TsxBin = Join-Path $RepoRoot "node_modules\.bin\tsx.cmd"
if (-not (Test-Path $TsxBin)) {
    Write-WrapperLog "ERROR FATAL: no se encontro $TsxBin - falta correr 'npm install' en el repo. Se detiene el wrapper."
    exit 1
}

# Salida estandar del propio agente (progreso de processProject: whisper,
# render frame a frame, etc.) - sin esto, Start-Process la descarta y solo
# quedarian visibles los eventos [AGENT]/[QUEUE]/[WORKER] que logger.mts ya
# escribe a disco por su cuenta. No es un sistema de logging nuevo, es evitar
# perder la salida que el agente ya produce.
$StdOutLog = Join-Path $LogDir "pipeline-agent-stdout.log"
$StdErrLog = Join-Path $LogDir "pipeline-agent-stderr.log"

while ($true) {
    Write-WrapperLog "Lanzando: tsx scripts/pipeline/agent.mts"
    $process = Start-Process -FilePath $TsxBin -ArgumentList "scripts/pipeline/agent.mts" `
        -WorkingDirectory $RepoRoot -NoNewWindow -PassThru -Wait `
        -RedirectStandardOutput $StdOutLog -RedirectStandardError $StdErrLog
    Write-WrapperLog "El agente se cerro (codigo de salida $($process.ExitCode)) - reiniciando en 5 segundos..."
    Start-Sleep -Seconds 5
}
