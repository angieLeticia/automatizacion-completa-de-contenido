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
