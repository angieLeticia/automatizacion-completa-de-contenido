# Estado operativo real — Fase 1.2

> Evidencia de solo lectura: filesystem (`D:\MATERIAL VIDEOS`), git (`git log`, `git status`,
> `git remote`), y Supabase (vía el mismo método de introspección de Fase 1.1). Ninguna acción
> modificó código, base de datos, ni el repositorio.

## Hallazgo raíz de esta fase

**Ninguno de los tres agentes está desplegado en GitHub.** `git status --porcelain` muestra
`.github/`, `agent/`, `lib/social/`, `scripts/`, `app/admin/`, `docs/` como **completamente
untracked** (`??`). `git log --all -- .github/workflows/publish-social.yml` no devuelve nada:
ese archivo nunca existió en ningún commit. `origin/main` (GitHub) está exactamente en los mismos
5 commits que `main` local, todos anteriores a la existencia de cualquier código de los 3 agentes.

**Consecuencia directa:** GitHub Actions nunca ha tenido la oportunidad de ejecutar
`publish-social.yml`, ni una sola vez, en ningún momento. No es un cron que falla — es un cron
que GitHub no conoce.

## PRODUCCIÓN REAL

- **Windows Task Scheduler** ejecutando localmente `scripts/pipeline/agent.mts` (tarea
  `VisteapyAgentProduccion`) y `agent/run.mts` (tarea `VisteapyAgentPublicacion`, solo
  detección) — esto SÍ corre de verdad, porque las tareas de Windows ejecutan archivos locales
  directamente y no dependen de git.
- El canal **SIN EXPLICACIÓN**: tiene `content_account`, 3 `social_accounts` activas, 57
  `content_files`, 3 `content_metadata` en `ready`, y 4 `social_posts` reales creadas por
  `agent/schedule/scheduleContent.mts`. Es lo más cercano a un flujo de producción real que
  existe hoy.

## PREPARACIÓN (infraestructura creada, sin conectar)

- **OBJETOS MALDITOS** y **LUNA VERDE**: tienen fila en `content_accounts` pero cero
  `social_accounts` — el scheduler los "saltaría" (`status: "skipped"`) si algún día llegaran a
  tener `content_metadata.status='ready'`. LUNA VERDE ya tiene un `content_file` real bloqueado
  por conflicto de hash (`account_conflict`), evidencia de que el mecanismo de
  `content_file_conflicts` funciona de verdad.
- El código de publicación endurecida (`agent/publish/*`, Flujo B): existe, nunca fue
  programado, corre en `DRY_RUN` por defecto.
- El propio repositorio maestro `automatizacion-completa-de-contenido`: aún no existe ninguna
  migración hacia él.

## PRUEBAS / MATERIAL SIN CONECTAR

- **ALZA LA VOZ, ASMR, ENCIENDE EL CAOS**: el Agente 1 (motor reconstruido) SÍ generó episodios
  reales marcados `PRODUCIDO` en `_agente/registro/*.json` (3, 3 y 4 respectivamente). **Corrección
  respecto a la primera versión de este documento** (verificado con evidencia directa en Fase
  2.1, no en esta fase): solo **ALZA LA VOZ** tiene video final renderizado real
  (`001_VIDEO_CUADRADO.mp4`, etc.), producido por un mini-repo Remotion independiente
  (`D:\MATERIAL VIDEOS\ALZA LA VOZ\Alza-la-Voz\`, con su propio `.git`, `package.json` y
  `scripts/render-all.mjs`) — RENDER_PROVIDER **CONOCIDO**, no desconocido. **ASMR y ENCIENDE EL
  CAOS no tienen ningún archivo final renderizado en ningún episodio** (verificado con búsqueda
  exhaustiva en los dos canales completos) — "PRODUCIDO" en su registro significa que Agente 1
  terminó de recopilar material (guion/imágenes/sonidos), no que exista un video terminado.
  Ninguno de los tres es procesado por `scripts/pipeline/config.mts` (solo escanea
  `["SIN EXPLICACIÓN"]`), consistente con lo ya documentado.
- **PELICULAS, MUSICA**: el Agente 1 (motor) **nunca produjo nada exitosamente** para estos dos
  — sus 2 intentos cada uno terminaron en `VALIDACION_FALLIDA` por bloqueo de copyright (ver
  `docs/agente-1-motor.md` sección 5). Los episodios reales que sí existen en disco
  (`001_Destin`, `001_GRUPO_FIRME_...`) son anteriores al motor — origen: **DESCONOCIDO**
  (probablemente curados a mano antes de que el Agente 1 existiera).
- **CHISMES**: deliberadamente excluido del radar central (`gestionado_por_radar_central: false`
  en `proyectos.json`); su registro está vacío (`[]`). Gestión: manual, fuera del alcance de los
  3 agentes automatizados.

## DESCONOCIDO

- Mecanismo exacto de renderizado para ALZA LA VOZ/ASMR/ENCIENDE EL CAOS/OBJETOS MALDITOS.
- Si alguna vez alguien ejecutó `npm run social:publish` o `npm run agent:publish` manualmente en
  local contra estas 4 filas (no hay log persistente de esos scripts — usan `console.log`, no
  archivo).
- Por qué `.github/`, `agent/`, `lib/social/`, `scripts/`, `app/admin/` nunca se comitearon —
  pudo ser deliberado (trabajo en curso, no listo para compartir) o un descuido.

## Corrección a `docs/agente-1-motor.md`

Nueva evidencia no reflejada en ese documento: `_agente/registro/SIN_EXPLICACION.json` solo
tiene 6 entradas, pero el disco tiene 19 carpetas de episodio — los episodios más antiguos
(aprox. 001-008) preceden al sistema de registro del motor y no quedaron documentados en él. No
se modifica el documento todavía; se señala aquí como hallazgo pendiente de incorporar.

## Actualización — Fase 4.6/4.7 (MachineBridge real, E2E real, auditoría multicanal)

- **MachineBridge** (`agent/machine/*`): `filesystem`/`health`/`media`/`render` implementados y
  **usados de verdad dentro del flujo real de Agent 2** (`scripts/pipeline/processOne.mts`) —
  confirmado con un E2E real sobre el episodio 014 de SIN EXPLICACIÓN: `AUTHORIZATION → QUEUE →
  PROCESSING → MEDIA (probe/detectSilences vía Bridge) → RENDER (vía Bridge, real, 373.9 MB,
  429.76s) → QUALITY (real, PASS)`. La exportación final se bloqueó deliberadamente (protección de
  archivo, no bypass de código) para no sobrescribir producción — ver informe de Fase 4.7 completo.
  `localAI` sigue sin implementar.
- **Multicanal (Agente 2):** la resolución de `ACCOUNTS` decidida en Fase 2
  (`architecture-unified.md` §4) **nunca se implementó** — `scripts/pipeline/config.mts` sigue
  escaneando únicamente `["SIN EXPLICACIÓN"]`. Hallazgo nuevo de Fase 4.7: aunque se implemente,
  ningún canal fuera de SIN EXPLICACIÓN puede renderizar correctamente hasta que exista una forma
  de que cada canal declare su propia composición Remotion (hoy solo existe `MainDocumentary`/
  `ShortClip`, formato documental). Ver `architecture-unified.md` §11.
- **Bug preexistente encontrado y corregido en Fase 4.7:** `scripts/pipeline/episodeRegistrar.mts`
  no podía actualizar un episodio ya registrado en `remotion/lib/episodes.ts` cuando el archivo
  tiene finales de línea CRLF (el caso real en esta máquina Windows) — el regex de reemplazo
  asumía LF. Corregido (`\n` → `\r?\n`, dos ocurrencias). No relacionado con Fase 4.1-4.6.
- **Assets compartidos:** `public/assets/audio/sfx/` (11 archivos, música/SFX) nunca se copió al
  worktree de agentes tras la separación de Fase 4.1.1 — corregido copiando esos 11 archivos
  desde `visteapy-web` (solo lectura sobre Visteapy, SHA-256 verificado 11/11).

## Actualización — Fase 4.8 (RenderProvider real, multicanal validado sin fabricar nada)

`ACCOUNTS` (`scripts/pipeline/config.mts`) ya no es un array literal — se resuelve desde
`scripts/pipeline/channelRegistry.mts::resolveScannableChannels()`. Hoy resuelve exactamente a
`["SIN EXPLICACIÓN"]` (mismo resultado, mecanismo real distinto), porque sigue siendo el único de
los 9 canales reales con un `RenderProvider` implementado (`documentary-remotion`, envuelve
`MachineBridge.render` sin reescribirlo). Probado con evidencia real contra los 9 canales
(`npm run provider:test`, 13/13 PASS) — smoke-test real del watcher confirmó cero fuga hacia otros
canales. `ALZA LA VOZ` sigue BLOCKED con su provider externo declarado pero no integrado (Remotion
independiente en disco). El resto de canales sin cambios de estado. Ver
`docs/architecture-unified.md` §11 y `docs/system-contracts.md` §7 para el detalle completo.

## Actualización — Fase 4.9 (contratos formalizados, sin activar nada nuevo)

**IMPLEMENTADO Y VALIDADO (código real + tests reales, `npm run derived-content:test`, 15/15):**
- `DerivedContent` (CLIP/HIGHLIGHT/VERTICAL) — `scripts/pipeline/derivedContent.mts`, adapta
  `ClipMark` real sin recalcular nada.
- `HIGHLIGHT` formalizado — `scripts/pipeline/highlightSelector.mts`, heurística real sobre
  captions `hook`/`reveal` ya existentes (sin IA externa). **NO integrado al render real todavía**
  (processOne.mts sigue sin llamarlo) — es un algoritmo probado, no una capacidad en producción.
- `VERTICAL` formalizado — `scripts/pipeline/verticalAsset.mts`, separa origen (CLIP/HIGHLIGHT) de
  plataforma destino, valida 1080x1920/9:16/audio contra `MediaInfo` real.
- `ResearchRequest` (Agent 1) — `scripts/pipeline/researchRequest.mts`. Solo resuelve para
  SIN EXPLICACIÓN (único canal con `theme`/`language` reales); cualquier otro canal da
  `CHANNEL_RESEARCH_NOT_CONFIGURED`, no un valor inventado.
- `PublicationCandidate` + metadata por plataforma (Agent 3) — `agent/publish/publicationCandidate.mts`.
  Regla "nunca el mismo texto en dos plataformas" verificada con test real.

**YA ESTABA IMPLEMENTADO, solo documentado ahora (hallazgo de esta fase, no trabajo nuevo):**
- Scheduling real por canal+plataforma+día+horario (`agent/schedule/findNextWindow.mts::findNextAvailableWindow`)
  — lee `posting_schedule_rules`, sin ningún horario hardcodeado. Esto YA es el
  "PublicationSchedule" que pedía la Fase 4.9, con otro nombre.
- Aislamiento de credenciales por canal (`agent/publish/resolveIdentity.mts`) — verifica que
  `content_account.channel_id === social_account.channel_id` antes de publicar; si no coincide,
  bloquea explícitamente. Nunca hace fallback a otra cuenta.

**NO IMPLEMENTADO (documentado, no fabricado):**
- Optimización de horarios por métricas propias (Etapa 2) — `post_metrics` existe en producción
  real (Fase 1.1) pero vacía, sin consumidor, excluida de `supabase/schema.sql` local desde
  Fase 4.1. Contrato tipado en `agent/schedule/scheduleOptimization.mts`, función lanza
  `NOT_IMPLEMENTED` explícitamente en vez de simular una recomendación.
- Integración de ALZA LA VOZ como `RenderProvider` real — investigado (ver
  `docs/system-contracts.md` §7), no implementado: falta mapeo episodio→composición y expandiría
  el perímetro de confianza de MachineBridge fuera de `REPO_ROOT`.
- Estructura de carpetas `source/script/audio/media/render/clips/highlights/vertical/metadata/logs/temp`
  (Sección 13) — NO migrada. La estructura actual de `D:\MATERIAL VIDEOS` sigue intacta; no había
  evidencia de que romperla fuera necesario ni seguro en esta fase.

## Actualización — Fase 5.0 (remote corregido, auditoría física real, integración real de derivados)

- **Git remote:** corregido. Se agregó `agents-origin` apuntando al repo real de agentes
  (`automatizacion-completa-de-contenido.git`) y se configuró `agents-main` para trackear
  `agents-origin/main` por defecto. **`origin` NO se tocó** (sigue en `visteapy-web.git`) — es
  configuración compartida entre worktrees, cambiarlo habría roto Visteapy. Ningún push ejecutado.
- **Auditoría física real de los 9 canales** (`D:\MATERIAL VIDEOS`, línea por línea) — reveló al
  menos 4 convenciones de carpeta distintas entre canales (documental con Guion+Imagenes+Sonidos;
  audio-first sin guion como ENCIENDE EL CAOS; ambient sin narración como ASMR; topic-folders con
  output ya final como ALZA LA VOZ/PELICULAS/MUSICA/CHISMES). Ninguna carpeta
  `Highlights`/`Vertical`/`metadata`/`logs`/`temp` existe físicamente en ningún canal — confirmado
  por búsqueda exhaustiva. Ver matriz completa en el informe de Fase 5.0.
- **Storage mapping** (`scripts/pipeline/storageMapping.mts`) — documenta CurrentPath → 
  LogicalAssetType → FutureCanonicalPath para la convención documental, sin mover un solo archivo.
- **ALZA LA VOZ — resolución definitiva:** `alza-la-voz-external` permanece
  **DECLARED/EXTERNAL/NOT INTEGRATED**, con evidencia más fuerte que en Fase 4.9: `render-all.mjs`
  tiene 8 IDs de composición hardcodeados pero hoy existen 13 carpetas de episodio reales — el
  script de ese repo externo ya está desactualizado respecto a su propio material, confirmando que
  no hay un mapeo episodio→composición confiable que integrar todavía.
- **DerivedContent — integración real demostrada (no solo contrato):** episodio 014 real,
  CLIP→DerivedContent, HIGHLIGHT real encontrado (`"La luz está apagada."`, 2 hooks, score 4,
  frames 49-2513), render real de un clip (`Short-014-0.mp4`, 68.3MB, **hash idéntico byte a byte**
  a la producción real `014 - Clip 1.mp4`), Quality Gate real PASS, VerticalAsset real validado
  (1080x1920 confirmado). Sin sobrescribir `out/main-014.mp4` ni D:\ — output diagnóstico limpiado
  después. Ver informe de Fase 5.0 para el detalle completo.
- **Agent 3 — unificación real de `cleanupVideoIfDone()`:** movida de Flow A
  (`scripts/publish-due-social-posts.mts`, script legacy) a Flow B
  (`agent/publish/storageBridge.mts` + llamada en `run.mts`), con aislamiento de fallos (un error
  de limpieza nunca deshace una publicación ya exitosa). Era la única pieza real que le faltaba a
  Flow B para poder reemplazar a Flow A. `DRY_RUN=true` por defecto sin cambios — esta pieza solo
  se ejecuta después de una publicación real, que sigue sin estar activada.
- **Supabase — discrepancia 9 vs 3 resuelta (no es un bug):** las 3 filas reales de
  `content_accounts` (SIN EXPLICACIÓN, OBJETOS MALDITOS, LUNA VERDE) corresponden exactamente a
  los 3 únicos canales `ACTIVE`/`TEST` — los 6 canales sin fila son exactamente los
  `BLOCKED`/`HISTORICAL`. No se propone backfill: la correspondencia ya es coherente con
  `channel_status`.
- **Cold cache — NOT VERIFIED:** no se ejecutó una transcripción real completa (~30-40 min en CPU
  por episodio, según la propia documentación del pipeline) sin caché en esta sesión por costo de
  tiempo. Las piezas SÍ están probadas por separado con evidencia real (whisper real vía Bridge en
  Fase 4.6.1, sobre un excerpt real) pero el camino "processOne.mts completo sin ningún caché" no
  se ejecutó de punta a punta. No se afirma PASS.
