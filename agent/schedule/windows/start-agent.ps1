# Wrapper que la Tarea Programada de Windows ejecuta al iniciar sesion.
# Mantiene corriendo el agente de SCHEDULING (agent/schedule/run.mts).
#
# DIFERENCIA DELIBERADA respecto a start-agent.ps1 de Agent 2/Analyze (Fase
# 5.6, auditoria previa): agent/schedule/run.mts es un script de UNA SOLA
# PASADA (sin while(true) propio, termina con "Planificacion finalizada" y
# sale) - a diferencia de Agent 2 y Agent Analyze, que YA loopean
# internamente y solo necesitan reiniciarse tras un crash. Si este wrapper
# usara el mismo Start-Sleep de 5 segundos, el resultado seria un bucle
# MUY ajustado (relanzar cada ~5-10s indefinidamente) - no es "reiniciar tras
# un crash", es convertir un script de una pasada en un poll agresivo no
# pedido. En su lugar, el intervalo entre pasadas normales es de 5 MINUTOS
# (POLL_INTERVAL_SECONDS abajo) - sigue siendo el MISMO patron de
# "relanzar el proceso indefinidamente" (mismo Start-Process -Wait, mismo
# reinicio automatico si crashea), solo con un intervalo dimensionado al
# comportamiento real del script, no una mecanica nueva.
#
# IMPORTANTE: este archivo debe mantenerse en ASCII puro (ver nota en
# scripts/pipeline/windows/start-agent.ps1).
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
Set-Location $RepoRoot

# Fase 5.10-E - RUN_SCOPE/MATERIAL_ROOT explicitos para PRODUCCION, fijados
# de forma INCONDICIONAL (ver nota identica en agent/windows/start-agent.ps1)
# - nunca depende de variables heredadas de una sesion anterior de
# PowerShell. agent/schedule/run.mts exige RUN_SCOPE (Fase 5.10-B,
# fail-closed) - IMPORTANTE: aunque DRY_RUN=true, Schedule SI puede crear
# social_posts reales, por eso este scope es tan critico aqui como en Publish.
$env:RUN_SCOPE = "PRODUCTION"
$env:MATERIAL_ROOT = "D:\MATERIAL VIDEOS"

$LogDir = Join-Path $RepoRoot "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$WrapperLog = Join-Path $LogDir "schedule-task-wrapper.log"

function Write-WrapperLog {
    param([string]$Message)
    $line = "[$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')] $Message"
    Add-Content -Path $WrapperLog -Value $line
}

Write-WrapperLog "Tarea Programada iniciada - arrancando el agente de scheduling (agent/schedule/run.mts). RUN_SCOPE=$env:RUN_SCOPE, MATERIAL_ROOT configured."

$TsxBin = Join-Path $RepoRoot "node_modules\.bin\tsx.cmd"
if (-not (Test-Path $TsxBin)) {
    Write-WrapperLog "ERROR FATAL: no se encontro $TsxBin - falta correr 'npm install' en el repo. Se detiene el wrapper."
    exit 1
}

$StdOutLog = Join-Path $LogDir "schedule-agent-stdout.log"
$StdErrLog = Join-Path $LogDir "schedule-agent-stderr.log"
$POLL_INTERVAL_SECONDS = 300  # 5 minutos entre pasadas normales - ver nota arriba

while ($true) {
    Write-WrapperLog "Lanzando: tsx agent/schedule/run.mts (una pasada - modo global)"
    $process = Start-Process -FilePath $TsxBin -ArgumentList "agent/schedule/run.mts" `
        -WorkingDirectory $RepoRoot -NoNewWindow -PassThru -Wait `
        -RedirectStandardOutput $StdOutLog -RedirectStandardError $StdErrLog
    Write-WrapperLog "Pasada terminada (codigo de salida $($process.ExitCode)) - siguiente pasada en $POLL_INTERVAL_SECONDS segundos..."
    Start-Sleep -Seconds $POLL_INTERVAL_SECONDS
}
