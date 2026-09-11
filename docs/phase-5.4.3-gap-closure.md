# Fase 5.4.3 — Cierre de gaps de la auditoría Fase 5.4.2 y retiro de Flow A legacy

> Alcance: cerrar los 3 GAPs encontrados en la auditoría final pre-migración (Fase 5.4.2).
> Ningún cambio de esta fase aplica la migración de Supabase, activa `CLAIMED_AT_MIGRATION_APPLIED`,
> activa `DRY_RUN=false`, ni publica contenido real. Nada se commiteó ni se pusheó durante esta fase.

## GAP 1 — Flow A legacy con ejecución automática en GitHub Actions

**Hallazgo (Fase 5.4.2):** `.github/workflows/publish-social.yml` (cron cada 10 min,
`workflow_dispatch` habilitado) estaba pusheado a `agents-origin/main` (confirmado con
`git show agents-origin/main:.github/workflows/publish-social.yml`) y ejecutaba
`scripts/publish-due-social-posts.mts` — un script sin claim atómico condicionado a
`status='pending'` (su `UPDATE` marca `"publishing"` incondicionalmente por `id`), sin consulta de
`channel_status`, sin `DRY_RUN`, sin conocimiento de `PublicationOutcomeUncertainError` ni
`verification_required`. Existían 4 `social_posts` reales en `pending` con `scheduled_at` vencido,
usando cuentas activas (`is_active=true`) cuyo `channel_status='HISTORICAL'` — exactamente el
escenario que Flow B bloquea (Fase 5.2.1) pero que Flow A ignoraría por completo.

**Verificación adicional en esta fase (solo lectura, autorizada explícitamente):** las 4 filas
siguen exactamente igual que tras el revert de Fase 5.3 (`status=pending`, `retry_count=0`,
`error_message=null`, `external_post_id=null`, `published_at=null`) — sin ningún rastro de haber
sido procesadas por Flow A. Esto es evidencia indirecta (no prueba definitiva, requiere acceso a
GitHub Settings→Actions/Secrets que esta sesión no tiene) de que el cron probablemente no se
ejecutó con éxito contra datos reales — lo más probable es que falten los secrets
`NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` en el repositorio de GitHub, o que GitHub
Actions esté deshabilitado/pausado para este repo.

**Corrección aplicada:** `.github/workflows/publish-social.yml` → renombrado a
`.github/workflows/publish-social.yml.retired` (`git mv`). GitHub Actions solo reconoce workflows
bajo `.github/workflows/` con extensión `.yml`/`.yaml` exacta — al cambiar la extensión, el cron y
el disparo manual (`workflow_dispatch`) dejan de existir para GitHub, sin borrar ni una línea del
contenido original (incluido el propio cron, conservado como evidencia dentro del archivo). Se
añadió un bloque de comentario al inicio del archivo documentando el motivo y cómo reactivarlo
(`git mv` de vuelta + nueva autorización humana explícita).

**Confirmado que no existe un segundo mecanismo equivalente:**
- `Glob(".github/**/*")` → el único archivo bajo `.github/` en todo el repo es el ahora
  `publish-social.yml.retired`.
- Grep de `publish-due-social-posts` en todo el repo → únicamente referencias de documentación/
  comentarios (`run.mts`, `storageBridge.mts`, `supabaseClient.mts`, docs) y la entrada
  `"social:publish"` en `package.json` (invocación **manual** local, no automática — fuera del
  alcance de este GAP, ver nota abajo).
- Grep de `cron:`/`workflow_dispatch`/`schedule:` en todo el repo → sin más coincidencias
  relevantes (las de `package.json`/`run.mts`/tests son sobre `agent:schedule`/scheduling de
  contenido, sin relación con GitHub Actions).

**Fuera de alcance deliberadamente:** `package.json`'s `"social:publish": "tsx scripts/publish-due-social-posts.mts"`
sigue existiendo — es una invocación manual local (requiere que un humano ejecute
`npm run social:publish` con sus propias credenciales locales), no un mecanismo automático. La
instrucción de esta fase fue "retira solo la ejecución automática" — no se tocó.
`scripts/publish-due-social-posts.mts` en sí **no se modificó ni se borró** (regla vigente desde
Fase 5.0).

**Estado formal actualizado** en `docs/system-contracts.md` y `docs/technical-inventory.md`:
- **Flow A** — `LEGACY / RETIRED / NO AUTOMATIC EXECUTION`.
- **Flow B** (`agent/publish/run.mts`) — `UNIFIED PUBLICATION ENGINE`, único flujo de publicación
  autorizado.

## GAP 2 — `finishWithUncertainOutcome()` no comprobaba el resultado del UPDATE

**Hallazgo (Fase 5.4.2):** la función descartaba `{error}`/fila-afectada del `UPDATE` que escribe
`verification_required`. Si ese `UPDATE` falla (hoy, antes de la migración: `verification_required`
viola el `CHECK` constraint real), el fallo quedaba completamente silencioso — la fila se queda
huérfana en `'publishing'` sin ninguna señal en la tabla (el único rastro era el `log.warn` previo
en `run.mts`, sin log adicional sobre el fallo de persistencia en sí).

**Corrección aplicada:**
- `agent/publish/claimPost.mts::finishWithUncertainOutcome()` ahora usa exactamente el mismo patrón
  ya establecido en `markPublishAttemptStarted()`/`persistOperationRef()`/`recoverStaleClaims()`:
  `.eq("status","publishing").select("id").maybeSingle()`, comprueba `error` y `!data`, y en
  cualquiera de esos casos (o si el `await` mismo lanza) registra un `log.error(...)` con contexto
  completo (`postId`, `platform`, `operationRef`, `httpStatus`, motivo original, causa del fallo de
  persistencia) — persistido en `agent/logs/` (no solo consola), vía `agent/logger.mts`.
- **Deliberadamente NO relanza el error** hacia `run.mts`: para cuando se llega aquí, la acción
  irreversible ya pudo haber ocurrido (es la razón de ser de `PublicationOutcomeUncertainError`) —
  relanzar haría que un fallo de persistencia de ESTE post tumbe el ciclo completo de `main()` (el
  mismo riesgo de disponibilidad de GAP 3), sin ganar ninguna seguridad adicional: esta función
  nunca escribe `pending` ni llama a `publish()`, con o sin este fix.
- La lógica de qué loguear (`buildUncertainOutcomePersistFailureLog()`) se extrajo como función
  **pura** en `agent/publish/uncertainOutcome.mts` (mismo archivo, mismo patrón zero-Supabase-import
  ya usado por `buildUncertainOutcomeUpdatePayload()`/`buildPersistenceFailureError()`), para poder
  probarla sin conexión real.

## GAP 3 — `markPublishAttemptStarted()` sin aislamiento podía tumbar el ciclo completo

**Hallazgo (Fase 5.4.2):** el `await markPublishAttemptStarted(post.id, platform)` en `run.mts`
vivía fuera de cualquier `try/catch`. Si el `UPDATE` del checkpoint lanzaba, la excepción escapaba
de `processPost()` sin capturar, llegaba a `main()` (invocado sin `.catch()`) y terminaba **todo el
ciclo** — dejando sin procesar cualquier otro post vencido de esa corrida, sin relación con el
fallo original. El publisher real no se llegaba a invocar (correcto), pero el efecto colateral de
disponibilidad no era aceptable.

**Corrección aplicada:** se envolvió la llamada en su propio `try/catch` dentro de `processPost()`,
exactamente con el mismo patrón ya usado unas líneas arriba para `ensureUploadedToStorage()`:

```ts
try {
  await markPublishAttemptStarted(post.id, platform);
} catch (err) {
  log.error("[PUBLISH] Fallo el checkpoint markPublishAttemptStarted - el publisher NO se invoca", {...});
  await finishWithFailure(post, err instanceof Error ? err.message : String(err), true);
  return;
}
```

- El `return` dentro del `catch` hace que la línea que llama a `publish()` sea estructuralmente
  inalcanzable si el checkpoint falla — el publisher real **nunca se invoca**.
- Se clasifica como fallo **retryable** vía `finishWithFailure()` (el mecanismo ya existente,
  reutilizado sin cambios) — **nunca** `verification_required`: en este punto la acción
  irreversible/pública todavía no pudo haber ocurrido (el checkpoint es deliberadamente anterior a
  `publish()`), así que no hay ninguna incertidumbre real que preservar.
- Al vivir la captura **dentro** de `processPost()` (no en el nivel de `main()`), una excepción de
  un post ya no puede escapar hacia el bucle `for (const row of dueRows) { await processPost(row.id); }`
  — el resto de posts del mismo ciclo se siguen procesando con normalidad.

## Tests añadidos (Fase 5.4.3)

`agent/publish/test-gap-closure-5.4.3.mts` (`npm run gap-closure-5.4.3:test`), 13 casos:
- GAP 2: `buildUncertainOutcomePersistFailureLog()` — con causa de tipo "UPDATE devolvió `{error}`"
  y con causa de tipo "UPDATE lanzó excepción" — verifica que el mensaje nunca sugiere
  pending/reintento, y que conserva `postId`/`platform`/`operationRef`/causa real.
- GAP 1 (TEST 5 del pedido original): verificación real de filesystem — el workflow activo ya no
  existe, el `.retired` existe y conserva el cron original como evidencia, y no existe ningún otro
  `.yml`/`.yaml` bajo `.github/workflows/`.
- GAP 3: **no tiene test automatizado** — la propiedad exacta ("el checkpoint fallido no permite
  llegar a `publish()`, y el resto del ciclo de `main()` sigue") vive enteramente dentro de
  `processPost()`/`main()`, que no son exportables sin disparar `main()` contra Supabase real al
  importar el módulo (mismo límite arquitectónico, ya documentado, que impidió automatizar TEST
  10/11 en Fase 5.4.1). Se verifica por **inspección de código** explícita (citada arriba, con
  números de línea) en vez de fabricar una prueba que requeriría mockear la cadena completa de
  Supabase o reestructurar `run.mts` — fuera del alcance de un cierre quirúrgico de gaps.

Regresión completa re-ejecutada tras los cambios: `tsc --noEmit`, `uncertain-outcome:test`,
`claim-recovery:test`, `publish-authorization:test`, `machine:test`, `provider:test`,
`derived-content:test`, `ingestion:test`, `gap-closure-5.4.3:test`, `remotion compositions` — todos
🟢.

## Verificación read-only de Supabase (Fase E, autorizada explícitamente)

Confirmado con una consulta SELECT-only (sin ningún UPDATE/INSERT/DELETE, script temporal borrado
inmediatamente después de ejecutarse): las 4 `social_posts` reales siguen exactamente igual que al
cierre de Fase 5.3/5.4.2 — `status='pending'`, `retry_count=0`, `error_message=null`,
`external_post_id=null`, `published_at=null`. `claimed_at`/`publisher_operation_ref`: no aplican
(columnas no existen todavía, migración no aplicada). Ningún cambio de Supabase ocurrió en esta
fase.

## Veredicto de esta fase

🟢 **GAPS 1–3 CORREGIDOS — LISTO PARA AUDITORÍA FINAL PRE-MIGRACIÓN.**

Esto **no** es "SAFE TO MIGRATE" — es la confirmación de que los 3 gaps concretos de Fase 5.4.2
quedaron cerrados con evidencia real (código + tests + regresión + verificación read-only), y que
el sistema está listo para que se repita una auditoría adversarial final (nueva Fase 5.4.4 o
equivalente) antes de decidir sobre la migración de Supabase en sí.
