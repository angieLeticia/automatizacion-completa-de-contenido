# Contrato real de la base de datos (Supabase) — Fase 1.1

> **Corrección de un error propio.** En el diagnóstico anterior del Agente 3 afirmé que
> `supabase/schema.sql` no define `content_file_id`, `retry_count`, `schedule_rule_id` ni
> `hashtags` en `social_posts`. **Eso era incorrecto** — mi búsqueda anterior (`Grep` en modo
> `files_with_matches`) confirmó que el archivo contenía esas palabras pero nunca llegué a leer
> las líneas reales antes de concluir. Al leer el archivo completo ahora, la sección 11 de
> `schema.sql` (líneas 216-224) sí las define. Quedo corregido: el problema real no es que falten
> del esquema versionado — es más específico, y se detalla abajo.
>
> Método usado en esta fase: introspección **de solo lectura** contra la base de datos real de
> producción, vía el endpoint de introspección de PostgREST
> (`GET {SUPABASE_URL}/rest/v1/` con la service role key, que devuelve un documento OpenAPI/Swagger
> con todas las tablas, columnas, tipos, PK/FK y NOT NULL/default reales) más `SELECT`s puntuales
> sobre filas reales. **No se ejecutó ningún INSERT/UPDATE/DELETE/DDL.** RLS y CHECK constraints
> no aparecen en ese documento — donde no pude verificarlos, quedan marcados DESCONOCIDO.

---

## `social_posts` (tabla central del contrato Agente 2 ↔ Agente 3)

| Columna | schema.sql (DOCUMENTACIÓN) | BD real (EVIDENCIA) | Estado |
|---|---|---|---|
| `id` | UUID PK default `gen_random_uuid()` | uuid, PK, default `gen_random_uuid()` | 🟢 coincide |
| `account_id` | UUID NOT NULL FK→social_accounts ON DELETE RESTRICT | uuid, NOT NULL, FK→social_accounts.id | 🟢 coincide |
| `video_url` | TEXT NOT NULL | text, NOT NULL | 🟢 coincide |
| `video_path` | TEXT NOT NULL | text, NOT NULL | 🟢 coincide |
| `title` | TEXT (nullable) | text, nullable | 🟢 coincide |
| `caption` | TEXT (nullable) | text, nullable | 🟢 coincide |
| `scheduled_at` | TIMESTAMPTZ NOT NULL | timestamptz, NOT NULL | 🟢 coincide |
| `status` | TEXT NOT NULL DEFAULT 'pending' CHECK IN (4 valores) | text, NOT NULL, default 'pending' | 🟢 coincide (el CHECK no es verificable por REST — ver Desconocido) |
| `external_post_id` | TEXT nullable | text, nullable | 🟢 coincide |
| `error_message` | TEXT nullable | text, nullable | 🟢 coincide |
| `created_at` | TIMESTAMPTZ default now() | timestamptz, default now() | 🟢 coincide |
| `published_at` | TIMESTAMPTZ nullable | timestamptz, nullable | 🟢 coincide |
| `content_file_id` | UUID FK→content_files, nullable (sección 11) | uuid, FK→content_files.id, nullable | 🟢 coincide |
| `hashtags` | TEXT[] **NOT NULL DEFAULT '{}'** (sección 11) | text[], **NOT NULL** — **el spec de PostgREST no muestra ningún default** | 🟡 ver nota abajo |
| `retry_count` | SMALLINT NOT NULL DEFAULT 0 (sección 11) | smallint, NOT NULL, default 0 | 🟢 coincide |
| `schedule_rule_id` | UUID FK→posting_schedule_rules, nullable (sección 11) | uuid, FK→posting_schedule_rules.id, nullable | 🟢 coincide |
| `claimed_at` | **no existe en schema.sql** | **uuid... timestamptz, existe, nullable** | 🟡 **CAMBIO_REAL_DE_PRODUCCIÓN_NO_DOCUMENTADO** |

### Nota sobre `hashtags` — DEFAULT no confirmable por REST, sí por datos reales

El documento OpenAPI de PostgREST no muestra ningún `default` para `hashtags` (a diferencia de
`retry_count`, que sí muestra `"default":0`). Esto por sí solo **no es prueba concluyente** de que
el `DEFAULT '{}'` de `schema.sql` no exista en producción — es una limitación conocida del
generador de specs de PostgREST con tipos array. Para no inventar una conclusión, verifiqué con
datos reales: las 4 filas reales de `social_posts` en producción **todas** tienen `content_file_id`
no-nulo (vienen de `agent/schedule/scheduleContent.mts`, que **sí** provee `hashtags` explícitamente
en el INSERT). **No existe ninguna fila real con `content_file_id IS NULL`** — es decir, el flujo
manual de `/admin/social` (`finalizePosts()`, que NO incluye `hashtags` en su INSERT) **nunca se ha
usado en producción desde que esa columna se volvió NOT NULL**. Por lo tanto:

- **[EVIDENCIA]** `hashtags` es NOT NULL en la base de datos real.
- **[EVIDENCIA]** Ninguna fila real prueba si el DEFAULT '{}' está activo, porque ninguna fila fue
  insertada sin especificar `hashtags`.
- **[CÓDIGO]** `app/admin/social/actions.ts:finalizePosts()` (líneas 52-60) construye el INSERT sin
  el campo `hashtags`.
- **[DESCONOCIDO]** Si ese INSERT se ejecutara hoy, fallaría con una violación NOT NULL **a menos
  que** el DEFAULT '{}' de `schema.sql` sí esté aplicado en producción (el spec no lo confirma ni
  lo descarta). No lo puedo determinar sin ejecutar el INSERT real, y **no lo voy a ejecutar** — el
  usuario pidió explícitamente no modificar nada en esta fase.

### `claimed_at` — hallazgo que cambia una asunción del código

**[EVIDENCIA]** La columna `claimed_at` **existe realmente en producción** (tipo timestamptz,
nullable) aunque **no está en `schema.sql`** y el comentario de
`agent/publish/config.mts:29-36` afirma lo contrario: *"la migración... todavía no existe en la
base de datos real"*. Esa afirmación del código **está desactualizada** — la columna sí existe.

**[CÓDIGO]** `CLAIMED_AT_MIGRATION_APPLIED` (env var) sigue en `false` por defecto, así que
`claimPost.mts`/`recoverStaleClaims()` **nunca leen ni escriben `claimed_at`** aunque la columna
ya esté lista para usarse. La recuperación de "claims huérfanos" del Flujo B (publicación
endurecida) es código muerto hoy, no por falta de columna, sino por una bandera de entorno que
nadie actualizó tras crear la columna.

**Clasificación:** 🟡 `CAMBIO_REAL_DE_PRODUCCIÓN_NO_DOCUMENTADO` — alguien ejecutó
`ALTER TABLE social_posts ADD COLUMN claimed_at ...` directamente en producción (o vía el SQL
Editor de Supabase) sin añadirlo a `schema.sql` ni activar la bandera que lo usa.

---

## Otras tablas relacionadas con los 3 agentes

| Tabla | schema.sql | BD real | Estado |
|---|---|---|---|
| `content_accounts` | id, folder_name (UNIQUE), channel_id (UNIQUE FK), style jsonb, timezone, is_active | idéntico | 🟢 coincide |
| `content_files` | id, content_account_id FK, folder_type CHECK, file_path, file_hash UNIQUE, file_size, detected_at, status CHECK (7 valores) | idéntico (columnas); CHECK no verificable por REST | 🟢 coincide (con la salvedad del CHECK) |
| `content_file_conflicts` | id, file_hash, original_content_file_id FK, conflicting_account_id FK, conflicting_file_path, detected_at, resolved, resolution_note | idéntico | 🟢 coincide — **y tiene datos reales**: 1 conflicto real detectado (ver abajo) |
| `posting_schedule_rules` | id, content_account_id FK nullable, platform CHECK, day_of_week CHECK, window_start/end TIME, max_posts_per_day, is_active | idéntico | 🟢 coincide |
| `post_metrics` | id, post_id FK, metric_name, metric_value numeric, collected_at, UNIQUE(post_id,metric_name,collected_at) | idéntico | 🟢 coincide (vacía en producción — tabla preparada, sin usar aún) |
| `content_metadata` | id, content_file_id FK UNIQUE, status CHECK (6 valores), has_speech, transcript, duration_seconds, width, height, topic_summary, platform_metadata jsonb, claude_model, claude_raw_response, metadata_version, error_message, retry_count, created_at, updated_at + trigger `set_updated_at` | idéntico | 🟢 coincide |
| `social_accounts` | id, channel_id FK, platform CHECK, label, credentials jsonb NOT NULL, is_active, UNIQUE(channel_id,platform) | idéntico | 🟢 coincide |
| `social_channels` | id, name, is_active, created_at | idéntico | 🟢 coincide |

Tablas ajenas a los 3 agentes (`profiles`, `wishlist_items`, `email_logs` — del sitio de e-commerce
Visteapy) también coinciden entre `schema.sql` y la BD real; no se detalla aquí por estar fuera
del alcance de esta auditoría.

---

## RLS, triggers, CHECK constraints — DESCONOCIDO (no verificable con las herramientas actuales)

**[DESCONOCIDO]** El documento OpenAPI de PostgREST no expone políticas RLS ni CHECK constraints,
y no tengo una conexión SQL directa (no hay contraseña de base de datos ni proyecto enlazado con
`supabase link`) ni quiero crear una función RPC nueva para consultar `pg_policies`/`pg_constraint`
porque eso sería modificar el sistema, prohibido en esta fase. Lo único que puedo decir con
evidencia real: **los valores de `status` observados en filas reales** (`pending` en
`social_posts`; `analyzing`, `account_conflict` en `content_files`; `ready` en `content_metadata`)
son consistentes con los CHECK declarados en `schema.sql` — pero eso no prueba que el constraint
en sí siga existiendo en la base de datos, solo que los datos observados no lo contradicen.

Para cerrar esto con certeza se necesitaría una de estas dos cosas (ninguna ejecutada aquí):
1. Acceso de lectura a `pg_policies`/`pg_constraint`/`information_schema` vía una conexión
   Postgres directa (requiere contraseña de BD, no presente en `.env.local`), o
2. La vista del Dashboard de Supabase (Table Editor → RLS / Database → Constraints), a revisar
   manualmente por el usuario.

---

## Hallazgo transversal (no es de esquema, es de **datos** — pero responde directamente la
pregunta "¿cómo se diferencia contenido automático de manual?")

**[EVIDENCIA]** Existen exactamente 3 filas en `content_accounts`: `SIN EXPLICACIÓN`,
`OBJETOS MALDITOS`, `LUNA VERDE`. El Agente 1 (`_agente/proyectos.json`) gestiona **8** canales.
Los 5 restantes (ALZA LA VOZ, ASMR, ENCIENDE EL CAOS, PELICULAS, MUSICA) **no tienen ninguna fila
en `content_accounts`**.

**[RESUELTO — Fase 5.0, no es un bug]** Comparando contra `channelRegistry.mts` (Fase 4.8/4.9,
9 canales reales incluyendo `CHISMES`): las 3 filas existentes corresponden **exactamente** a los
3 únicos canales con `channelStatus` `ACTIVE`/`TEST` (no `BLOCKED`/`HISTORICAL`). Los 6 canales sin
fila (`ALZA LA VOZ`, `ASMR`, `ENCIENDE EL CAOS`, `PELICULAS`, `MUSICA`, `CHISMES`) son exactamente
los `BLOCKED`/`HISTORICAL`. **No se propone backfill** — la ausencia de fila para un canal
bloqueado es coherente con que nunca debe entrar al pipeline automático, no un dato faltante.

**[EVIDENCIA — código]** `agent/discoverAccounts.mts:2-3`: *"El nombre de carpeta es la ÚNICA
forma de reconocer una cuenta — si una carpeta no aparece aquí, el agente jamás la procesa ni la
adivina."* Por lo tanto, todo el material que el Agente 1 produce para esos 5 canales **nunca
entra** al pipeline de registro/metadata/publicación automática (Agente 2 lado Supabase / Agente
3), sin ningún error visible — se ignora en silencio.

**[EVIDENCIA — código, aún más restrictivo]** `scripts/pipeline/config.mts:9`:
`export const ACCOUNTS = ["SIN EXPLICACIÓN"] as const;` — el watcher de **renderizado de video**
(`scripts/pipeline/agent.mts`, el núcleo real del Agente 2) está *hardcodeado* a un solo canal.
Ni siquiera OBJETOS MALDITOS o LUNA VERDE (que sí tienen `content_accounts`) son procesados por
este pipeline.

### Actualización — Fase 4.8: `ACCOUNTS` deja de ser literal, pero no lee `content_accounts` todavía

**[IMPLEMENTADO]** `scripts/pipeline/config.mts`'s `ACCOUNTS` ahora se resuelve desde
`scripts/pipeline/channelRegistry.mts` (`resolveScannableChannels()`) en vez de ser un array
literal — hoy resuelve exactamente a `["SIN EXPLICACIÓN"]` (el único canal con `RenderProvider`
real), pero la resolución ya no es un hardcode, es una consulta a un registro.

**[DECISIÓN EXPLÍCITA — no una omisión]** `channelRegistry.mts` es **local a este repositorio**,
NO lee `content_accounts` de Supabase todavía. Motivo: esta sesión no tiene credenciales de
Supabase disponibles en este worktree, y la tabla real hoy solo tiene 3 filas (`SIN EXPLICACIÓN`,
`OBJETOS MALDITOS`, `LUNA VERDE`, ver evidencia arriba) — **menos** canales que los 9 reales en
disco. El registro local usa la evidencia real ya documentada (`operational-status.md`), no los
datos parciales de la tabla. Migrar `resolveChannelConfig()` para leer `content_accounts` (mismo
patrón que `agent/discoverAccounts.mts`) requiere primero que esa tabla tenga una fila por cada
canal real — trabajo de datos, no de código, y no se hizo en esta fase.

**[PROPUESTA DE MIGRACIÓN — NO APLICADA, requiere autorización explícita para producción]**
Para que `content_accounts` pueda ser la fuente de verdad real del `RenderProvider` de cada canal:
```sql
ALTER TABLE public.content_accounts
  ADD COLUMN IF NOT EXISTS render_provider_id TEXT NULL;
-- NULL = sin RenderProvider integrado todavía (mismo significado que
-- channelRegistry.mts hoy). No requiere backfill destructivo — todas las
-- filas existentes quedan NULL hasta que se decida su provider real.
```
No ejecutada en esta sesión (sin credenciales, y no es estrictamente necesaria para que Fase 4.8
funcione — el registro local ya cumple el mismo contrato). Documentada para cuando se decida
migrar la fuente de verdad de local a Supabase.

### Actualización — Fase 4.9: DerivedContent (CLIP/HIGHLIGHT/VERTICAL) NO necesita tabla nueva

**[EVIDENCIA]** `content_files.folder_type` ya tiene un `CHECK (folder_type IN ('completo', 'clip'))`
— esto YA ES la representación real de "derivado vs. principal" que usa Agent 3 (`agent/config.mts`
`OUTPUT_FOLDERS = { completo: "Videos YouTube Completos", clip: "Clips" }`, ya escaneadas por su
watcher). Responde directamente la pregunta de la Sección 14: **no hace falta una tabla
`derived_content` separada** — extender lo que ya existe alcanza.

**[PROPUESTA DE MIGRACIÓN — NO APLICADA, no destructiva, sin DROP, sin backfill forzado]**
```sql
-- 1) Permitir los dos tipos nuevos de derivado (HIGHLIGHT, VERTICAL) además de
--    'completo'/'clip'. Las filas existentes no se tocan (siguen siendo válidas).
ALTER TABLE public.content_files DROP CONSTRAINT IF EXISTS content_files_folder_type_check;
ALTER TABLE public.content_files ADD CONSTRAINT content_files_folder_type_check
  CHECK (folder_type IN ('completo', 'clip', 'highlight', 'vertical'));

-- 2) Trazabilidad opcional al contenido padre (Sección 8: parent_content_file_id).
--    NULL para todo lo existente — no rompe nada, no requiere backfill.
ALTER TABLE public.content_accounts ADD COLUMN IF NOT EXISTS render_provider_id TEXT NULL; -- (ya propuesta arriba)
ALTER TABLE public.content_files ADD COLUMN IF NOT EXISTS parent_content_file_id UUID NULL
  REFERENCES public.content_files(id) ON DELETE SET NULL;
```
Requisito operativo antes de aplicar esto de verdad: que existan carpetas físicas
`Highlights`/`Vertical` bajo cada canal en `D:\MATERIAL VIDEOS\` y que se agreguen a
`agent/config.mts::OUTPUT_FOLDERS` — de lo contrario Agent 3 nunca las escanearía. Ninguna de las
dos cosas se hizo en esta fase (no hay evidencia de que esas carpetas deban existir todavía, dado
que HIGHLIGHT/VERTICAL están en `scripts/pipeline/{highlightSelector,verticalAsset}.mts` como
contrato/algoritmo probado, no integrados al render real).

**[DECISIÓN RESPETADA]** `content_files.episode_id TEXT` (Fase 2.1) sigue siendo la única identidad
de agrupación de episodio — no se propone ninguna tabla `episodes` nueva, tal como exige
explícitamente la Sección 14.

**[RESUELTO — Fase 5.2.2, VERIFICADO EN SUPABASE REAL]** La pregunta de si la
migración de `channel_status` ya se había aplicado quedó respondida con
evidencia real: **no estaba aplicada** (confirmado por REST y por
`information_schema`/`pg_attribute` consultados directamente en el SQL Editor
de Supabase). Se aplicó en esa fase el `ALTER TABLE` exacto que
`supabase/schema.sql` ya declaraba (líneas 52-57) — `content_accounts` real
tiene ahora `channel_status`, `NOT NULL DEFAULT 'HISTORICAL'`, con el `CHECK`
confirmado vía `pg_constraint`. Las 3 filas reales quedaron en `HISTORICAL`
(ningún canal se activó). `claimed_at` **sí existe** en `social_posts` real
(hallazgo aparte de Fase 5.2.2) aunque el código no la usa todavía
(`CLAIMED_AT_MIGRATION_APPLIED=false`). `publication_authorized_at` no fue
verificado en esta fase. Ver
[`phase-5.2-supabase-verification.md`](phase-5.2-supabase-verification.md) §10
para el detalle completo.

**[EVIDENCIA — datos]** De 58 `content_files` detectados (todos de SIN EXPLICACIÓN salvo 1 de
LUNA VERDE marcado `account_conflict`), solo 3 tienen `content_metadata.status='ready'`, y esos 3
son exactamente los que generaron las 4 filas reales de `social_posts` — todas con
`content_file_id` no-nulo, todas `status='pending'`, con `scheduled_at` ya vencido (2026-09-05/06)
sin publicar todavía.

**[DESCONOCIDO]** Cómo se renderizan/publican hoy en la práctica los episodios de los otros 7
canales (hay episodios reales completados según `_agente/estado.json` — ej. ALZA LA VOZ, ASMR,
ENCIENDE EL CAOS) si el pipeline automático no los toca: probablemente vía `npm run render:main` /
`render:shorts` manual + subida manual por `/admin/social`, pero esto no está confirmado con
evidencia directa en esta fase — señalado aquí como pregunta abierta para la Fase 2, no como
hecho.

**Respuesta directa a "¿existe un campo fiable para distinguir contenido automático de
manual?"**: **Sí** — `social_posts.content_file_id`. No-nulo = originado por
`agent/schedule/scheduleContent.mts` (pipeline). Nulo = originado por `/admin/social` (manual).
Es fiable en el sentido de que el esquema lo garantiza (FK opcional, nunca ambiguo); **hoy no se
usa activamente para diferenciar comportamiento** en ninguno de los dos scripts de publicación —
ese es precisamente el ajuste pendiente identificado en el diagnóstico del Agente 3.
