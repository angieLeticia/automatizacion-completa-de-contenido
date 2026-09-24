# Wrapper que la Tarea Programada de Windows ejecuta al iniciar sesion.
# Mantiene corriendo el agente de PUBLICACION (agent/publish/run.mts, modo
# global "all" - NUNCA se le pasa POST_ID aqui, eso es exclusivamente para
# corridas dirigidas manuales).
#
# MISMA NOTA que agent/schedule/windows/start-agent.ps1: agent/publish/run.mts
# es de una sola pasada (termina con "Ciclo finalizado" y sale) - se usa un
# intervalo de 5 MINUTOS entre pasadas, no el reinicio de 5s usado para los
# procesos que ya loopean internamente (Agent 2/Analyze). Mismo mecanismo de
# "relanzar indefinidamente con reinicio automatico ante crash", dimensionado
# al comportamiento real del script.
#
# SEGURIDAD (Fase 5.6): esta tarea corre con DRY_RUN=true (leido de
# .env.local por agent/publish/config.mts, sin cambios de esta fase) - cada
# pasada hace claim atomico + resolucion de identidad (SOLO consulta
# Supabase, sin llamar a Google/Meta) + se detiene ANTES de llamar a
# cualquier publisher real (ver agent/publish/run.mts, el chequeo de
# DRY_RUN ocurre antes de cualquier llamada externa). recoverStaleClaims()
# corre automaticamente al inicio de cada pasada (modo "all").
#
# IMPORTANTE: este archivo debe mantenerse en ASCII puro (ver nota en
# scripts/pipeline/windows/start-agent.ps1).
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
Set-Location $RepoRoot

# Fase 5.10-E - RUN_SCOPE/MATERIAL_ROOT explicitos para PRODUCCION, fijados
# de forma INCONDICIONAL (ver nota identica en agent/windows/start-agent.ps1)
# - nunca depende de variables heredadas de una sesion anterior de
# PowerShell. agent/publish/run.mts exige RUN_SCOPE (Fase 5.10-B,
# fail-closed) - el claim atomico (claimPost.mts) lleva el filtro de scope
# DENTRO del mismo UPDATE, pero ese scope tiene que resolverse aqui primero.
$env:RUN_SCOPE = "PRODUCTION"
$env:MATERIAL_ROOT = "D:\MATERIAL VIDEOS"

$LogDir = Join-Path $RepoRoot "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$WrapperLog = Join-Path $LogDir "publish-task-wrapper.log"

function Write-WrapperLog {
    param([string]$Message)
    $line = "[$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')] $Message"
    Add-Content -Path $WrapperLog -Value $line
}

Write-WrapperLog "Tarea Programada iniciada - arrancando el agente de publicacion (agent/publish/run.mts, modo global). RUN_SCOPE=$env:RUN_SCOPE, MATERIAL_ROOT configured."

$TsxBin = Join-Path $RepoRoot "node_modules\.bin\tsx.cmd"
if (-not (Test-Path $TsxBin)) {
    Write-WrapperLog "ERROR FATAL: no se encontro $TsxBin - falta correr 'npm install' en el repo. Se detiene el wrapper."
    exit 1
}

$StdOutLog = Join-Path $LogDir "publish-agent-stdout.log"
$StdErrLog = Join-Path $LogDir "publish-agent-stderr.log"
$POLL_INTERVAL_SECONDS = 300  # 5 minutos entre pasadas normales - ver nota arriba

while ($true) {
    Write-WrapperLog "Lanzando: tsx agent/publish/run.mts (una pasada - modo global, sin POST_ID)"
    $process = Start-Process -FilePath $TsxBin -ArgumentList "agent/publish/run.mts" `
        -WorkingDirectory $RepoRoot -NoNewWindow -PassThru -Wait `
        -RedirectStandardOutput $StdOutLog -RedirectStandardError $StdErrLog
    Write-WrapperLog "Pasada terminada (codigo de salida $($process.ExitCode)) - siguiente pasada en $POLL_INTERVAL_SECONDS segundos..."
    Start-Sleep -Seconds $POLL_INTERVAL_SECONDS
}
