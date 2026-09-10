# Fase 5.2 — Supabase Integration & Live Contract Verification

Estado: **abierta, detenida en el primer punto que requiere credenciales que no
existen en este worktree.** Esta fase NO activa publicación real ni autonomía.

## 1. Credenciales — inspección de código (sin conexión en vivo)

Variables exactas que el código espera (`lib/social/supabaseAdmin.ts`,
`.env.local.example`), y su estado real en este entorno ahora mismo:

| Variable | Usada por | Estado |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/social/supabaseAdmin.ts` (cliente único, reusado por todo Agent 2/3) | `MISSING` |
| `SUPABASE_SERVICE_ROLE_KEY` | idem | `MISSING` |
| `ELEVENLABS_API_KEY` | narración generada (Agent 2) | `MISSING` |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | obtención de refresh_token (una vez, fuera del flujo normal) | `MISSING` |
| `ANTHROPIC_API_KEY` | Agent 1/analyze | `MISSING` |
| `DRY_RUN` | Agent 3 — controla publicación real | `MISSING` (ver §5: el código trata "ausente" como seguro) |
| `CLAIMED_AT_MIGRATION_APPLIED` | Agent 3 — gate de una migración no aplicada | `MISSING` (seguro: default `false`) |
| `.env.local` (archivo) | cargado por `agent/publish/config.mts` si existe | **no existe en disco en este worktree** |

No se imprimió ningún valor — solo presencia/ausencia, confirmada leyendo el
propio `process.env` de este shell y verificando que el archivo `.env.local`
no existe físicamente en el repo. **Sin estas dos variables (`NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`) no es posible ejecutar NINGUNA consulta real a
Supabase desde este worktree.** Esto es el límite real de esta fase, no una
elección de alcance.

## 2. Tablas realmente usadas por el código (identificadas por `grep`, no por suposición)

| Tabla | Leída por | Escrita por |
|---|---|---|
| `content_accounts` | `discoverAccounts.mts`, `agent/analyze/claimWork.mts`, `agent/schedule/resolveIdentity.mts`, `agent/publish/resolveIdentity.mts` | — (gestionada fuera del agente) |
| `content_files` | `registerFile.mts`, `processFile.mts`, `recoverPending.mts`, `agent/schedule/scheduleContent.mts`, `agent/publish/resolveContentFile.mts`, `agent/analyze/claimWork.mts` | `registerFile.mts`, `processFile.mts`, `recoverPending.mts` |
| `content_file_conflicts` | — | `registerFile.mts` (insert, colisión de hash) |
| `content_metadata` | `agent/schedule/run.mts`, `agent/schedule/scheduleContent.mts`, `agent/analyze/*` | `agent/analyze/processOne.mts`, `claimWork.mts` |
| `social_accounts` | `agent/schedule/resolveIdentity.mts`, `agent/publish/resolveIdentity.mts` | — |
| `social_posts` | `agent/publish/claimPost.mts`, `run.mts`, `storageBridge.mts`, `agent/schedule/scheduleContent.mts`, `findNextWindow.mts` | `claimPost.mts` (claim/revert/recover), `run.mts` (resultado de publicación) |
| `posting_schedule_rules` | `agent/schedule/findNextWindow.mts` | — |
| `post_metrics` | **ninguna referencia encontrada en código** — consistente con `scheduleOptimization.mts` estar deliberadamente `NOT_IMPLEMENTED` | — |

Confirmado por `grep -rn '.from("...")' agent/` — no inventado.

## 3. Identity — hallazgo de auditoría estática (sin necesitar Supabase real)

`agent/publish/resolveIdentity.mts` (defensa en profundidad, al momento de
publicar) verifica exactamente lo pedido:
- cuenta social activa (`social_accounts.is_active`),
- publisher implementado para la plataforma,
- credenciales requeridas presentes,
- **`content_account.channel_id === social_account.channel_id`** — mismatch
  produce `{ ok: false, reason: ... }` explícito, sin fallback por nombre ni
  por plataforma ni por cuenta "parecida".

`agent/schedule/resolveIdentity.mts` (al programar) resuelve la misma cadena
`content_file -> content_account -> channel_id -> social_accounts activa`, con
el mismo principio: ambigüedad o cuenta faltante = se omite esa plataforma
(`skipped`), nunca se infiere.

**Hallazgo real (gap, no un bug activo hoy):** el schema define
`content_accounts.channel_status` (`ACTIVE`/`READY`/`TEST`/`BLOCKED`/`HISTORICAL`,
`supabase/schema.sql` línea 56-57) — la misma clasificación que
`scripts/pipeline/channelRegistry.mts` usa localmente para bloquear el RENDER
de canales no autorizados. **Ninguna consulta en `agent/schedule/` ni
`agent/publish/` lee `channel_status`** (`grep -rn "channel_status" agent/` = 0
resultados) — solo se usa `content_accounts.is_active` (booleano, distinto
campo) en `discoverAccounts.mts`. Es decir: hoy existen DOS mecanismos de
gating de canal que no están unificados — el de render (fuerte, por
`channel_status`) y el de publicación (más simple, por `is_active`). Mientras
`is_active` y `channel_status` se mantengan consistentes manualmente esto no
es un bug observable, pero es una inconsistencia arquitectónica real que
debería cerrarse antes de activar publicación real para cualquier canal fuera
de SIN EXPLICACIÓN.

**Actualización — Fase 5.2.1 (gap cerrado en código, IMPLEMENTED):**
`agent/publish/channelAuthorization.mts` añade `evaluateChannelAuthorization(channelStatus)`,
una función pura (sin ningún import de Supabase) que decide:
- `channel_status IN ('BLOCKED', 'HISTORICAL')` → `{ blocked: true, reason: ... }` —
  `resolveAndValidateIdentity()` la usa (ver `resolveIdentity.mts`, ahora selecciona
  también `channel_status` junto a `channel_id`) y devuelve `{ ok: false, reason }`
  ANTES de que el post pueda llegar a `claimPost`/`run.mts`'s publish branch —
  igual que el mismatch de `channel_id` ya existente, mismo patrón, sin duplicación.
- `channel_status === 'ACTIVE'` → único estado que autoriza publicación real
  (`authorizedForRealPublication: true`).
- `channel_status IN ('TEST', 'READY')` (y `null`/desconocido) → no bloquea el
  resto del flujo (claim/schedule funcionan igual), pero
  `authorizedForRealPublication: false` — `READY` se decide así explícitamente
  por ambigüedad de contrato (ver comentario en `channelAuthorization.mts`),
  no se inventa que signifique publicación real.

`agent/publish/run.mts` combina esto con el DRY_RUN global SIN que ninguno
sustituya al otro: `if (DRY_RUN || !identityOutcome.authorizedForRealPublication)`
— la publicación real solo ocurre cuando AMBAS condiciones lo permiten.

Cubierto por 15 casos reales en `agent/publish/test-publication-authorization.mts`
(`npm run publish-authorization:test`), sin necesitar Supabase — ver detalle en
`docs/phase-5.2.1-identity-channel-status.md`.

Estado: `IDENTITY: IMPLEMENTED` (channel_status ahora forma parte del contrato de
autorización, en código, probado sin Supabase). `VERIFIED AGAINST REAL SUPABASE:
NOT VERIFIED` — sigue sin conexión real para confirmar `content_accounts.channel_status`
tal como está en producción, y para ejercitar `resolveAndValidateIdentity()`/`run.mts`
de punta a punta (ambos requieren el cliente Supabase real para poder importarse).

## 4. Scheduling — hallazgo de auditoría estática

`agent/schedule/findNextWindow.mts` consulta `posting_schedule_rules`
(filtrando por `content_account_id` o regla global cuando esa columna es
`NULL`, `platform`, `day_of_week`, `window_start`) — no hay horarios
hardcodeados en código. El comportamiento sin regla encontrada no se pudo
ejercitar sin datos reales (`NOT VERIFIED`).

Estado: `SCHEDULING: NOT VERIFIED`.

## 5. Agent 3 — Flow B (auditoría estática de `claimPost.mts`, `run.mts`)

- **Claim atómico**: `UPDATE social_posts SET status='publishing' WHERE id=? AND status='pending'` — atómico por semántica de Postgres bajo READ COMMITTED (lock de fila + re-evaluación del WHERE), sin necesitar función RPC. Ya documentado y ya implementado — no se construyó un segundo mecanismo.
- **DRY_RUN**: `export const DRY_RUN = process.env.DRY_RUN !== "false"` (`agent/publish/config.mts:13`) — con la variable ausente (como está aquí), el valor es `true` por defecto: **seguro por diseño**, confirmable por lectura directa del código sin necesitar ejecutarlo contra Supabase real.
- **Claims huérfanos**: `recoverStaleClaims()` existe pero está intencionalmente inerte (`CLAIMED_AT_MIGRATION_APPLIED=false` por defecto — la columna `claimed_at` no existe todavía en la base real; activarla sin la migración aplicada rompería el claim que sí funciona hoy).

Estado: `AGENT 3 FLOW B: NOT VERIFIED contra datos reales` (código revisado y consistente; sin Supabase real no se pudo ejecutar el escenario controlado de la Sección 11 del encargo).

## 6. Idempotencia — confirmado en el schema declarado (no en producción real)

`supabase/schema.sql` ya declara exactamente los mecanismos pedidos:
- Archivo: `content_files.file_hash TEXT NOT NULL UNIQUE` (línea 70) — único GLOBAL.
- Publicación: `CREATE UNIQUE INDEX social_posts_content_file_account_idx ON public.social_posts (content_file_id, account_id) WHERE content_file_id IS NOT NULL` (líneas 168-169).
- Episodio: `content_accounts.folder_name UNIQUE` + `channel_id UUID UNIQUE` (líneas 47-48).

Estos son los ÚNICOS mecanismos de idempotencia en el proyecto — no se creó
una segunda implementación. **Lo que no se pudo verificar es si la base de
datos REAL en producción tiene efectivamente este schema aplicado** (podría
haber divergido del `schema.sql` local si alguien aplicó cambios manuales)
— eso requiere una conexión real.

Estado: `IDEMPOTENCY: IMPLEMENTADO (schema declarado) / NOT VERIFIED (producción real)`.

## 7. Matriz de estado (Sección 20 del encargo)

| Área | Estado |
|---|---|
| Supabase connection | `NOT VERIFIED` — credenciales ausentes en este worktree |
| Identity (lógica) | `IMPLEMENTED` (Fase 5.2.1: `channel_status` ahora forma parte del contrato — ver §3) / `NOT VERIFIED AGAINST REAL SUPABASE` |
| Channel identity isolation | `NOT VERIFIED` — el check `channel_id` existe en código; sin datos reales no se ejercitó |
| Scheduling | `NOT VERIFIED` |
| Atomic claim | `NOT VERIFIED` contra datos reales (mecanismo revisado y correcto por inspección de código) |
| Idempotency | `IMPLEMENTADO` (schema declarado) / `NOT VERIFIED` (producción real) |
| Agent 3 Flow B | `NOT VERIFIED` |
| DRY_RUN | `VERIFIED` — por default de código (`DRY_RUN !== "false"`), sin necesitar Supabase |
| Real publication | `OFF` |
| Agent 1 multichannel contract | `VERIFIED` — ver `scripts/pipeline/test-derived-content.mts`, 19/19 casos, incluye LUNA VERDE/ENCIENDE EL CAOS (NOT_CONFIGURED) y OBJETOS MALDITOS/ASMR (configurados) |
| Agent 2 | `VERIFIED` — sin cambios desde Fase 5.1, regresión completa en verde |
| ALZA provider | `VERIFIED` — sin cambios desde Fase 5.1, re-confirmado limpio en este cierre |
| External repo dependency | `VERIFIED = NONE` — `git ls-remote` vacío, grep de código limpio |
| Visteapy isolation | `VERIFIED` — `main`/`origin/main` en `f0c057d`, sin cambios |
| Tests | `PASS` (ver informe) |

## 8. Bloqueo real

Esta fase se detiene aquí porque el siguiente paso (auditoría de solo lectura
contra Supabase real, Sección 6 del encargo) requiere `NEXT_PUBLIC_SUPABASE_URL`
y `SUPABASE_SERVICE_ROLE_KEY`, que no existen en este worktree. No se
inventaron ni se solicitaron credenciales — este documento existe para que,
cuando esas credenciales estén disponibles (en un entorno controlado, nunca
compartidas en texto plano al asistente), la Fase 5.2 pueda retomarse
exactamente en la Sección 6 sin repetir el trabajo de código ya hecho aquí.
