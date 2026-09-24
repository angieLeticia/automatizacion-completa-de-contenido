# Wrapper que la Tarea Programada de Windows ejecuta al iniciar sesion.
# Mantiene vivo el agente de ANALISIS (agent/analyze/run.mts, Fase 3): si el
# proceso se cierra por cualquier motivo, espera unos segundos y lo vuelve a
# lanzar, indefinidamente. Mismo patron EXACTO que
# scripts/pipeline/windows/start-agent.ps1 (Agent 2) - este script YA corre
# en bucle interno propio (findPendingWork + recoverStaleClaims cada
# POLL_INTERVAL_MS=30s, agent/analyze/run.mts), asi que el reinicio de 5s
# aqui es solo para el caso de crash, igual que en Agent 2.
#
# IMPORTANTE: este archivo debe mantenerse en ASCII puro (sin tildes, enes ni
# guiones largos) - ver nota identica en scripts/pipeline/windows/start-agent.ps1.
$ErrorActionPreference = "Stop"

# Tres niveles bajo la raiz (agent\analyze\windows\), igual que
# scripts\pipeline\windows\ - no depende del directorio actual de
# PowerShell al arrancar (Task Scheduler no garantiza ninguno en particular).
$RepoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
Set-Location $RepoRoot

# Fase 5.10-E - RUN_SCOPE/MATERIAL_ROOT explicitos para PRODUCCION, fijados
# de forma INCONDICIONAL (ver nota identica en agent/windows/start-agent.ps1)
# - nunca depende de variables heredadas de una sesion anterior de
# PowerShell. agent/analyze/run.mts exige RUN_SCOPE (Fase 5.10-B, fail-closed).
$env:RUN_SCOPE = "PRODUCTION"
$env:MATERIAL_ROOT = "D:\MATERIAL VIDEOS"

$LogDir = Join-Path $RepoRoot "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$WrapperLog = Join-Path $LogDir "analyze-task-wrapper.log"

function Write-WrapperLog {
    param([string]$Message)
    $line = "[$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')] $Message"
    Add-Content -Path $WrapperLog -Value $line
}

Write-WrapperLog "Tarea Programada iniciada - arrancando el agente de analisis (agent/analyze/run.mts). RUN_SCOPE=$env:RUN_SCOPE, MATERIAL_ROOT configured."

$TsxBin = Join-Path $RepoRoot "node_modules\.bin\tsx.cmd"
if (-not (Test-Path $TsxBin)) {
    Write-WrapperLog "ERROR FATAL: no se encontro $TsxBin - falta correr 'npm install' en el repo. Se detiene el wrapper."
    exit 1
}

$StdOutLog = Join-Path $LogDir "analyze-agent-stdout.log"
$StdErrLog = Join-Path $LogDir "analyze-agent-stderr.log"

while ($true) {
    Write-WrapperLog "Lanzando: tsx agent/analyze/run.mts (modo global - findPendingWork/recoverStaleClaims propios)"
    $process = Start-Process -FilePath $TsxBin -ArgumentList "agent/analyze/run.mts" `
        -WorkingDirectory $RepoRoot -NoNewWindow -PassThru -Wait `
        -RedirectStandardOutput $StdOutLog -RedirectStandardError $StdErrLog
    Write-WrapperLog "El agente se cerro (codigo de salida $($process.ExitCode)) - reiniciando en 5 segundos..."
    Start-Sleep -Seconds 5
}
