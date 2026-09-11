# Fase 5.4 — Recuperación segura de claims

Implementa el diseño auditado y aprobado en la fase anterior. **Publicación
real sigue `OFF`, `DRY_RUN=true`, ningún canal activado.** Todo lo descrito
aquí es código nuevo, gateado detrás de `CLAIMED_AT_MIGRATION_APPLIED`
(default `false`, sin cambios) — inerte en producción hasta que se apliquen
las migraciones de schema y alguien active el flag explícitamente.

## 1. Qué se implementó

| Pieza | Archivo | Estado |
|---|---|---|
| `verification_required` (estado nuevo) | `agent/publish/types.mts` | `IMPLEMENTED` |
| `publisher_operation_ref` (campo nuevo) | `agent/publish/types.mts`, `supabase/schema.sql` (propuesto) | `IMPLEMENTED` en código / `NOT APPLIED` en producción |
| `classifyStaleClaim()` (lógica pura CASO A vs B/C) | `agent/publish/staleClaimClassification.mts` | `VERIFIED` — 21 casos, sin Supabase |
| `markPublishAttemptStarted()` / `persistOperationRef()` (checkpoint) | `agent/publish/claimPost.mts` | `IMPLEMENTED`, gateado, `NOT VERIFIED AGAINST REAL SUPABASE` (requiere la columna nueva) |
| `recoverStaleClaims()` (5 casos A-E) | `agent/publish/claimPost.mts` | `IMPLEMENTED`, gateado, `NOT VERIFIED AGAINST REAL SUPABASE` (requiere la columna nueva) |
| Conectado a `run.mts::main()` | `agent/publish/run.mts` | `IMPLEMENTED` — mismo patrón ya probado en `agent/analyze/run.mts:28` |
| `reconcileUnknownPublication()` + mapeos puros por plataforma | `agent/publish/reconciliation.mts` | Mapeos puros `VERIFIED` (10 casos); las funciones que llaman a la plataforma real (`reconcileYouTube`/`reconcileInstagram`) `NOT VERIFIED AGAINST REAL PLATFORM` (sin credenciales OAuth) |
| Callback `onOperationRef` en YouTube/Instagram | `lib/social/{youtube,instagram}.ts`, `lib/social/publishers.ts` | `IMPLEMENTED`, aditivo — firma de `Publisher` sin romper compatibilidad; Facebook nunca lo llama |

## 2. Semántica exacta de `publisher_operation_ref`

- `NULL`: el publisher real **nunca pudo haberse llamado** para este claim — es una garantía, no una suposición, porque `markPublishAttemptStarted()` se llama para **todas** las plataformas (incluida Facebook) inmediatamente antes de invocar `publish()`, estrictamente después del `return` del branch de `DRY_RUN`/`channel_status`.
- `"pending:<platform>"`: se marcó el intento pero no hay (todavía, o nunca habrá — Facebook) una referencia real de la plataforma.
- Cualquier otro valor: referencia real (`uploadUrl` de YouTube, `creationId` de Instagram) — candidata a reconciliación real.

## 3. Máquina de estados — tal como quedó implementada

```
pending --claimPost()--> publishing (claimed_at=now(), publisher_operation_ref=NULL)
publishing --DRY_RUN o channel_status no autoriza--> pending (revertToPending, ambos campos a NULL)
publishing --fallo file/identity (antes de intentar publicar)--> pending|error (decideRetry, ambos campos a NULL)
publishing --markPublishAttemptStarted()--> publishing (publisher_operation_ref='pending:<platform>')
publishing --onOperationRef(ref) [solo YouTube/Instagram]--> publishing (publisher_operation_ref=ref real)
publishing --éxito + UPDATE local--> published (ambos campos a NULL, external_post_id/published_at seteados)
publishing --excepción del publisher--> pending|error (decideRetry, ambos campos a NULL)
publishing --timeout, publisher_operation_ref=NULL--> pending (retry_count+1) [CASO A]
publishing --timeout, publisher_operation_ref≠NULL--> verification_required (claimed_at=NULL, publisher_operation_ref SE CONSERVA para reconciliar) [CASO B/C]
```

**Nunca implementado (a propósito):** ninguna transición automática
`verification_required → pending` ni `verification_required → published`.
Esa decisión requiere `reconcileUnknownPublication()` invocada manualmente, o
revisión humana — no está conectada a ningún loop automático en esta fase.

## 4. Reconciliación — qué es real y qué no

Confirmado contra documentación oficial (fuentes exactas en el informe de
diseño de esta fase, sección de auditoría de plataformas):
- **YouTube**: `PUT` vacío con `Content-Range: bytes */TOTAL` al `uploadUrl` persistido → `201`=publicado, `308`=incompleto (seguro reintentar desde cero), `404`=sesión expirada (`CANNOT_VERIFY`).
- **Instagram**: `GET /{creationId}?fields=status_code` → `PUBLISHED`=confirmado, `ERROR`=confirmado que no, `EXPIRED`/`FINISHED`/`IN_PROGRESS`=no es un resultado terminal, no se adivina.
- **Facebook**: sin mecanismo de reconciliación con la implementación actual (usa el método simple de una sola llamada con `file_url`, no el protocolo de subida por fases que la documentación de Meta menciona pero que este código no usa) — siempre `CANNOT_VERIFY`, siempre requiere revisión humana.

Las funciones `reconcileYouTube()`/`reconcileInstagram()` (las que hacen la llamada de red real) están **implementadas pero `NOT VERIFIED AGAINST REAL PLATFORM`** — no hay credenciales OAuth reales disponibles ni autorizadas en esta fase para probarlas de verdad. Los mapeos puros (`mapYouTubeResumableStatus`, `mapInstagramContainerStatus`) sí están `VERIFIED` con 10 casos reales, sin red.

## 5. Por qué nunca se convierte incertidumbre en `pending` automáticamente

`classifyStaleClaim()` es la única puerta de entrada a la decisión "reintentar vs. verificar" dentro de `recoverStaleClaims()`, y su contrato es deliberadamente conservador: cualquier valor no vacío en `publisher_operation_ref` — sea una referencia real o el placeholder de Facebook — produce `verification_required`, nunca `retry`. Verificado con 5 casos reales en `test-claim-recovery.mts` (referencia real de YouTube, placeholder de Facebook, creationId real de Instagram, `null`, `undefined`).

## 6. Limitaciones documentadas, no ocultadas

- **Facebook**: sin capacidad de reconciliación automática hoy. Cualquier claim de Facebook que llegue a `verification_required` requiere revisión humana directa en la Página de Facebook — no hay alternativa técnica con el código actual.
- **YouTube**: la duración exacta de vigencia de una sesión de subida resumible **no se confirmó** en la documentación oficial consultada (`NOT VERIFIED`) — solo se confirmó que "eventualmente expira".
- **Instagram**: no se confirmó si la consulta de reconciliación (`status_code=PUBLISHED`) devuelve el `id` final del post publicado, o solo el estado (`NOT VERIFIED`) — si no lo devuelve, completar `external_post_id` tras una reconciliación exitosa requeriría un paso adicional no diseñado todavía.
- **TikTok**: `FUTURE VERIFICATION` — fuera de esta fase. La API expone un `publish_id` consultable vía `/v2/post/publish/status/fetch/`, arquitectónicamente compatible con el mismo patrón de `publisher_operation_ref` (confirmado por búsqueda en la documentación de TikTok for Developers), pero los requisitos de scope/auditoría de la app no se investigaron.

## 7. Qué falta antes de `DRY_RUN=false` (bloqueante, ninguno resuelto aquí)

1. **Aplicar la migración de schema** (ver `supabase/schema.sql`, comentarios `[NUEVO — Fase 5.4, no aplicado aún en producción]`) — el `ALTER TABLE` exacto queda documentado ahí, no ejecutado.
2. Activar `CLAIMED_AT_MIGRATION_APPLIED=true` **después** de aplicar la migración (si se activa antes, cualquier escritura a `publisher_operation_ref` fallaría con `column does not exist`).
3. Probar `recoverStaleClaims()`/`markPublishAttemptStarted()`/`persistOperationRef()` contra Supabase real (hoy `NOT VERIFIED`, bloqueado por el punto 1).
4. Decidir, con evidencia real de plataforma, si se invierte en migrar Facebook al protocolo de subida por fases (para darle una capacidad de reconciliación que hoy no tiene) o se acepta el riesgo residual (solo revisión humana).
5. Cuentas sociales reales conectadas (hoy `[PRUEBA FASE 4A]`) y un canal explícitamente promovido a `ACTIVE` — decisión humana, sin relación con este código.

## 8. Qué NO se tocó

`claimPost()` sigue siendo el mismo `UPDATE` condicional atómico (Atomic Claim, `VERIFIED` desde Fase 5.3, sin cambios en su garantía de concurrencia). `Publisher = (post, credentials) => Promise<PublishResult>` sigue siendo la firma base — el nuevo parámetro `onOperationRef` es estrictamente opcional y aditivo. `decideRetry()`/`MAX_RETRIES`/`retryPolicy.mts` sin cambios, reutilizados tal cual. Agent 2, MachineBridge, Visteapy: sin tocar.

## 9. Fase 5.4.1 — corrección del gap "HTTP éxito + fallo de parseo"

Una auditoría adversarial posterior encontró un camino real hacia
publicación duplicada, **independiente de cualquier crash o timeout**: si un
publisher recibía confirmación HTTP de éxito de la plataforma (`res.ok`)
pero fallaba al parsear el cuerpo de la respuesta, la excepción caía en el
`catch` genérico de `run.mts`, `classifyError()` la clasificaba `"retryable"`
por defecto (no contiene "401"/"403"), y `finishWithFailure()` limpiaba
`publisher_operation_ref`/`claimed_at` incondicionalmente y devolvía el post
a `pending` — habilitando un segundo `publish()` real sobre una publicación
que la plataforma ya pudo haber aceptado. Confirmado con evidencia exacta
(mensaje real de `JSON.parse` → `classifyError` → `"retryable"` →
`decideRetry` → `nextStatus: "pending"`).

**Corrección implementada** (quirúrgica, sin tocar el modelo de estados ni
la arquitectura):
- `PublicationOutcomeUncertainError` (`lib/social/types.ts`) — significa
  exclusivamente "la plataforma respondió éxito HTTP, no pudimos confirmar
  el resultado". Nunca se lanza para un rechazo HTTP normal (400/401/403/
  404) ni para un fallo de red antes de recibir respuesta — esos conservan
  el comportamiento existente sin cambios.
- Cada publisher (`youtube.ts`, `instagram.ts`, `facebook.ts`) envuelve
  **solo** el parseo posterior a la confirmación `.ok` de su acción
  irreversible/pública específica (el `PUT` de bytes en YouTube, el
  `media_publish` en Instagram, la única llamada en Facebook) — no el resto
  de sus llamadas intermedias (creación de contenedor, polling, refresco de
  token), que no representan una publicación ya hecha.
- `run.mts` distingue por `instanceof PublicationOutcomeUncertainError`,
  **no por análisis de strings** — nunca ejecuta `decideRetry()` para este
  caso, nunca limpia `publisher_operation_ref`/`claimed_at`.
- `finishWithUncertainOutcome()`/`buildUncertainOutcomeUpdatePayload()`
  (`agent/publish/claimPost.mts` + `uncertainOutcome.mts`, esta última sin
  import de Supabase, testeable en aislamiento) — el payload de actualización
  contiene únicamente `status='verification_required'` y `error_message`;
  deliberadamente **no incluye** las claves `claimed_at`/`publisher_operation_ref`,
  preservándolas intactas para reconciliación o revisión humana.
- Gap secundario corregido: `markPublishAttemptStarted()`/`persistOperationRef()`
  ahora verifican que su `UPDATE` afectó una fila real (mismo patrón que
  `claimPost()`), en vez de confiar solo en la ausencia de error.

**Nota de correctud sobre el orden de dependencias:** escribir
`status='verification_required'` requiere que el `CHECK` de la migración de
esta misma fase ya esté aplicado en producción — si se alcanzara antes, el
`UPDATE` fallaría por violación de constraint (fallo seguro: no escribe un
estado inválido, no reintenta, no duplica). Esto es, hoy, **inalcanzable en
la práctica**: `DRY_RUN=true` intercepta antes de que el código pueda llegar
a llamar a un publisher real, así que la corrección de esta fase es
verificable en su totalidad (16 casos reales, con `fetch` real de cada
publisher stubbeado, sin red ni Supabase) sin depender de que la migración
de Fase 5.4 esté aplicada.

**Hallazgo adicional del segundo audit adversarial (mismo día, corregido en
la misma fase):** el gap simétrico — `publish()` ya exitoso
(`externalPostId` real conocido) pero el `UPDATE` final a Supabase
(`run.mts`, tras obtener el resultado) falla — caía en el mismo `catch`
genérico, sin ser una instancia de `PublicationOutcomeUncertainError`
(el error viene de Supabase, no del publisher). Corregido envolviendo esa
escritura específica y reutilizando el mismo mecanismo vía
`buildPersistenceFailureError()` (`agent/publish/uncertainOutcome.mts`) —
este caso es, de hecho, MÁS seguro de reconciliar que el de parseo: se
conoce el `external_post_id` real, solo falló persistirlo, y ese ID queda
incluido en el mensaje de `verification_required`.

**Tests**: `agent/publish/test-uncertain-outcome.mts`
(`npm run uncertain-outcome:test`), 20/20 — ejercita el código REAL de los
3 publishers (no solo lógica de clasificación) mediante un stub de `fetch`
global: éxito+parseo-falla para las 3 plataformas (con el `operationRef`
real conservado para YouTube/Instagram, y confirmando que Facebook no
inventa uno), rechazo HTTP normal (403) y fallo de red antes de respuesta
(ambos conservan el comportamiento anterior, nunca
`PublicationOutcomeUncertainError`), la construcción del payload de
`verification_required` (nunca incluye `claimed_at`/`publisher_operation_ref`),
y el caso de fallo de persistencia post-éxito (`external_post_id` real
conservado en el mensaje).

## Cierre — Fases 5.5/5.6/5.8/5.9

Lo que este documento dejaba como diseño/pendiente ya está **aplicado y
verificado contra Supabase real**, no solo probado con lógica pura:

- **Fase 5.5** — migración aplicada: `publisher_operation_ref` creada,
  `social_posts_status_check` reemplazado para incluir `verification_required`
  (nombre y definición del constraint confirmados vía `pg_constraint` antes de
  ejecutar el `DROP`). `claimed_at` **ya existía** en producción desde antes
  (hallazgo de Fase 5.2.2) — no se volvió a crear.
- **Fase 5.6** — `recoverStaleClaims()` real probado en vivo con 2 filas
  temporales aisladas (nunca las 4 `social_posts` reales): sin
  `publisher_operation_ref` → `pending` (retry, `retry_count` incrementado);
  con `publisher_operation_ref` → `verification_required` (`claimed_at`
  limpiado, `publisher_operation_ref` preservado). Cero llamadas a YouTube/
  Instagram/Facebook/TikTok durante la prueba (instrumentado y confirmado).
  Filas temporales eliminadas; las 4 reales quedaron byte-a-byte idénticas.
- **Fase 5.8** — `CLAIMED_AT_MIGRATION_APPLIED=true` activado de forma
  **persistente** en `.env.local` (antes solo se había probado con la bandera
  fijada en el proceso hijo de un script temporal). `DRY_RUN=true` y
  `channel_status='HISTORICAL'` (las 3 cuentas reales) sin cambios —
  publicación real sigue bloqueada por ambas barreras, independientes de esta
  bandera (auditado en Fase 5.7).
- **Fase 5.9** — auditoría de cierre: las 4 `social_posts` reales y las 3
  `content_accounts` reales confirmadas intactas una vez más; Flow A
  confirmado sin ejecución automática; suite de tests completa en verde.

El diseño de reconciliación manual (`reconcileUnknownPublication()`, YouTube/
Instagram) sigue **implementado pero `NOT VERIFIED AGAINST REAL PLATFORM`**
(sin OAuth real) — eso no cambió en estas fases y sigue pendiente de
credenciales reales para probarse.
