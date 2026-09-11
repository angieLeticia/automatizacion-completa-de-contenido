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

**Actualización — Fase 5.2.2 (VERIFICADO EN SUPABASE REAL):** con la Secret key
correcta (`sb_secret_...`, la anterior tenía cargada por error la Publishable
key, lo que causaba que RLS devolviera arrays vacíos sin error — ver §10),
`content_accounts.channel_status` fue agregado en producción exactamente con
el `ALTER TABLE` que este documento ya proponía, y `resolveAndValidateIdentity()`
se ejecutó de verdad (solo lectura, sin `claimPost`) contra un `social_post`
real de SIN EXPLICACIÓN. Resultado antes/después:
- Antes del `ALTER TABLE`: `{"ok": false, "reason": "No se pudo verificar consistencia de canal: content_account id=... no encontrada."}` — error de schema (columna ausente), mensaje engañoso.
- Después: `{"ok": false, "reason": "El canal tiene channel_status='HISTORICAL' - no autorizado para publicación."}` — el gate de negocio correcto, real.

Estado: `IDENTITY: VERIFIED AGAINST REAL SUPABASE` — tanto la lógica de
`channel_id` como el gate de `channel_status` fueron ejercitados contra datos
reales, con el resultado esperado por el contrato de código. El caso positivo
(`channel_status='ACTIVE'` autorizando de verdad) sigue sin datos reales que
lo ejerciten — ningún canal real está en `ACTIVE` (los 3 quedaron en
`HISTORICAL`, el default seguro) — ver §10.

## 4. Scheduling — hallazgo de auditoría estática

`agent/schedule/findNextWindow.mts` consulta `posting_schedule_rules`
(filtrando por `content_account_id` o regla global cuando esa columna es
`NULL`, `platform`, `day_of_week`, `window_start`) — no hay horarios
hardcodeados en código. El comportamiento sin regla encontrada no se pudo
ejercitar sin datos reales (`NOT VERIFIED`).

**Actualización — Fase 5.2.2 (VERIFICADO EN SUPABASE REAL):** `posting_schedule_rules`
tiene 3 reglas reales (globales, `content_account_id=null`): YouTube 12:00-14:00
(1/día), Instagram 12:00-14:00 (2/día), Facebook 15:00-17:00 (2/día), todas
`is_active=true`. `findNextAvailableWindow()` real (solo lectura) devolvió una
ventana válida real (`2026-09-11T18:00:00Z`, regla YouTube) usando estos datos
— no inventa horarios, no hay fallback hardcodeado.

Estado: `SCHEDULING: VERIFIED AGAINST REAL SUPABASE` (camino positivo, con
regla real). El camino "sin regla para una plataforma" también se verificó
antes (con la base todavía vacía) devolviendo el error explícito esperado.

## 5. Agent 3 — Flow B (auditoría estática de `claimPost.mts`, `run.mts`)

- **Claim atómico**: `UPDATE social_posts SET status='publishing' WHERE id=? AND status='pending'` — atómico por semántica de Postgres bajo READ COMMITTED (lock de fila + re-evaluación del WHERE), sin necesitar función RPC. Ya documentado y ya implementado — no se construyó un segundo mecanismo.
- **DRY_RUN**: `export const DRY_RUN = process.env.DRY_RUN !== "false"` (`agent/publish/config.mts:13`) — con la variable ausente (como está aquí), el valor es `true` por defecto: **seguro por diseño**, confirmable por lectura directa del código sin necesitar ejecutarlo contra Supabase real.
- **Claims huérfanos**: `recoverStaleClaims()` existe pero está intencionalmente inerte (`CLAIMED_AT_MIGRATION_APPLIED=false` por defecto). **Corrección — Fase 5.2.2**: `claimed_at` **sí existe** ya en la base real (confirmado por lectura directa); lo que sigue en `false` es el flag de código, no la columna. Esto es una preocupación de **recuperación de claims huérfanos**, separada de la atomicidad del claim en sí (ver actualización de Fase 5.3 abajo) — no se modifica en esta fase.

**Actualización — Fase 5.3 (VERIFICADO EN SUPABASE REAL — Atomic Claim):**
prueba real, controlada y reversible: se insertó una fila temporal aislada en
`social_posts` (`account_id` de una cuenta `[PRUEBA FASE 4A]` real,
`content_file_id=NULL` para no interactuar con el índice de idempotencia ni
con ningún dato real, `scheduled_at` en 2036 para que nunca sea recogida por
`run.mts::main()`), y se ejecutaron dos llamadas HTTP reales y genuinamente
concurrentes (`Promise.all([claimPost(id), claimPost(id)])`) contra esa fila.

Resultado: **exactamente un ganador** (`status='publishing'` confirmado por
lectura independiente posterior) y **exactamente un `null`**. Los 4
`social_posts` reales permanecieron intactos durante toda la prueba
(verificado antes y después). La fila temporal se eliminó por `id` exacto
(`DELETE`, 1 fila afectada) — conteos finales confirmados sin cambio:
`content_accounts=3`, `content_files=58`, `social_posts=4`.

La garantía demostrada proviene **exclusivamente de la operación `UPDATE`
condicional ejecutada por PostgreSQL** (lock de fila + re-evaluación del
`WHERE` tras adquirir el lock) — no de un `SELECT` previo, no de un lock de
aplicación, no de una función RPC. Esta evidencia demuestra la atomicidad del
claim concurrente **sobre una misma fila ya existente**; no dice nada sobre
la creación de filas duplicadas (esa es una protección distinta, ver más
abajo) ni sobre la recuperación de claims huérfanos (`recoverStaleClaims()`,
todavía inerte, sin cambios).

Estado: `ATOMIC CLAIM: VERIFIED AGAINST REAL SUPABASE`.

**Actualización — Fase 5.2.2:** se confirmaron contra datos reales, por separado
y solo lectura, las piezas que componen Flow B: identidad (`resolveAndValidateIdentity()`,
ver §3), scheduling (`findNextAvailableWindow()`, ver §4), y conteos/estado
reales de los 4 `social_posts` (`pending`, `retry_count=0`, sin error). **No
se ejecutó el orquestador completo (`agent:publish`/`run.mts::processPost()`)
de punta a punta contra estos 4 posts reales** — antes del `ALTER TABLE` esto
habría escrito un resultado incorrecto y no reversible (`status='error'` por
un fallo de schema, no por DRY_RUN); después del `ALTER TABLE` no se volvió a
intentar, porque `claimPost()` sí es una escritura real y no estaba autorizada
en esta fase.

**Actualización — Fase 5.3 (E2E real ejecutado, VERIFICADO):** con
autorización explícita, se ejecutó `npm run agent:publish` (el orquestador
real, sin modificar) contra los 4 `social_posts` reales y vencidos.
Resultado real, extraído del propio log del código:

```
[PUBLISH] 4 publicacion(es) vencida(s) encontradas.
[PUBLISH] Claim ganado {"postId":"...","dryRun":true}          (x4)
[PUBLISH] Fallo - NO PUBLICAR {"reason":"El canal tiene channel_status='HISTORICAL'
          - no autorizado para publicación.","retryable":false,"nextStatus":"error"} (x4)
[PUBLISH] Ciclo finalizado.
```

Los 4 posts: (1) `claimPost()` ganó correctamente (atomicidad ya `VERIFIED`
por separado, ver arriba); (2) `resolveAndVerifyContentFile()` pasó (el
archivo real existe y su hash coincide); (3) `resolveAndValidateIdentity()`
evaluó `channel_status='HISTORICAL'` y bloqueó, **antes de llegar a
DRY_RUN o a cualquier publisher**; (4) `finishWithFailure()` dejó los 4 en
`status='error'`, `error_message` con el motivo exacto. Confirmado por
lectura: **`external_post_id=null` y `published_at=null` en los 4** — ninguna
API de YouTube/Instagram/Facebook fue invocada, no hubo publicación real.
`DRY_RUN` permaneció `true` durante toda la ejecución (nunca se llegó a
evaluarlo, porque el bloqueo de canal ocurre antes).

**Esto es el comportamiento correcto y esperado, no un fallo**: SIN
EXPLICACIÓN está `HISTORICAL`, así que el sistema está obligado a rechazar
la publicación — que lo haya hecho, con un motivo explícito y sin publicar
nada, es exactamente lo que `channelAuthorization.mts` (Fase 5.2.1) fue
diseñado a garantizar.

Con autorización explícita adicional, los 4 posts fueron restaurados
después, vía `UPDATE` real y acotado a esos 4 `id`, a su estado exacto
anterior al E2E (`status='pending'`, `retry_count=0`, `error_message=null`)
— verificado por lectura independiente: coincide exactamente con el
snapshot tomado antes del E2E, y el conteo total de `social_posts` siguió
siendo 4 (ningún otro post afectado).

Estado: `PROCESSPOST() E2E: BLOCKED BY EXPECTED AUTHORIZATION` — el flujo
atravesó claim → resolución de archivo → identidad, y se detuvo
correctamente en el gate de `channel_status`. **No se declara el sistema
"production-ready"** — solo se demuestra que este gate específico funciona
como debe contra datos reales, para el único canal con datos de prueba
completos hoy (SIN EXPLICACIÓN, `HISTORICAL`). El camino con
`channel_status='ACTIVE'` (publicación real efectivamente autorizada) sigue
sin ningún dato real que lo ejercite.

`AGENT 3 FLOW B` — estado final: identidad, scheduling, claim atómico y el
recorrido completo de `processPost()` (bloqueado como corresponde) quedan
`VERIFIED AGAINST REAL SUPABASE`; el único camino que sigue sin datos reales
es el positivo (`ACTIVE` → publicación real), que requeriría activar un
canal — decisión humana, no tomada.

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

**Actualización — Fase 5.2.2 (segunda ronda, VERIFICADO EN SUPABASE REAL):**
se pidió al usuario correr `SELECT ... FROM pg_indexes WHERE tablename IN
('content_files','social_posts')` — reveló que `content_files.file_hash`
**sí tenía** su índice único real (`content_files_file_hash_key`), pero
`social_posts_content_file_account_idx` (el índice único parcial sobre
`(content_file_id, account_id)`) **no existía** en producción, pese a estar
declarado en `supabase/schema.sql` líneas 168-169 con el mismo comentario
`[NUEVO — Fase 2.1/4.1, no aplicado aún en producción]` que tenía
`channel_status` antes de aplicarse — un gap ya auto-documentado por el
propio repo, no una inconsistencia nueva. `docs/system-contracts.md §1` ya
señalaba esto mismo desde la fase de diseño ("Fase 2"): idempotencia de
publicación solo existía como chequeo de aplicación en
`scheduleContent.mts:65-92` (`SELECT` antes de `INSERT`), con ventana de
carrera real si dos ejecuciones de `agent:schedule` corrieran superpuestas
(dentro de una sola ejecución no hay riesgo — `run.mts` procesa
secuencialmente, sin paralelismo).

El usuario ejecutó, una sola vez, exactamente el `CREATE UNIQUE INDEX` que el
repo ya declaraba — comando exitoso (`Success. No rows returned`), sin
conflicto (ya se había confirmado antes, por lectura, que los 4
`social_posts` reales tenían pares `(content_file_id, account_id)`
distintos). **Confirmado por catálogo real** vía `pg_indexes`:

```
schemaname=public tablename=social_posts indexname=social_posts_content_file_account_idx
indexdef=CREATE UNIQUE INDEX social_posts_content_file_account_idx ON public.social_posts
         USING btree (content_file_id, account_id) WHERE (content_file_id IS NOT NULL)
```

Precisión técnica: es un **UNIQUE PARTIAL INDEX** (no un `CONSTRAINT` con
nombre en `pg_constraint`, por eso no apareció en esa consulta anterior) —
Postgres lo aplica exactamente igual que un constraint para efectos de
integridad (rechaza cualquier `INSERT`/`UPDATE` que produzca un par
`(content_file_id, account_id)` duplicado, mientras `content_file_id` no sea
`NULL`), solo que declarado como índice.

Estado: `IDEMPOTENCY (content_files.file_hash): VERIFIED AGAINST REAL SUPABASE`.
`IDEMPOTENCY (social_posts content_file_id+account_id): VERIFIED AGAINST REAL
SUPABASE` (UNIQUE PARTIAL INDEX, confirmado por `pg_indexes`).

## 7. Matriz de estado (Sección 20 del encargo)

| Área | Estado |
|---|---|
| Supabase connection | `VERIFIED` — Fase 5.2.2, con la Secret key real (`sb_secret_...`), las 8 tablas del contrato responden y los conteos coinciden exactamente con el Dashboard |
| Schema real (`channel_status`) | `VERIFIED` — agregado vía `ALTER TABLE` real, tipo/DEFAULT/CHECK confirmados (`pg_constraint`), 3 filas reales en `HISTORICAL` |
| Identity (lógica) | `VERIFIED AGAINST REAL SUPABASE` — ver §3/§10 |
| Channel identity isolation | `VERIFIED` — SIN EXPLICACIÓN: 3/3 `social_accounts` coinciden en `channel_id`; OBJETOS MALDITOS/LUNA VERDE: 0 coinciden (coherente, sin cuentas sociales todavía) |
| Scheduling | `VERIFIED AGAINST REAL SUPABASE` — ver §4 |
| Atomic claim | `VERIFIED AGAINST REAL SUPABASE` — Fase 5.3, dos `claimPost()` reales concurrentes sobre una fila temporal aislada, exactamente un ganador/un `null` (ver §5) |
| Idempotency — archivo (`file_hash`) | `VERIFIED` — `pg_indexes` real, `content_files_file_hash_key` (ver §6) |
| Idempotency — publicación (`content_file_id`+`account_id`) | `VERIFIED` — `pg_indexes` real, `social_posts_content_file_account_idx` (UNIQUE PARTIAL INDEX, ver §6) |
| Agent 3 Flow B / `processPost()` E2E | `BLOCKED BY EXPECTED AUTHORIZATION` — E2E real ejecutado, bloqueado correctamente en `channel_status='HISTORICAL'`, sin publicación real, restaurado después (ver §5). NO es production-ready — falta el camino positivo con un canal `ACTIVE` real |
| DRY_RUN | `VERIFIED` — por default de código (`DRY_RUN !== "false"`), reconfirmado por log real en una ejecución anterior de `agent:publish` |
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

## 9. Fase 5.2.2 — re-chequeo de credenciales

Re-verificado al inicio de Fase 5.2.2 (2026-09-10, mismo worktree):
`NEXT_PUBLIC_SUPABASE_URL` = `MISSING`, `SUPABASE_SERVICE_ROLE_KEY` = `MISSING`,
`.env.local` sigue sin existir en disco. Sin cambio de estado desde el cierre
de Fase 5.2. Por regla explícita de Fase 5.2.2 ("si alguna falta, detente en
la parte que requiera conexión real"), la fase completa de verificación en
vivo (Secciones 3-19 de su encargo: solo-lectura, auditoría de schema real,
content_accounts/social_accounts reales, identity/channel_status/scheduling/
idempotencia/atomic claim/Flow B contra datos reales, E2E) queda `BLOCKED` —
ninguna requiere una decisión de diseño ni fue "no se pudo demostrar", sino
que ninguna pudo siquiera intentarse por ausencia de credenciales. Ningún
código fue modificado en Fase 5.2.2 — nada que verificar en vivo pudo
ejecutarse.

## 10. Fase 5.2.2 — cierre real (VERIFICADO EN SUPABASE REAL)

Una vez cargadas las credenciales reales en `.env.local` (nunca vistas por mí
en texto plano), el desbloqueo de §9 avanzó en varias rondas:

1. **Primer intento — falso 0**: la conexión inicial mostraba las 8 tablas
   existentes pero con 0 filas. Diagnóstico real: `SUPABASE_SERVICE_ROLE_KEY`
   tenía cargada la **Publishable key** (`sb_publishable_...`, prefijo
   confirmado leyendo solo los primeros 10 caracteres, nunca el valor
   completo) en vez de la **Secret key** (`sb_secret_...`). Con la
   Publishable key, RLS (`content_accounts` tiene una política
   `USING (false)` — solo bypasseable por `service_role` real) filtra todo a
   arrays vacíos sin ningún error visible.
2. **Corregida la clave**: conteos reales confirmados, coincidiendo
   exactamente con el Dashboard del usuario: `content_accounts=3`,
   `content_file_conflicts=7`, `content_files=58`, `content_metadata=3`,
   `posting_schedule_rules=3`, `social_accounts=3`, `social_posts=4`.
3. **`channel_status` confirmado ausente** en la base real (`42703`,
   confirmado por REST de forma independiente al SQL Editor del usuario).
4. **`ALTER TABLE` aplicado por el usuario** en el SQL Editor de Supabase —
   exactamente el SQL que este documento ya proponía (`supabase/schema.sql`
   líneas 52-57), una sola sentencia. Un primer intento produjo
   `42701 column already exists` sin que la columna existiera en el catálogo
   (`pg_attribute` sin residuo de columna borrada) — explicado como una
   doble ejecución dentro de la misma transacción, revertida entera al
   fallar la segunda ocurrencia; no afectó el resultado final.
5. **Verificación post-DDL, solo lectura**: columna accesible, las 3 filas
   con `channel_status='HISTORICAL'` (el DEFAULT seguro, tal como el propio
   comentario del schema exige — "nunca debe activar un canal por sí solo"),
   `CHECK` confirmado por el usuario vía `pg_constraint`
   (`content_accounts_channel_status_check`, exactamente los 5 valores),
   58 `content_files` y 4 `social_posts` intactos (`pending`, `retry_count=0`,
   sin error).
6. **`resolveAndValidateIdentity()` real** (solo lectura, sin `claimPost`) —
   ver §3 para el resultado antes/después.

**Nada de esto activó publicación real ni cambió el estado de ningún canal.**
Los 3 `content_accounts` quedaron en `HISTORICAL` — el estado más restrictivo
posible, igual de bloqueado que `BLOCKED` para efectos de autorización
(`channelAuthorization.mts`).

`PUBLICACIÓN REAL = OFF`. `DRY_RUN = TRUE`. Ningún `INSERT`/`UPDATE`/`DELETE`
fue ejecutado por mí en ningún momento de esta fase — todos los `SELECT`
fueron de solo lectura; el único DDL (`ALTER TABLE`) fue ejecutado por el
usuario directamente en el SQL Editor de Supabase, nunca por mí (no tengo
capacidad de ejecutar DDL con las credenciales REST disponibles).

## 11. Fase 5.3 — Atomic Claim: distinción de protecciones y pendientes

**Dos protecciones distintas, ambas `VERIFIED`, ninguna sustituye a la otra:**

| | Protege contra | Mecanismo | Opera en |
|---|---|---|---|
| **A. Idempotencia de scheduling/publicación** | Crear dos filas `social_posts` distintas para el mismo `(content_file_id, account_id)` | `UNIQUE PARTIAL INDEX social_posts_content_file_account_idx ... WHERE content_file_id IS NOT NULL` | `scheduleContent.mts`, al `INSERT` |
| **B. Atomic Claim** | Que dos workers reclamen (`status: pending→publishing`) la MISMA fila ya existente | `UPDATE social_posts SET status='publishing' WHERE id=$1 AND status='pending'` | `claimPost.mts`, al `UPDATE` |

**Sobre `claimed_at`/`recoverStaleClaims()` (no modificado en esta fase):**
la columna `claimed_at` existe en la base real desde antes (Fase 5.2.2); el
código sigue sin escribirla (`CLAIMED_AT_MIGRATION_APPLIED=false`), así que
`recoverStaleClaims()` permanece inerte. Esto es una preocupación de
**recuperación de claims huérfanos** (qué pasa si un proceso muere entre
`claimPost()` y terminar de publicar) — separada de la atomicidad del claim
en sí, que ya quedó `VERIFIED` sin depender de `claimed_at` en absoluto.
Activar esa bandera es una decisión y un cambio de código explícitamente
pendientes, no hechos aquí.

**Sobre convertir la prueba en test de integración permanente (decisión
pendiente, no ejecutada):** requeriría, como mínimo: credenciales reales de
Supabase disponibles en el entorno de CI, un mecanismo de escritura+cleanup
real (INSERT temporal + DELETE, igual al usado en esta fase), aislamiento
garantizado frente a datos de producción, y — idealmente — una `social_account`
dedicada exclusivamente a pruebas (en vez de depender de que las cuentas
`[PRUEBA FASE 4A]` sigan existiendo con los mismos IDs). Los tests
unitarios/locales existentes (`machine:test`, `provider:test`,
`derived-content:test`, `publish-authorization:test`, `ingestion:test`)
deben seguir sin red, tal como están — este test de integración, si se
agrega, sería una categoría nueva y separada, no una extensión de esas.
