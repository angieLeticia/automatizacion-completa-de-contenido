# Manual operativo real — cómo ejecutar, inspeccionar y operar el sistema

Este documento es un **manual práctico**, no arquitectónico — para eso ya existen
`docs/agente-1-motor.md`, `docs/operational-status.md`, `docs/system-contracts.md`,
etc. Aquí solo van comandos reales, rutas reales y procedimientos reales,
verificados en este equipo el 2026-09-22 (Bloque 6, post-Fase 6.5). Si algo de
esto deja de coincidir con el código, el código manda — este documento no es
la fuente de verdad, el repositorio sí.

---

## A. Desde dónde se ejecuta

- **Carpeta raíz del proyecto**: `C:\Users\angie\Documents\Proyectos\automatizacion-completa-de-contenido`
- **Terminal recomendada**: PowerShell (los `.ps1` de las Tareas Programadas de
  Windows ya usan `powershell.exe`). Git Bash también funciona para los
  comandos `npm run ...`/`npx tsx ...` sueltos — la diferencia importa sobre
  todo para fijar variables de entorno (ver abajo).
- **¿CMD?** No hace falta — nada en este proyecto depende de `cmd.exe`
  directamente, salvo indirectamente (`npx.cmd`/`tsx.cmd` en Windows, que
  Node ya invoca por su cuenta).
- **Variables de entorno necesarias** (nombres únicamente — nunca valores; ver
  `.env.local.example` para la lista completa con comentarios):
  - `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — Supabase (los 3 agentes).
  - `MATERIAL_ROOT` — ruta del material real (`D:\MATERIAL VIDEOS` en producción).
  - `ELEVENLABS_API_KEY` — narración (Agente 2).
  - `ANTHROPIC_API_KEY`, `WHISPER_MODEL` — análisis (Agente 1/análisis).
  - `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` — solo para obtener un
    refresh_token nuevo (`npm run social:youtube-token`); la publicación real
    usa credenciales ya guardadas en `social_accounts` (Supabase), no en `.env.local`.
  - `RUN_SCOPE` — **obligatoria** para los 5 agentes reales (`PRODUCTION` o
    `TEST`, fail-closed: si falta o tiene otro valor, el agente se detiene
    inmediatamente con un error explícito, nunca "procesa todo por defecto").
  - Todas viven en `.env.local` (nunca comiteado) — `scripts/pipeline/env.mts`
    lo carga automáticamente antes de cualquier otro módulo.
  - **Los 5 wrappers de Windows** (ver sección G) fijan `RUN_SCOPE=PRODUCTION`
    y `MATERIAL_ROOT=D:\MATERIAL VIDEOS` de forma incondicional en PowerShell
    antes de lanzar el agente — no dependen de que `.env.local` los tenga.
- **Directorios importantes**:
  | Ruta | Qué es |
  |---|---|
  | `D:\MATERIAL VIDEOS\<CANAL>\<episodio>\` | Material real de entrada (Guion/Videos/Imagenes/Sonidos) |
  | `D:\MATERIAL VIDEOS\<CANAL>\Videos YouTube Completos\`, `...\Clips\` | Salida final ya exportada |
  | `public/assets/{video,images,audio}/` | Copia de trabajo que Remotion realmente usa para renderizar |
  | `remotion/data/{captions,shots,clips}-<id>.json` | Datos intermedios por episodio |
  | `remotion/lib/episodes.ts` | Catálogo real de episodios registrados (solo canal `documentary-remotion`) |
  | `out/` | Renders temporales (main/clips) antes de exportar |
  | `scripts/pipeline/state/` | `queue.json`, `files.json`, `projects/*.json`, `agent.lock` — estado real del Agente 2 |
  | `logs/` | Logs del Agente 2 (pipeline) y de los wrappers de Windows |
  | `agent/logs/` | Logs del watcher de detección (`agent/run.mts`) |

---

## B. Cómo ejecutar cada agente (comandos reales, verificados en `package.json`)

| Rol | Comando manual | Archivo real | ¿Se usa en el flujo principal? |
|---|---|---|---|
| **Agente 1 — detección** (vigila `MATERIAL_ROOT`, registra en `content_files`) | `npm run agent:watch` | `agent/run.mts` | Sí — continuo |
| **Agente 1 — análisis** (Whisper+Ollama local → `content_metadata`) | `npm run agent:analyze` | `agent/analyze/run.mts` | Sí — continuo |
| **Agente 1 — ingesta manual de Inbox** | `npm run agent:ingest` | `agent/ingestion/run.mts` | **No** — un humano lo corre cuando quiere procesar el Inbox; no es un watcher, no está programado en Windows |
| **Scheduling** (`content_metadata` ready → `social_posts` pending) | `npm run agent:schedule` | `agent/schedule/run.mts` | Sí — continuo |
| **Agente 2 — producción/render** (el pipeline real: guion→voz→render→export) | `npx tsx scripts/pipeline/agent.mts` (sin alias npm) | `scripts/pipeline/agent.mts` | Sí — continuo, requiere `RUN_SCOPE` |
| **Agente 2 — un solo episodio manual** | `npm run pipeline:process -- "SIN EXPLICACIÓN" 011` | `scripts/pipeline/processOne.mts` | Uso manual/depuración |
| **Agente 3 — publicación** | `npm run agent:publish` | `agent/publish/run.mts` | Sí — continuo |

Comandos de apoyo reales (no son "agentes", son utilidades puntuales):
- `npm run pipeline:authorize -- "<CUENTA>" <episodio>` — autoriza un episodio para que Agente 2 pueda procesarlo (obligatorio antes de correr).
- `npm run pipeline:revoke` / `pipeline:hold` / `pipeline:release` — gestión de autorización.
- `npm run social:publish` — script legado de publicación directa (`agent/publish/run.mts` **no** lo invoca — son caminos separados, ver el propio comentario de cabecera de `agent/publish/run.mts`).
- `npm run social:youtube-token` — obtiene un refresh_token nuevo de YouTube (uso puntual, una vez por canal).

---

## C. Cómo ejecutar una producción manual, paso a paso

1. **Colocar material** en `D:\MATERIAL VIDEOS\<CUENTA>\<episodio numérico>\`, con `Guion*.md` en la raíz del episodio y `Videos/`, `Imagenes/`, `Sonidos/` como subcarpetas (nombres exactos — ver sección F para los errores más comunes de nombre).
2. **Comprobar el estado del material** (sin ejecutar nada):
   ```bash
   npx tsx -e "import('./scripts/pipeline/materialScanner.mts').then(({scanEpisode})=>{import('./scripts/pipeline/completenessChecker.mts').then(({checkCompleteness})=>{console.log(checkCompleteness(scanEpisode('SIN EXPLICACIÓN','011')))})})"
   ```
   O más simple: dejar que el Agente 1 (`npm run agent:watch`) lo detecte solo si está corriendo.
3. **Autorizar el episodio** (obligatorio, gate real de seguridad):
   ```bash
   npm run pipeline:authorize -- "SIN EXPLICACIÓN" 011
   ```
4. **Ejecutar el Agente 2** para ese episodio:
   ```bash
   npm run pipeline:process -- "SIN EXPLICACIÓN" 011
   ```
   o dejar que el agente continuo (`npx tsx scripts/pipeline/agent.mts`) lo recoja de la cola.
5. **Comprobar el render**: `out/main-011.mp4` (y `out/Short-011-*.mp4` para los clips) mientras corre; el estado real vive en `scripts/pipeline/state/projects/SIN EXPLICACIÓN__011.json`.
6. **Comprobar la salida final**: `D:\MATERIAL VIDEOS\SIN EXPLICACIÓN\Videos YouTube Completos\011 - <título>.mp4` y los clips en `...\Clips\`.
7. **Pasar a Agente 3**: no es un paso manual — en cuanto Agente 2 termina, si el flujo de Agente 1 (`analyze`)/`schedule` ya generó `social_posts` pendientes para ese contenido, Agente 3 (`agent:publish`, si está corriendo) los reclama solo cuando `scheduled_at` llega.
8. **Revisar publicación**: `npm run social:review-queue` lista lo pendiente/en revisión; `docs/` tiene varios `phase-5.1x-*.md` sobre el detalle de reconciliación por plataforma.
9. **Verificar YouTube/Facebook/Instagram**: vía la propia plataforma, o `npm run social:reconcile-youtube` / `social:reconcile-instagram` (solo lectura/reconciliación, no publican nada nuevo).

---

## D. Cómo saber qué está ocurriendo

| Quiero saber... | Dónde miro |
|---|---|
| Qué episodios están en cola/procesando/error (Agente 2) | `scripts/pipeline/state/queue.json` |
| Estado detallado de un proyecto específico | `scripts/pipeline/state/projects/<CUENTA>__<episodio>.json` |
| Qué archivos ya se registraron/hashearon | `scripts/pipeline/state/files.json` |
| Si el Agente 2 sigue vivo (lock) | `scripts/pipeline/state/agent.lock` |
| Logs del pipeline (Agente 2) por día | `logs/pipeline-YYYY-MM-DD.log` |
| Logs del watcher de detección (Agente 1) por día | `agent/logs/agent-YYYY-MM-DD.log` |
| Salida cruda del wrapper de Windows de cada agente | `logs/<nombre>-agent-stdout.log` / `-stderr.log` / `logs/<nombre>-task-wrapper.log` (o `agent/logs/task-wrapper.log` para el de detección) |
| Estado real de episodios en Supabase (`content_files`/`content_metadata`) | Consulta directa a Supabase (dashboard, o un script puntual como los `fase5-10*-*.mts` ya existentes) |
| Publicaciones pendientes/en error | `npm run social:review-queue` |
| Episodios ya exportados | `D:\MATERIAL VIDEOS\<CUENTA>\Videos YouTube Completos\` y `...\Clips\` |

---

## E. Cómo inspeccionar el código — guía práctica

- **"¿Cómo se procesa un episodio de punta a punta?"** → `scripts/pipeline/processOne.mts` (función `processProject()`) es el único lugar real — léelo de arriba a abajo, cada paso está comentado con el motivo.
- **"¿Por qué no renderiza?"** → en este orden: `scripts/pipeline/processOne.mts` (¿llegó hasta el render?) → `scripts/pipeline/renderProviderRegistry.mts` (¿qué provider resolvió?) → `scripts/pipeline/renderer.mts` (la invocación real de `npx remotion render`) → `logs/pipeline-YYYY-MM-DD.log` (el error real).
- **"¿Qué provider usa un canal?"** → `scripts/pipeline/channelRegistry.mts` (campo `renderProviderId` de cada canal) → `scripts/pipeline/renderProviderRegistry.mts` (mapeo id → implementación real).
- **"¿Qué composición usa un provider?"** → el propio archivo del provider (`documentaryRemotionProvider.mts`, `chaosNewsRemotionProvider.mts`, `quoteVideoProvider.mts`) — el id de composición está literal en el código, sin indirecciones.
- **"¿Por qué no se publica?"** → `agent/publish/run.mts` → `agent/publish/claimPost.mts` (¿lo reclamó?) → `agent/publish/publicationAuthorization.mts` / `retryPolicy` (¿por qué no avanzó?) → `logs`/tabla `social_posts` en Supabase para el motivo real.
- **"¿Por qué un episodio quedó detenido?"** → `scripts/pipeline/state/projects/<CUENTA>__<episodio>.json` (campo `status`) → `scripts/pipeline/state/queue.json` (campo `lastError` del job) → `logs/pipeline-YYYY-MM-DD.log` buscando el `episodeId`.
- **"¿Qué material espera un canal?"** → `scripts/pipeline/materialScanner.mts` (`scanEpisode`) + `scripts/pipeline/completenessChecker.mts` (`checkCompleteness`) — son las dos únicas funciones que deciden si un episodio está "listo".
- **"¿Qué voz usa un canal?"** → `scripts/pipeline/channelRegistry.mts` (campo `voice.narratorVoicePattern`, `undefined` si no hay voz real definida todavía).

---

## F. Diagnóstico

| Problema | Qué revisar | Comando/prueba | Qué significa |
|---|---|---|---|
| Agente 2 no detecta material | `scripts/pipeline/materialScanner.mts::EPISODE_FOLDER_RE/SCRIPT_FILE_RE` vs. nombres reales de carpeta/archivo | Comparar a mano el nombre real contra `/^\d+$/` (carpeta) y `/^guion/i` (script) | El escaneo es literal por nombre — un guion en subcarpeta (ej. `Voz y Guion/`) o una carpeta `Videos_Referencia` en vez de `Videos` **no se detectan**, aunque el archivo exista |
| Episodio queda en `WAITING_FOR_MATERIAL` | `scripts/pipeline/state/projects/<...>.json` → `completenessChecker.mts` | — | Falta guion, o no hay ni videos ni imágenes |
| Episodio queda en `NOT_AUTHORIZED` | `scripts/pipeline/state/projects/<...>.json` → campo `authorizedMaterialHashes` | `npm run pipeline:authorize -- "<CUENTA>" <id>` | Nunca se autorizó, o el material cambió después de autorizar |
| Render falla | `logs/pipeline-YYYY-MM-DD.log` | buscar `Error` cerca del episodeId | Ver el mensaje real de `npx remotion render` — casi siempre asset faltante o composición inexistente |
| "Composición inexistente" | `agent/machine/renderBridge.mts::assertCompositionExists()` | — | El id no matchea `MainDocumentary-<id>`/`Short-<id>-<n>`/`Quote-alza-la-voz-...`/`ChaosNewsMain`/`ChaosNewsClip`, o el episodio no está en el catálogo real |
| Asset no encontrado (404 de Remotion) | `public/assets/{video,images,audio}/` | ¿existe el archivo referenciado por `videoPool`/`imagePool`/`narrationFile`? | El material no se copió (paso `copyEpisodeAssets` falló o no corrió) |
| Voz ausente | `scripts/pipeline/channelRegistry.mts` → `voice` del canal | — | Canal sin `narratorVoicePattern` real — `processOne.mts` lo rechaza explícito, nunca usa la voz de otro canal |
| Audio/música ausente | Config del episodio/provider (`audio?: AmbientAudioConfig`) | — | Diseño deliberado: sin música real definida, la composición simplemente no monta `<AmbientAudio>` |
| Provider incorrecto | `channelRegistry.mts::renderProviderId` | `resolveRenderProvider("<CUENTA>")` (vía `provider:test` o un script puntual) | Confirma qué provider real resolvería hoy para ese canal |
| Identidad incorrecta (colores/fuentes de otro canal) | El `theme`/`ChannelVisualTheme` que ese provider importa | — | Cada canal con identidad real tiene su propio `theme.ts`/`channels/<canal>/theme.ts` — nunca se comparte por accidente (verificado con tests) |
| Agente 3 no reclama | `agent/publish/claimPost.mts` | `npm run social:review-queue` | `scheduled_at` todavía no llegó, o el post no está en `pending` |
| Publicación no autorizada | `agent/publish/publicationAuthorization.mts` | — | Gate explícito de autorización humana antes de publicar (ver `docs/phase-5.14-human-review.md`) |
| Publicación falla | Tabla `social_posts` (`status`, `retry_count`) + `agent/publish/retryPolicy.mts` | — | Ver `classifyError()` — distingue error reintentable de definitivo |
| Worker detenido | `scripts/pipeline/state/agent.lock`, proceso `node.exe` vivo | `Get-Process node` (PowerShell) | Si el lock existe pero no hay proceso vivo, el wrapper de Windows lo reinicia solo en máx. 5s (ver sección G) |

---

## G. Arranque, parada y verificación

### Arranque
Los 5 agentes están registrados como **Tareas Programadas de Windows** (disparador: inicio de sesión del usuario — `MSFT_TaskLogonTrigger`), cada una ejecutando un wrapper `.ps1` que relanza el agente indefinidamente si se cae:

| Tarea Programada (nombre real) | Qué lanza en realidad | Wrapper |
|---|---|---|
| `VisteapyAgentProduccion` | Agente 2 (`scripts/pipeline/agent.mts`) | `scripts/pipeline/windows/start-agent.ps1` |
| `VisteapyAgentPublicacion` | ⚠️ Agente 1 — **detección** (`agent/run.mts`), pese al nombre | `agent/windows/start-agent.ps1` |
| `VisteapyAgentAnalyze` | Agente 1 — análisis (`agent/analyze/run.mts`) | `agent/analyze/windows/start-agent.ps1` |
| `VisteapyAgentSchedule` | Scheduling (`agent/schedule/run.mts`) | `agent/schedule/windows/start-agent.ps1` |
| `VisteapyAgentPublish` | Agente 3 — publicación real (`agent/publish/run.mts`) | `agent/publish/windows/start-agent.ps1` |

> **Nota real, no un error mío**: `VisteapyAgentPublicacion` NO es el agente de
> publicación — ese es `VisteapyAgentPublish`. El nombre de la tarea es
> engañoso; lo confirmé leyendo el wrapper real que ejecuta.

Todas estaban en estado **`Ready`** (registradas, no corriendo en este
momento) al inspeccionarlas — ninguna se modificó ni se tocó.

- **Iniciar manualmente una tarea**: `Start-ScheduledTask -TaskName "VisteapyAgentProduccion"` (PowerShell, como administrador si hace falta).
- **Iniciar sin Task Scheduler** (para depurar en primer plano): `npx tsx scripts/pipeline/agent.mts` con `$env:RUN_SCOPE="PRODUCTION"` y `$env:MATERIAL_ROOT="D:\MATERIAL VIDEOS"` ya fijados en esa sesión de PowerShell.

### Parada
- **Detener una tarea programada**: `Stop-ScheduledTask -TaskName "<nombre>"` — el wrapper `.ps1` volverá a relanzar el proceso en 5s salvo que también se deshabilite la tarea.
- **Deshabilitar** (para que no vuelva a arrancar solo, ni ahora ni en el próximo logon): `Disable-ScheduledTask -TaskName "<nombre>"`.
- **Matar el proceso a mano**: `Get-Process node | Where-Object {...}` + `Stop-Process` — el wrapper lo relanza en 5s si la tarea sigue habilitada.
- Existen además scripts propios `register-task.ps1`/`unregister-task.ps1` en cada carpeta `windows/` (`agent/windows/`, `agent/analyze/windows/`, `agent/schedule/windows/`, `agent/publish/windows/`, `scripts/pipeline/windows/`) para crear/eliminar la tarea — **no los ejecuté** (ni de lectura hacía falta), solo se listan aquí para que sepas dónde están.

### Reiniciar
`Stop-ScheduledTask` + `Start-ScheduledTask` con el mismo nombre — o simplemente `Stop-Process` sobre el `node.exe` correspondiente y dejar que el wrapper lo relance solo.

### Comprobar que está corriendo
```powershell
Get-ScheduledTask -TaskName "Visteapy*" | Select-Object TaskName, State
Get-Process node | Select-Object Id, StartTime, CPU
```
Y de forma más fiable — mirar si los logs (`logs/pipeline-agent-stdout.log`,
`agent/logs/agent-YYYY-MM-DD.log`, etc.) tienen actividad reciente.

### Comprobar que Windows lo inicia automáticamente
Confirmado real (disparador `MSFT_TaskLogonTrigger` en las 5 tareas) — arrancan
solas al iniciar sesión de Windows con este usuario, sin intervención manual.
**No se cambió nada de esto** — es una inspección de solo lectura.
