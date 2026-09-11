# Fase 5.2.1 — Cierre del contrato de identidad y channel_status

Corrección pequeña y controlada sobre el gap detectado en
[`phase-5.2-supabase-verification.md`](phase-5.2-supabase-verification.md) §3:
`content_accounts.channel_status` gateaba el RENDER (vía
`scripts/pipeline/channelRegistry.mts`) pero no se leía en ningún punto de la
ruta de PUBLICACIÓN de Agent 3.

## 1. Auditoría del flujo existente (código real, sin suposiciones)

```
Agent 3 Flow B (agent/publish/run.mts::processPost)
  1. claimPost(postId)                                    — claimPost.mts:19 (claim atómico, UPDATE condicional)
  2. resolveAndVerifyContentFile(post.content_file_id)     — resolveContentFile.mts (conoce content_account_id vía content_files)
  3. resolveAndValidateIdentity(account_id, contentAccountId) — resolveIdentity.mts:13
       - fetch social_accounts (conoce channel_id, is_active, credentials)
       - fetch content_accounts (conoce channel_id) — [Fase 5.2.1: ahora también channel_status]
       - content_account.channel_id === social_account.channel_id ? si no, ok:false
       - [Fase 5.2.1 — NUEVO] evaluateChannelAuthorization(channel_status) — bloquea BLOCKED/HISTORICAL aquí
  4. entrega al publisher (storage o directo)
  5. if (DRY_RUN || !authorizedForRealPublication) → revertToPending, return   — [Fase 5.2.1: condición extendida]
  6. else: PUBLISHERS[platform](...) — publicación REAL
```

`channel` se conoce indirectamente por `channel_id` (no hay una tabla
"channel" separada de `content_accounts`/`social_accounts` — ambas
referencian `social_channels.id`, ver `supabase/schema.sql`). `channel_status`
vive en `content_accounts`, no en `social_accounts` ni en `social_channels`.

## 2. Decisión de diseño

**No se introdujo una función `resolvePublicationAuthorization()` nueva y
separada.** `resolveAndValidateIdentity()` YA es, por diseño y por su propio
comentario ("defensa en profundidad... si algo no cuadra exactamente, NO
PUBLICAR"), el punto único de autorización antes de publicar — extenderlo
para que también lea y valide `channel_status` es coherente con su
responsabilidad existente, no una responsabilidad nueva. Añadir una función
aparte solo para envolver esto habría sido duplicar la misma llamada a
`content_accounts` que `resolveAndValidateIdentity` ya hace.

Lo que sí se extrajo a un archivo nuevo, pequeño, es la DECISIÓN pura —
`evaluateChannelAuthorization(channelStatus)` en
`agent/publish/channelAuthorization.mts` — por una razón puramente técnica,
no de preferencia de diseño: `resolveIdentity.mts` importa
`supabaseClient.mts`, que construye el cliente Supabase real en el momento
del import y **lanza `Error: supabaseUrl is required` de inmediato** si
faltan las credenciales (confirmado ejecutándolo en este worktree). Si la
función de decisión viviera dentro de `resolveIdentity.mts`, sería imposible
probarla sin credenciales reales — exactamente lo que la Sección 9 del
encargo pide evitar. Separarla en su propio archivo sin ese import es lo que
la hace probable en aislamiento.

## 3. Regla de identidad (sin cambios de comportamiento)

`content_account.channel_id === social_account.channel_id` sigue siendo
obligatorio, con el mismo bloqueo explícito de siempre — no se tocó esa
comparación, solo se agregó `channel_status` a la misma consulta que ya
traía `channel_id`.

## 4. Regla de channel_status (decisión explícita, no ambigua)

| Estado | ¿Bloquea el resto del flujo? | ¿Autoriza publicación real? |
|---|---|---|
| `ACTIVE` | No | **Sí** — único estado que autoriza, sujeto a los demás controles (DRY_RUN, credenciales, claim) |
| `READY` | No | No — contrato ambiguo (el render sí lo trata como producible; ningún documento define READY como autorización de publicación real). Opción segura elegida explícitamente: mismo tratamiento que TEST. |
| `TEST` | No | No — nunca, independientemente del valor global de `DRY_RUN` |
| `BLOCKED` | **Sí — bloqueo explícito** (`ok: false`, nunca llega a claim/publish) | No |
| `HISTORICAL` | **Sí — bloqueo explícito** | No |
| ausente/desconocido | No (defensivo — no debería ocurrir, el `CHECK` constraint del schema solo permite los 5 valores de arriba) | No |

No se inventó ningún estado nuevo — son exactamente los 5 ya declarados en
`supabase/schema.sql`.

## 5. Seguridad — channel_status nunca es el único control

La condición real en `agent/publish/run.mts` (línea donde antes solo estaba
`if (DRY_RUN)`):

```ts
if (DRY_RUN || !identityOutcome.authorizedForRealPublication) {
  // revierte a pending, nunca llama al publisher real
}
```

Esto es un AND, no un reemplazo: la publicación real solo procede cuando
`DRY_RUN === false` **Y** `authorizedForRealPublication === true`. Ninguna de
las dos condiciones basta por sí sola. Todo lo demás que ya bloqueaba
publicación (`social_account.is_active`, credenciales, publisher
implementado, `channel_id` coincidente, claim atómico ganado) sigue intacto,
sin tocar.

## 6. Cambios realizados

| Archivo | Cambio |
|---|---|
| `agent/publish/channelAuthorization.mts` | **Nuevo.** `evaluateChannelAuthorization()` pura, sin imports de Supabase. |
| `agent/publish/resolveIdentity.mts` | `select` de `content_accounts` ahora incluye `channel_status`; llama a `evaluateChannelAuthorization()`; `IdentityOutcome.ok:true` gana `channelStatus` y `authorizedForRealPublication`. Sin `contentAccountId` (origen manual): `authorizedForRealPublication: false` por seguridad (no hay forma de confirmar ACTIVE). |
| `agent/publish/run.mts` | La condición que gateaba `DRY_RUN` ahora también exige `identityOutcome.authorizedForRealPublication`. |
| `agent/publish/test-publication-authorization.mts` | **Nuevo.** 15 casos reales, sin Supabase. |
| `package.json` | script `publish-authorization:test`. |

**No se tocó**: `claimPost.mts`, `resolveContentFile.mts`, `storageBridge.mts`,
`retryPolicy.mts`, `agent/schedule/*`, ningún schema/migración, Flow A,
Agent 1, Agent 2.

## 7. Tests

`npm run publish-authorization:test` — 15/15 `PASS`, cubre:
ACTIVE (autorizado), BLOCKED (bloqueado, motivo explícito), HISTORICAL
(bloqueado), TEST (no bloqueado, nunca autorizado), READY (no bloqueado, no
autorizado — decisión documentada), valor ausente (seguro por defecto), y la
combinación con `DRY_RUN` (ACTIVE+DRY_RUN=true sigue sin publicar;
TEST+DRY_RUN=false tampoco publica; solo ACTIVE+DRY_RUN=false publicaría).

**Lo que NO se pudo probar en este worktree** (Casos 5/6/7 del encargo:
mismatch de `channel_id`, `social_account` inexistente, y que `DRY_RUN`
nunca invoque el publisher real dentro de `resolveAndValidateIdentity()`/
`run.mts` completos): esos dos archivos importan `supabaseClient.mts`, que
lanza al importarse sin credenciales — confirmado directamente. Esa lógica
NO fue modificada en esta fase (ya existía y fue revisada por inspección de
código en Fase 5.2) y sigue `NOT VERIFIED` contra ejecución real, igual que
el resto de Agent 3 Flow B, hasta que existan credenciales de Supabase.
Introducir un cliente Supabase falso para poder importarlos habría requerido
refactorizar `resolveAndValidateIdentity`/`claimPost`/`run.mts` hacia
inyección de dependencias — fuera del alcance de una "corrección mínima".

## 8. Estado final de esta fase

- `IDENTITY`: `IMPLEMENTED` (channel_status es ahora parte del contrato, en
  código, probado sin Supabase) — `NOT VERIFIED AGAINST REAL SUPABASE` **en el
  momento en que se escribió esta fase**.
- `PUBLICATION AUTHORIZATION`: `IMPLEMENTED` — `NOT VERIFIED AGAINST REAL SUPABASE` **en el momento en que se escribió esta fase**.
- `SUPABASE`: `NOT VERIFIED` **en el momento en que se escribió esta fase** (sin credenciales, sin cambios en esta fase).
- `PUBLICACIÓN REAL`: `OFF` (sin cambios).

**Actualización — Fase 5.2.2 (VERIFICADO EN SUPABASE REAL):** con credenciales
reales disponibles, se aplicó el `ALTER TABLE` que esta fase ya había dejado
como cambio de schema pendiente (`supabase/schema.sql` líneas 52-57, sin
modificar), y se re-ejecutó `resolveAndValidateIdentity()` (solo lectura)
contra un `social_post` real — el resultado pasó de un error de schema
("content_account no encontrada") al bloqueo de negocio correcto
("channel_status='HISTORICAL' no autoriza publicación"). El código de esta
fase (`channelAuthorization.mts`, `resolveIdentity.mts`, `run.mts`) **no
necesitó ningún cambio** — funcionó exactamente como estaba escrito, sin
workarounds relacionados con la ausencia de la columna. Detalle completo en
[`phase-5.2-supabase-verification.md`](phase-5.2-supabase-verification.md) §10.

- `IDENTITY`: **`VERIFIED AGAINST REAL SUPABASE`**.
- `PUBLICATION AUTHORIZATION`: **`VERIFIED AGAINST REAL SUPABASE`** (el gate bloquea correctamente; el camino positivo con `channel_status='ACTIVE'` sigue sin datos reales que lo autoricen — ningún canal está en `ACTIVE`).
- `SUPABASE`: **`VERIFIED`** (conexión real, schema real, datos reales).
- `PUBLICACIÓN REAL`: `OFF` (sin cambios — ningún canal fue promovido).
