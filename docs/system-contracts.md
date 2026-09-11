# Contratos del sistema — Fase 2

> Diseño, no implementación. Cada afirmación está marcada EVIDENCIA (ya demostrado en Fases
> 0-1.2), DECISIÓN (elegido aquí, requiere tu aprobación antes de implementarse), RECOMENDACIÓN
> (varias opciones válidas, se sugiere una) o DESCONOCIDO (no inventar).

## 1. Identidad — tres claves, no una

**[DECISIÓN]** Rechazo explícitamente una idempotencia basada solo en `file_hash`, como pidió el
encargo. Se necesitan tres identidades independientes, cada una resolviendo un problema distinto:

| Identidad | Clave | Previene | Dónde vive hoy | Falta |
|---|---|---|---|---|
| **Episodio** | `(content_account_id, episode_id)` | Investigar/producir la misma historia dos veces | Convención de carpeta `D:\MATERIAL VIDEOS\<Canal>\<NNN>\` (implícita) | **[Fase 2.1, aprobado]** No una tabla `episodes` nueva — columna `episode_id TEXT` en `content_files` (ya tiene `content_account_id`=canal), con `UNIQUE(content_account_id, episode_id)` |
| **Archivo** | `content_files.file_hash` | Ingerir el mismo video renderizado dos veces | **[EVIDENCIA]** Ya existe, `UNIQUE` real en producción | Nada — conservar tal cual |
| **Publicación** | `(content_file_id, social_account_id)` | Programar la misma publicación dos veces para la misma cuenta | **[EVIDENCIA]** Ya implementado como chequeo de aplicación en `scheduleContent.mts:65-70`, pero **sin constraint real en la BD** — es un `SELECT` antes de `INSERT`, con ventana de carrera | `UNIQUE(content_file_id, account_id)` como constraint real de Postgres, no solo lógica de aplicación |
| **Claim** | `social_posts.status='pending'→'publishing'` (UPDATE condicional) | Que dos procesos publiquen la misma fila a la vez | **[EVIDENCIA]** Ya implementado correctamente en `claimPost.mts` (Flujo B) | Que el motor único (ver §5) lo use siempre, no solo el Flujo B |

Ninguna de las cuatro reemplaza a las otras — actúan en capas distintas del pipeline.

**Actualización — Fase 5.2.2 (VERIFICADO EN SUPABASE REAL):** el `UNIQUE(content_file_id, account_id)`
que faltaba en la fila "Publicación" fue aplicado — `CREATE UNIQUE INDEX
social_posts_content_file_account_idx ON public.social_posts (content_file_id, account_id)
WHERE content_file_id IS NOT NULL` (exactamente el declarado en
`supabase/schema.sql`), ejecutado por el usuario en el SQL Editor, comando
exitoso sin conflicto con los 4 `social_posts` reales existentes. **Confirmado
por `pg_indexes` real**: existe como UNIQUE PARTIAL INDEX (no como `CONSTRAINT`
con nombre) — ver
[`phase-5.2-supabase-verification.md`](phase-5.2-supabase-verification.md) §6
para la evidencia completa del catálogo. La fila "Falta" de la tabla de
arriba, para **Publicación**, queda cerrada.

## 2. Máquina de estados — separar proyecto/episodio de publicación por plataforma

**[DECISIÓN]** Dos máquinas de estado independientes, no una:

> **[ACTUALIZADO — cambio metodológico]** El flujo primario ya no es "Agente 1 investiga
> autónomamente". El flujo primario es: **una persona busca y selecciona el material, lo
> entrega al sistema a través de la Inbox, y la Ingesta lo convierte en el mismo paquete que
> Agente 2 siempre esperó.** El antiguo Agente 1 (investigación web autónoma, reconstruido en
> `docs/agente-1-motor.md`) pasa a ser una fuente **opcional** que alimenta la misma Inbox con
> el mismo contrato (`ContentSubmission`) que un humano — ver `docs/content-ingestion.md` para
> el diseño completo y la justificación de esta decisión (Opción B: agente independiente,
> no eliminado, no obligatorio).

### 2.1 Estado del episodio (uno por `(channel, episode_id)`)

```
SUBMITTED                (persona, o el agente de investigación opcional, entregó material a la Inbox)
  → INGESTED             (archivos recibidos y almacenados, checksum calculado)
  → VALIDATING           (verificando: guion presente o generable, canal identificado, mínimo de material)
  → VALIDATED            (equivalente exacto del viejo "MATERIAL_READY" — manifest.json generado)
  → WAITING_AUTHORIZATION  (listo para render, esperando humano — gate real hoy: decideEnqueue())
  → AUTHORIZED             (hash de material congelado, autorizado a encolar)
  → QUEUED_FOR_PROCESSING
  → PROCESSING             (render en curso — Remotion/voz/whisper)
  → VIDEO_READY            (archivo final existe, hash calculado)
  → QUALITY_VALIDATED      (QA de duración/formato pasó)
  → METADATA_READY         (metadata por plataforma generada)
  → READY_FOR_PUBLICATION  (gate de Agente 3 pasado — ver contrato §5)
  → COMPLETED              (todas las plataformas autorizadas llegaron a estado terminal)

Estados de error/espera, alcanzables desde cualquier punto del camino feliz:
  BLOCKED       (bloqueo estructural no recuperable automáticamente — ej. copyright, render provider desconocido)
  FAILED        (falló con reintentos agotados — requiere intervención humana explícita)
  HELD          (retenido a mano — EVIDENCIA: ya existe como estado real en Agente 2)
```

**[EVIDENCIA]** Los nombres `WAITING_FOR_MATERIAL/HELD/AUTHORIZED/QUEUED/PROCESSING/COMPLETED/ERROR`
ya existen en `scripts/pipeline` — se conservan tal cual como el tramo central de esta máquina,
sin ningún cambio. Lo que se añade es el tramo anterior (Ingesta, nuevo) y posterior (Agente 3)
que hoy no tienen estado explícito. Agente 2 **no distingue ni le importa** si `VALIDATED` llegó
de una persona o del agente de investigación opcional — ese es exactamente el punto del
`ContentProvider` (ver `docs/content-ingestion.md` §4).

### 2.1.1 Cuatro niveles de estado, no uno (respuesta directa al punto 12 del encargo)

| Nivel | Identidad | Dueño | Ejemplo |
|---|---|---|---|
| **Proyecto/canal** | `channel` | `content_accounts` + `channel_status` (arquitectura §3) | "SIN EXPLICACIÓN" está `READY`, "MUSICA" está `HISTORICAL` |
| **Episodio** | `(channel, episode_id)` | máquina de estados de arriba | Episodio 015 está `PROCESSING` |
| **Archivo** | `content_files.file_hash` | `content_files.status` (EVIDENCIA: ya existe) | Un archivo concreto está `analyzing` |
| **Publicación por plataforma** | `(content_file_id, social_account_id)` | `social_posts.status` (EVIDENCIA: ya existe, correcto) | YouTube `published`, Instagram `pending`, Facebook `error` — simultáneamente, del mismo episodio |

Ningún nivel colapsa en otro. Un `status` global por episodio jamás debe usarse para responder
"¿ya se publicó?" — esa pregunta solo la responde el nivel de publicación por plataforma.

### 2.2 Estado de publicación (uno por `(episode, plataforma)` — YA existe correctamente)

**[EVIDENCIA — esto ya está bien diseñado, no hay que inventarlo]** `social_posts` ya modela
esto correctamente: una fila por `(content_file_id, account_id)`, cada una con su propio
`status` (`pending/publishing/published/error`). Un episodio con YouTube publicado, Instagram
pendiente y Facebook en error ya es representable hoy sin ningún cambio de esquema. El problema
real no es la granularidad — es que **nada mantiene sincronizado el estado agregado del
episodio** (`episodes.status` en §2.1) a partir del estado de sus N filas de publicación.

**[DECISIÓN]** `episodes.status = COMPLETED` cuando *todas* sus filas de `social_posts`
asociadas alcanzan un estado terminal (`published` o `error` con reintentos agotados) — nunca
antes. Regla de agregación explícita, calculada por el orquestador (§4), no por cada agente.

## 3. Contrato Ingesta → Agente 2 (reemplaza el actual "si existe el archivo, pasa")

> **[ACTUALIZADO — Fase 4.3, IMPLEMENTADO]** `completenessChecker.mts` (Agente 2) **no se tocó**
> — sigue exigiendo solo `Guion*.md` + (`Videos/` o `Imagenes/`), sin saber nada de manifests.
> Lo que sí existe ahora es la capa de Ingesta (`agent/ingestion/`) que valida un `manifest.json`
> **antes** de materializar los archivos en esa misma convención de carpetas — el manifest real
> implementado es más simple que el ejemplo enriquecido de abajo (ver nota al final de esta
> sección). El ejemplo con `classification`/`dedup`/`copyright_check` sigue siendo **DISEÑO, no
> implementado** — sirve como dirección para cuando el Agente de investigación opcional exista.

**[EVIDENCIA]** Contrato real hoy: `completenessChecker.mts` solo exige `Guion*.md` + (`Videos/`
o `Imagenes/`). No valida fuentes, copyright, dedup, ni metadata.

**[DECISIÓN — diseño original, parcialmente implementado]** Nuevo artefacto obligatorio por
episodio: `manifest.json`, escrito por el módulo de **Ingesta** (no por "Agente 1" — la Ingesta
es quien recibe el `ContentSubmission`, sea de una persona o del agente de investigación
opcional, y lo convierte en este manifest; ver `docs/content-ingestion.md`), en la raíz de
`D:\MATERIAL VIDEOS\<Canal>\<NNN>\`:

```json
{
  "channel": "SIN EXPLICACIÓN",
  "episode_id": "015",
  "classification": "REAL",
  "sources": [
    {"name": "Wikipedia", "url": "...", "tier": "secondary"},
    {"name": "Smithsonian Magazine", "url": "...", "tier": "secondary"}
  ],
  "min_sources_met": true,
  "dedup": {"classification": "CONTENIDO_NUEVO", "related_to": []},
  "copyright_check": {"protected_material_downloaded": false, "policy_version": 1},
  "material": {
    "script_path": "Guion - Expediente Prohibido 09 - X.md",
    "images": [{"path": "Imagenes/01.jpg", "source_url": "...", "license": "public_domain"}],
    "sounds": [{"path": "Sonidos/tension.mp3", "source": "Mixkit", "license": "free_commercial"}],
    "video_references": [{"path": "Videos_Referencia/ENLACE.txt", "url": "..."}]
  },
  "generated_at": "2026-09-08T10:00:00-05:00"
}
```

**[IMPLEMENTADO — Fase 4.3, forma real]** El `manifest.json` que `agent/ingestion/validateManifest.mts`
valida hoy es más simple que el ejemplo de arriba — `ContentSubmission`
(`agent/ingestion/types.mts`): `submission_id`, `channel`, `episode_id?`, `files[]` (cada uno
`{kind, path, sha256}`, `kind` ∈ `video|image|audio|script|reference`), `sources?`,
`submission_checksum`, `schema_version`. La validación real (`VALID`/`INVALID`/`INCOMPLETE`/
`INVALID_HASH`) verifica forma, existencia de cada archivo declarado, y que su SHA-256 real
coincida — **no** valida todavía `classification`/`copyright_check`/`dedup` como campos
estructurados (eso queda para cuando el agente de investigación opcional exista y tenga algo
real que reportar ahí). `min_sources_met`/`copyright_check` como gate obligatorio **no están
implementados** — siguen siendo diseño.

**[DECISIÓN — diseño original, no implementado todavía]** El gate de Agente 2 (extensión de
`checkCompleteness`) pasaría a exigir `classification` + `copyright_check.
protected_material_downloaded=false` — **no se tocó `completenessChecker.mts`** en esta fase
(regla explícita: no modificar Agente 2 salvo estrictamente necesario). **Se mantiene READY sin
exigir narración** (ya era correcto antes — se genera en Agente 2).

**[DECISIÓN — matiz por origen]** `min_sources_met` y `sources[]` siguen siendo **obligatorios**
cuando `submitted_by` indica el agente de investigación opcional (mantiene la política ya
validada: mínimo 2 fuentes independientes). Cuando `submitted_by` es una persona, `sources[]`
es **recomendado, no bloqueante** por defecto — una persona que trae su propio material
(grabación propia, compra con licencia, etc.) no siempre tiene "fuentes" en el sentido
periodístico. **[RECOMENDACIÓN]** el canal puede exigirlo igual vía `content_accounts.style.
requires_sources_for_human_submissions: true` para canales donde la veracidad documental importa
(ej. SIN EXPLICACIÓN, OBJETOS MALDITOS) — configurable por canal, no una regla global rígida.

**[RECOMENDACIÓN]** `fuentes-material.md` (legible por humanos) se conserva como hoy —
`manifest.json` es su versión máquina-legible, no un reemplazo; ambos coexisten.

## 4. Contrato Agente 2 → Agente 3

**[EVIDENCIA]** Hoy: `content_metadata.status='ready'` es la única condición para que
`scheduleContent.mts` cree filas de `social_posts` — no hay gate de autorización humana
específico para publicación, solo para render (`decideEnqueue`).

**[DECISIÓN]** Evidencia mínima que Agente 3 debe recibir antes de aceptar contenido (todo esto
ya existe en el esquema real, solo falta exigirse como gate explícito, no implícito):

```
VIDEO_RENDERED        content_files.status + file_hash (EVIDENCIA: ya existe)
QUALITY_CHECKED       control_calidad ya aplicado en Agente 2 (EVIDENCIA: ya existe en processOne.mts)
METADATA_READY        content_metadata.status='ready' + platform_metadata jsonb (EVIDENCIA: ya existe)
PUBLICATION_AUTHORIZED → NUEVO campo: content_metadata.publication_authorized_at (nullable) —
                         requiere una acción humana explícita por episodio+canal, separada de
                         la autorización de render. Ver Human-in-the-loop en architecture-unified.md.
SCHEDULED              posting_schedule_rules resuelve scheduled_at (EVIDENCIA: ya existe)
IDENTITY               social_accounts.is_active + credenciales completas (EVIDENCIA: ya existe,
                         validado en resolveIdentity.mts del Flujo B)
```

**[DECISIÓN]** `scheduleContent.mts` no debe insertar en `social_posts` directamente — debe
insertar en estado `NOT_YET_AUTHORIZED` (o dejar `publication_authorized_at IS NULL`) y un paso
humano explícito (botón en `/admin/social`, ya existe la superficie de UI) libera el
`scheduled_at` real. Esto es nuevo — hoy no existe ese gate.

## 5. Motor único de publicación (resuelve Flujo A vs Flujo B)

**[DECISIÓN — la propuesta del encargo es técnicamente correcta, se adopta con una corrección]**
Un único motor de publicación (evolución del Flujo B: claim atómico, hash, identidad, retry,
logging) que acepta **dos orígenes normalizados**, no dos flujos de código:

```
ORIGEN PIPELINE (agent/schedule/scheduleContent.mts)
  → content_file_id ya poblado, hashtags ya poblados
  → INSERT directo en social_posts (tras el gate de §4)

ORIGEN MANUAL (/admin/social → finalizePosts)
  → HOY: INSERT directo a social_posts sin content_file_id, sin hashtags
  → PROPUESTO: finalizePosts() primero registra una fila SINTÉTICA en content_files
    (folder_type='manual', file_hash=sha256 real del archivo subido, content_account_id
    de un content_account especial "MANUAL" o el elegido en el form) — DESPUÉS inserta en
    social_posts exactamente con el mismo shape que el origen pipeline (content_file_id
    poblado, hashtags=[] explícito).
```

Con esto, **un único motor** (`agent/publish/run.mts` evolucionado) procesa TODAS las filas de
`social_posts` sin excepción, porque todas tienen `content_file_id` no nulo y `hashtags`
explícito. **El Flujo A (`scripts/publish-due-social-posts.mts`) se retira**, no se mantiene
como adapter — su única función (publicar sin claim atómico) queda estrictamente subsumida.
`lib/social/publishers.ts` no cambia — ya es compartido por ambos.

**[RECOMENDACIÓN]** No eliminar el archivo `scripts/publish-due-social-posts.mts` en esta fase
(regla: no eliminar código); marcarlo `@deprecated` en un comentario y dejar de invocarlo desde
cualquier workflow nuevo, una vez el motor único esté probado.

**[IMPLEMENTADO — Fase 5.0]** La única pieza real que le faltaba al Flujo B para poder subsumir
por completo al Flujo A era `cleanupVideoIfDone()` (borra el video de Storage cuando todas sus
publicaciones ya terminaron en `published`). Se trajo a `agent/publish/storageBridge.mts` (misma
lógica exacta, sin reescribirla) y se conecta desde `agent/publish/run.mts` tras una publicación
real exitosa — con **fail isolation**: un error de limpieza se loguea pero nunca revierte ni
bloquea la publicación ya registrada como exitosa. Solo aplica a Instagram/Facebook (lo que
realmente pasa por Storage); YouTube sigue con entrega directa desde disco, sin Storage. El
Flujo A (`scripts/publish-due-social-posts.mts`) sigue sin eliminarse (regla vigente), pero ya no
tiene ninguna función que Flujo B no cubra. Publicación sigue OFF (`DRY_RUN=true` por defecto,
sin cambios) — esta pieza es código real pero inactivo hasta que se autorice publicación real.

## 6. `episode_log` — bitácora, no bus de eventos

> **[ACTUALIZADO — Fase 2.1, aprobado]** Esto NO es un catálogo de eventos con
> productor/consumidor/entrega garantizada — es una tabla de bitácora simple, insert-only:
> `episode_log(channel, episode_id, stage, status, detail jsonb, created_at)`. Ningún agente
> "consume" un evento de otro; cada agente inserta una fila al terminar su propio paso, y
> `recalculateEpisodeStatus()` (§1 de arquitectura) la lee para agregar estado — no hay
> entrega, reintento de entrega, ni cola. La tabla de abajo documenta **qué fila inserta cada
> paso**, no un contrato de mensajería.

**[DECISIÓN]** Cada paso, al terminar, inserta una fila en `episode_log`:

| Paso (stage) | Quién inserta | Detalle mínimo (`detail` jsonb) | Efecto al recalcular |
|---|---|---|---|
| `submission_received` | Ingesta | `submission_id, channel, files[]` | episodio → `SUBMITTED` |
| `submission_validated` | Ingesta | `manifest_path` | episodio → `VALIDATED` |
| `submission_rejected` | Ingesta | `reason` | episodio no avanza; humano corrige y reenvía |
| `research_completed` / `research_failed` | Agente de investigación opcional, si está habilitado para el canal | `manifest_hash` | produce un `ContentSubmission` igual que un humano, entra por `submission_received` — no es un paso de segunda clase |
| `authorization_granted` | Humano (panel), vía Agente 2 | `material_hash, authorized_by` | episodio → `AUTHORIZED` |
| `render_started` / `render_completed` / `render_failed` | Agente 2 | `content_file_id?` | episodio → `PROCESSING`/`VIDEO_READY`/`FAILED` |
| `quality_passed` / `quality_failed` | Agente 2 | `checks` | → `QUALITY_VALIDATED` |
| `metadata_ready` | Agente 2 | `platforms[]` | → `METADATA_READY` |
| `publication_authorized` | Humano, vía Agente 3 | `platforms[]` | → `READY_FOR_PUBLICATION` |
| `publication_scheduled` | Agente 3 (schedule) | `social_post_id, account_id` | fila `social_posts` creada |
| `publication_claimed` | Motor único (vía el propio `UPDATE` atómico) | `social_post_id` | status→`publishing` |
| `publication_succeeded` / `publication_failed` | Motor único | `social_post_id, external_post_id?, error?` | status terminal; próxima llamada a `recalculateEpisodeStatus()` lo agrega |

`recalculateEpisodeStatus()` (arquitectura §1) es quien lee `episode_log` para agregar
estado — los agentes no se leen el estado entre sí directamente, ni entre ellos ni vía la
bitácora.

## 7. Interfaces de abstracción (para no acoplar todo a rutas Windows / render desconocido)

**[IMPLEMENTADO — Fase 4.3]** `ContentProvider`/`ContentPackage` (sección 3) ya son código real
en `agent/ingestion/contentProvider.mts` y `agent/ingestion/contentPackage.mts` —
`FsInboxContentProvider` es la única implementación, envuelve `scanEpisode()`/
`checkCompleteness()` de `scripts/pipeline` sin modificarlos, y `ContentPackage.files` reutiliza
el tipo `EpisodeFiles` existente vía `import type` (cero duplicación de esa forma).

**[ACTUALIZADO]** El diseño completo de `StorageProvider` (con sus capas local/nube/repositorio
y la evaluación A/B/C de respaldo de multimedia) se movió a `docs/storage-strategy.md` — aquí
solo queda la firma que Agente 2 consume, sin cambiar su comportamiento actual. **`StorageProvider`
formal como interfaz TypeScript sigue sin implementarse** — lo que Fase 4.3 sí implementó
(`FsInboxContentProvider` materializando en `MATERIAL_ROOT`) cubre una parte de su responsabilidad
de forma concreta, sin la interfaz genérica todavía:

```ts
// StorageProvider — abstrae D:\MATERIAL VIDEOS (hoy) sin forzar su migración inmediata.
// D:\MATERIAL VIDEOS pasa a ser la implementación LOCAL de trabajo/caché — no el
// almacenamiento central del sistema. Ver docs/storage-strategy.md para las otras capas.
interface StorageProvider {
  resolveEpisodePath(channel: string, episodeId: string): string;
  readManifest(channel: string, episodeId: string): Promise<EpisodeManifest | null>;
  listMaterialFiles(channel: string, episodeId: string): Promise<string[]>;
  hashFile(path: string): Promise<string>;
}
// Implementación única inicial: LocalFsStorageProvider(MATERIAL_ROOT) — envuelve exactamente
// lo que scripts/pipeline/materialScanner.mts + fileRegistry.mts ya hacen, sin reescribirlos.

// RenderProvider — para no fingir saber cómo se renderizan todos los canales.
// [IMPLEMENTADO Y VALIDADO — Fase 4.8] Firma real (scripts/pipeline/renderProvider.mts) —
// dos operaciones nombradas (documental largo + clip corto) en vez de un render(manifest)
// genérico, porque así es como processOne.mts realmente necesita invocarlo:
interface RenderProvider {
  id: string;
  renderMain(episodeId: string): Promise<{ path: string; hash: string; reused: boolean }>;
  renderClip(episodeId: string, clipIndex: number): Promise<{ path: string; hash: string; reused: boolean }>;
}
```
**Implementación real única: `documentaryRemotionProvider`**
(`scripts/pipeline/documentaryRemotionProvider.mts`) — envuelve exactamente
`MachineBridge.render.renderComposition` (Fase 4.5-4.7), sin reescribir nada. Resolución
channel → provider vía `resolveRenderProvider()` (`scripts/pipeline/renderProviderRegistry.mts`),
consumida desde `processOne.mts` — nunca un `if/else` por canal.

**Estado real por canal (Fase 4.8, ver `scripts/pipeline/channelRegistry.mts` y
`docs/architecture-unified.md` §11):**
- `SIN EXPLICACIÓN`: `documentary-remotion` — único provider real e integrado.
- `ALZA LA VOZ`: provider **declarado** (`alza-la-voz-external`, Remotion independiente en
  `D:\MATERIAL VIDEOS\ALZA LA VOZ\Alza-la-Voz`) pero **NO implementado a propósito** — integrar un
  proceso de otro repositorio es una decisión arquitectónica aparte, no tomada en esta fase.
  `resolveRenderProvider("ALZA LA VOZ")` lanza `ChannelNotProducibleError` (canal BLOCKED, la
  comprobación de estado tiene prioridad sobre la de provider).
- `ENCIENDE EL CAOS`, `ASMR`, `PELICULAS`, `MUSICA`: BLOCKED, sin provider — `ChannelNotProducibleError`.
- `OBJETOS MALDITOS`, `LUNA VERDE`: TEST, sin provider — `ChannelProviderNotFoundError` (error
  específico, no un "Cannot read undefined").
- `CHISMES`: HISTORICAL — `ChannelNotProducibleError`.

**Investigación real de ALZA LA VOZ (Fase 4.9, Sección 12 — inspección de archivos, sin ejecutar nada):**
- **Cómo renderiza:** `node scripts/render-all.mjs` dentro de `D:\MATERIAL VIDEOS\ALZA LA VOZ\Alza-la-Voz`, que hace `execSync("npx remotion render remotion/index.ts <id> out/<id>.mp4 --codec=h264")` por cada id de una lista **hardcodeada de 8 composiciones** (`motivadoras-vertical`, `motivadoras-square`, `mujeres-vertical`, ... — combinaciones tema×formato, NO una por episodio numérico).
- **Inputs:** su propio `remotion/data/` + `remotion/QuoteVideo.tsx` — sin relación con `EpisodeFiles`/`scanEpisode()` de este repo.
- **Outputs:** `out/<id>.mp4` dentro de ESE repositorio, no en `D:\MATERIAL VIDEOS\ALZA LA VOZ\<episodio>\`.
- **Depende de su propio `package.json`/`node_modules`:** sí, completamente independiente (mismo `remotion@4.0.512` por coincidencia, no por acoplamiento).
- **¿Puede invocarse como proceso controlado, de forma nominal?** Técnicamente sí — `execFileSync("npx", [...], { cwd: ALZA_LA_VOZ_ROOT })` sería una operación nombrada, no un `execute(command)` arbitrario. **Pero NO se implementa en esta fase** por dos motivos reales, no por precaución genérica:
  1. **No existe mapeo real episodeId → compositionId.** Las carpetas reales en disco (`001_Frases_Motivadoras`, `002_Frases_para_la_Mujer`, ...) no corresponden 1:1 a los 8 ids hardcodeados en `render-all.mjs` (que son tema×formato, no episodio×nada) — construir ese mapeo requeriría inspeccionar `remotion/data/` de ese repo con más profundidad, trabajo no hecho.
  2. **Expandiría el perímetro de confianza de MachineBridge.** `RenderBridge`/`renderer.mts` están deliberadamente acotados a `REPO_ROOT` (cwd fijo, `out/` como única raíz de salida segura — Fase 4.5). Permitir un segundo root externo (`D:\MATERIAL VIDEOS\ALZA LA VOZ\Alza-la-Voz`) es una decisión de seguridad real (expandir qué directorios puede tocar el proceso de render), no un simple cambio de configuración — queda documentada, no tomada unilateralmente.
- **Conclusión:** `alza-la-voz-external` permanece **DECLARED / NOT INTEGRATED** (Sección 28) — correcto mantenerlo así hasta una decisión explícita sobre el punto 2.
