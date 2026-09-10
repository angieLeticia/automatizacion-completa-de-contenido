# automatizacion-completa-de-contenido

Sistema de automatización de contenido para múltiples canales de YouTube/redes
(documentales, misterio, frases motivacionales, ASMR, etc.), construido alrededor de
tres agentes cooperantes:

- **Agent 1 — investigación**: produce el guion y material base de un episodio a partir
  de un tema real, por canal.
- **Agent 2 — producción**: ingiere ese material, lo renderiza (Remotion), genera
  clips/derivados, y pasa un control de calidad real antes de considerarlo listo.
- **Agent 3 — publicación**: toma contenido ya aprobado y lo agenda/publica en las
  plataformas configuradas para ese canal (YouTube, Instagram, Facebook, TikTok).

## Principio de arquitectura: un único repositorio

**El proyecto utiliza un único repositorio de código.** Los canales se incorporan
mediante **configuración** (`scripts/pipeline/channelRegistry.mts`) y, cuando su
formato de contenido lo requiere, mediante un **RenderProvider** nuevo registrado en
`scripts/pipeline/renderProviderRegistry.mts` — nunca mediante un repositorio o
proyecto separado. Un canal nuevo no necesita su propio repo, su propio agente, ni su
propia copia del pipeline: necesita una entrada en el registro de canales y, si su
formato es distinto a los ya soportados, un RenderProvider + template Remotion nuevos
dentro de `remotion/` y `channels/<canal>/`.

Esta regla es el resultado directo de haber migrado el canal **ALZA LA VOZ**
(Fase 5.1): existía como un repositorio externo separado, sin commits reales, y fue
absorbido por completo dentro de este repositorio (`remotion/QuoteVideo.tsx` +
`channels/alza-la-voz/videos.ts` + `scripts/pipeline/quoteVideoProvider.mts`) sin dejar
ninguna dependencia externa. Ese es el patrón a seguir para cualquier canal futuro.

## Arquitectura

Ver [`docs/architecture/autonomous-content-system.drawio`](docs/architecture/autonomous-content-system.drawio)
para el diagrama completo (abrir con [draw.io](https://app.diagrams.net) o la extensión
de VS Code), con cada componente etiquetado según su estado real:
`VERIFICADO` / `IMPLEMENTADO` / `FUTURO` / `LEGACY` / externo.

Documentos de referencia:
- [`docs/technical-inventory.md`](docs/technical-inventory.md) — inventario componente
  por componente (ubicación, responsabilidad, dependencias, consumidores, estado).
- [`docs/dependency-map.md`](docs/dependency-map.md) — quién llama a quién, en qué
  orden, y en qué punto exacto el sistema toca red o disco fuera de su propio proceso.
- [`docs/architecture-unified.md`](docs/architecture-unified.md) — decisiones de diseño
  y su justificación, fase por fase.
- [`docs/system-contracts.md`](docs/system-contracts.md) — contratos de datos entre
  agentes (`ContentSubmission`, `DerivedContent`, `PublicationCandidate`, etc.).
- [`docs/database-contract.md`](docs/database-contract.md) — esquema real de Supabase.
- [`docs/machine-access.md`](docs/machine-access.md) — qué es `MachineBridge` y por qué
  es el único punto de acceso a ffmpeg/ffprobe/whisper/Remotion/filesystem.
- [`docs/operational-status.md`](docs/operational-status.md) — estado real de cada uno
  de los 9 canales conocidos (evidencia física, no aspiracional).
- [`docs/phase-5.2-supabase-verification.md`](docs/phase-5.2-supabase-verification.md) —
  auditoría de código de las tablas/variables que usa Agent 3, y por qué la
  verificación contra Supabase real está detenida (sin credenciales en este
  worktree).
- [`docs/phase-5.2.1-identity-channel-status.md`](docs/phase-5.2.1-identity-channel-status.md) —
  cierre del gap anterior: `content_accounts.channel_status` ahora forma
  parte del contrato de autorización de publicación de Agent 3
  (`agent/publish/channelAuthorization.mts`), no solo del de render.

### Flujo de un episodio (canal ya producible)

```
Material crudo (D:\MATERIAL VIDEOS\<canal>\<episodio>\)
  -> Ingestion (agent/ingestion) -> MATERIAL_ROOT/<canal>/<episodio>/
  -> Agent 2 watcher (scripts/pipeline/agent.mts) detecta y encola
  -> processOne.mts:
       - resuelve el canal -> RenderProvider (scripts/pipeline/renderProviderRegistry.mts)
       - usa MachineBridge.media para transcripción/audio (agent/machine/mediaBridge.mts)
       - usa MachineBridge.render para el render real (agent/machine/renderBridge.mts)
       - pasa el Quality Gate (scripts/pipeline/qualityChecker.mts)
  -> DerivedContent (clips/highlights/vertical) (scripts/pipeline/derivedContent.mts)
  -> Agent 3 Flow B (agent/publish/run.mts), DRY_RUN por defecto
```

### MachineBridge

Todo acceso a herramientas del sistema operativo (ffmpeg, ffprobe, whisper, Remotion
CLI, filesystem) pasa por `agent/machine/machineBridge.mts` y sus sub-bridges
(`filesystem`, `health`, `media`, `render`). No existe ni debe existir un mecanismo
genérico de `execute(command)` — cada operación real está nombrada explícitamente
(`probeMedia`, `transcribe`, `renderComposition`, etc.), con validación de rutas
seguras (`requireSafeMediaPath`) contra una lista explícita de raíces permitidas.

### RenderProvider

`channel -> resolveChannelConfig() -> resolveRenderProvider() -> RenderProvider ->
MachineBridge.render -> Quality Gate`. Nunca un `if/else` por canal dentro de
`processOne.mts`. Errores tipados (`ChannelNotFoundError`,
`ChannelNotProducibleError`, `ChannelProviderNotFoundError`,
`ChannelProviderNotIntegratedError`) en vez de fallos ambiguos.

## Canales

El estado real de cada canal (nunca aspiracional) vive en
`scripts/pipeline/channelRegistry.mts`. Un canal solo se activa para producción real
mediante una **decisión humana explícita** — ninguna migración de código, integración
de provider, o test en verde promueve automáticamente un canal de
`TEST`/`BLOCKED`/`HISTORICAL` a `ACTIVE`.

| Canal | Estado | RenderProvider |
|---|---|---|
| SIN EXPLICACIÓN | `ACTIVE` | `documentary-remotion` |
| OBJETOS MALDITOS | `TEST` | ninguno todavía |
| LUNA VERDE | `TEST` | ninguno todavía |
| ENCIENDE EL CAOS | `BLOCKED` | ninguno todavía |
| ALZA LA VOZ | `BLOCKED` (provider real ya integrado, pendiente decisión humana) | `quote-video-remotion` |
| ASMR | `BLOCKED` | ninguno todavía |
| PELICULAS | `BLOCKED` (copyright) | ninguno |
| MUSICA | `BLOCKED` (copyright) | ninguno |
| CHISMES | `HISTORICAL` (gestión manual) | ninguno |

### Cómo agregar un canal nuevo

1. Agregar su entrada real en `scripts/pipeline/channelRegistry.mts` (sin fabricar
   `theme`/`language`/`style` — si no hay evidencia real, deja esos campos sin definir;
   el sistema falla explícito, no inventa datos).
2. Si su formato de contenido ya existe (documental largo + clips), no se necesita
   ningún código nuevo — solo el registro y que produzca un render real.
3. Si su formato es nuevo (como pasó con ALZA LA VOZ / quotes), crear:
   - el template en `remotion/<Nombre>.tsx` (y registrar sus composiciones en
     `remotion/Root.tsx`),
   - los datos de contenido en `channels/<canal>/`,
   - un `RenderProvider` nuevo en `scripts/pipeline/<nombre>Provider.mts`,
   - registrarlo en `scripts/pipeline/renderProviderRegistry.mts`.
4. Correr la suite de regresión (ver abajo) y agregar casos nuevos a
   `scripts/pipeline/test-render-provider.mts` cubriendo el canal nuevo.
5. El canal permanece en el estado que le corresponda (`TEST`/`BLOCKED`) hasta que una
   persona decida explícitamente promoverlo — eso no es parte de este flujo.

## Crecimiento progresivo

El sistema está diseñado para no requerir reconstrucción al crecer, **no** para
soportar una cifra fija de cuentas. Concretamente:

- Agregar un canal es una entrada de configuración + (opcionalmente) un provider,
  nunca un fork del pipeline.
- `resolveScannableChannels()` deriva qué canales se procesan a partir del registro,
  no de una lista fija en `agent.mts`.
- El cuello de botella real más probable al escalar no es de arquitectura sino de
  **cómputo de render** (Remotion es CPU-bound) y de **cuota de APIs de plataformas**
  (YouTube/Meta/TikTok) — ninguno de los dos se resuelve con microservicios o colas
  distribuidas prematuramente; se resuelve cuando el volumen real lo exija, con
  evidencia (tiempos de render medidos, límites de cuota reales alcanzados), no antes.
- No hay Kubernetes, Kafka, Redis, ni infraestructura distribuida en este sistema, y
  no se agrega ninguna hasta que un cuello de botella real y medido lo justifique.

## Instalación

```bash
npm install
```

Variables de entorno requeridas (ver `.env.example` si existe, o los módulos que las
leen): credenciales de Supabase para Agent 3, `ELEVENLABS_API_KEY` para narración
generada, credenciales OAuth por plataforma para publicación real. Ninguna de estas
está presente en este worktree — Agent 3 corre en `DRY_RUN` por defecto sin ellas.

## Ejecución

```bash
npm run agent:watch      # Agent 2 — watcher real, procesa episodios nuevos/completos
npm run agent:ingest     # Agent 2 — ingestion manual de un ContentSubmission
npm run agent:publish    # Agent 3 — publicación (DRY_RUN salvo configuración explícita)
npm run agent:schedule   # Agent 3 — cálculo de horario de publicación
npm run remotion         # Remotion Studio, para previsualizar composiciones
```

## Tests / regresión

No hay un único comando "test" — cada capa tiene su propia suite ad-hoc, sin mocks,
contra comportamiento real:

```bash
npx tsc --noEmit                              # tipos, todo el repo
npm run machine:test                          # MachineBridge (media/render), 32 casos
npm run ingestion:test                        # Ingestion (ContentSubmission -> ContentPackage), 12 casos
npm run provider:test                         # ChannelRegistry + RenderProviderRegistry, 19 casos
npm run derived-content:test                  # DerivedContent/Highlight/Vertical, 15 casos
npx tsx scripts/pipeline/test-machinebridge-integration.mts   # equivalencia + concurrencia real de locks
npx remotion compositions remotion/index.ts    # confirma que todas las composiciones registran sin errores
```

## Estado de Agent 3 / Supabase en este worktree

Este worktree **no tiene credenciales de Supabase ni de las plataformas de
publicación**. Todo lo que depende de ellas (Flow B en vivo, `findNextAvailableWindow`
contra `posting_schedule_rules` real, `storageBridge` contra el bucket real,
publicación real en cualquier plataforma) está marcado explícitamente `NOT VERIFIED`
en `docs/technical-inventory.md` — el código existe y corre en `DRY_RUN`, pero no hay
evidencia real de su comportamiento contra los sistemas externos desde este entorno.
No se fabrica esa evidencia.

## Seguridad

No hay secretos, tokens, `.env`, ni archivos de video (`.mp4`) en este repositorio.
`agent/machine/pathSafety.mts` restringe todo acceso a filesystem a una lista explícita
de raíces permitidas (`MATERIAL_ROOT`, `INBOX_ROOT`, `public/assets`, `out/`).
