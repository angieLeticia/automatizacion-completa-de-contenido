# Fase 5.12 — Auditoría completa de TikTok

> Alcance: solo auditoría y diseño. No se implementó ningún publisher de
> TikTok. No se hizo publicación real, no se tocaron flags/`channel_status`/
> credenciales/las 4 `social_posts` reales/Visteapy.

## 1. Estado actual — qué existe y qué no (grep exhaustivo, 19 archivos con referencias a TikTok)

**Existe (código real, no fabricado para este informe):**

| Pieza | Archivo | Qué hace |
|---|---|---|
| Tipo `SocialPlatform` incluye `"tiktok"` | `lib/social/types.ts`, `agent/publish/types.mts`, `agent/schedule/resolveIdentity.mts` | Solo el tipo — no implica soporte real |
| Generación de metadata (título/descripción) | `agent/analyze/generateMetadata.mts::buildTiktok()` | Real, genera texto real para TikTok cuando Agent 1/2 procesa un `clip` |
| Límites de plataforma | `agent/analyze/config.mts::PLATFORM_LIMITS.tiktok` | `{titleMax:100, descMin:20, descMax:2200}` — real, usado por `buildTiktok()` |
| TikTok incluido en clips | `agent/analyze/config.mts::PLATFORMS_BY_FOLDER_TYPE.clip` | Real — un `clip` SÍ genera `platform_metadata.tiktok` hoy |
| Tipo de metadata para scheduling | `agent/publish/publicationCandidate.mts::TikTokMetadata` | Contrato de datos (Fase 4.9), nunca conectado a un publisher real |
| Mapeo de clave de plataforma | `agent/schedule/config.mts::PLATFORM_KEY_TO_SOCIAL_PLATFORM.tiktok` | Real, mapea `"tiktok"` → `"tiktok"` (identidad) |
| **Guarda de seguridad ya existente** | `agent/schedule/resolveIdentity.mts:67-73` | **`if (!PUBLISHERS[socialPlatform]) { skip... }`** — como TikTok no tiene publisher, el scheduler YA se niega a crear una fila `social_posts` para TikTok, con un motivo explícito, aunque Agent 1 genere su metadata |
| Entrada comentada en el panel admin | `lib/social/platforms.ts:20` | `// { key: "tiktok", ... } // pendiente de aprobación de la Content Posting API` — deliberadamente deshabilitada |
| Credenciales | `lib/social/credentialFields.ts:25` | `tiktok: []` — placeholder vacío, sin campos definidos |
| Reconciliación | `agent/publish/reconciliation.mts` | El `switch` de `reconcileUnknownPublication()` no tiene caso `"tiktok"` → cae en `default: CANNOT_VERIFY` (probado explícitamente en `test-reconciliation.mts`, TEST 10b) |

**No existe en absoluto:**
- Publisher (`lib/social/tiktok.ts` no existe — confirmado por `Glob`).
- Entrada en `PUBLISHERS` (`lib/social/publishers.ts`).
- `social_accounts` con `platform='tiktok'` en producción real (confirmado por SELECT, §8 abajo — 0 filas).
- Cualquier manejo de OAuth de TikTok.
- Cualquier test de publisher/reconciliación real de TikTok (solo el caso negativo — "no implementado, bloqueado" — está probado).

**Conclusión de §1:** TikTok NO es "cero código" — Agent 1/2 (research/metadata) ya lo trata como una plataforma de destino real y genera contenido para ella; pero Agent 3 (scheduling/publishing) tiene una barrera explícita y deliberada que impide que llegue a crear una publicación, exactamente igual de segura que el resto del sistema (mismo mecanismo `PUBLISHERS[platform]` que protege a las demás plataformas).

## 2. Protocolo real de TikTok (Content Posting API) — investigado contra documentación oficial actual

**Evidencia externa** (WebFetch/WebSearch de `developers.tiktok.com`, septiembre 2026 — no estaba en el código ni se infirió):

- **Init:** `POST https://open.tiktokapis.com/v2/post/publish/video/init/` — con `source_info` (`FILE_UPLOAD` con `video_size`/`chunk_size`/`total_chunk_count`, o `PULL_FROM_URL` con una URL de dominio verificado). Responde con **`publish_id`** (string, hasta 64 caracteres, formato `v_pub_file~v2-1.xxxxx`) y, si es `FILE_UPLOAD`, un `upload_url`.
- **Upload** (solo si `FILE_UPLOAD`): `PUT` de los bytes al `upload_url`, por chunks.
- **Status:** `POST https://open.tiktokapis.com/v2/post/publish/status/fetch/` con `{"publish_id": ...}`. Responde `{data: {status, fail_reason, publicaly_available_post_id: [], uploaded_bytes, downloaded_bytes}}`.
- **Valores de `status` documentados:** `PROCESSING_UPLOAD`, `PROCESSING_DOWNLOAD`, `SEND_TO_USER_INBOX`, `PUBLISH_COMPLETE`, `FAILED`.
- **Scopes OAuth:** `video.publish` (init/publish), `video.upload`/`video.publish` (status fetch).
- **Rate limit:** 30 solicitudes/minuto por `access_token` de usuario.
- **Bloqueador de negocio real, no de código:** *"unaudited_client_can_only_post_to_private_accounts"* — una app de TikTok sin auditoría/aprobación completa **solo puede publicar en cuentas privadas**, nunca públicas. Esto confirma y refuerza el comentario ya existente en `lib/social/platforms.ts` ("pendiente de aprobación de la Content Posting API") — no es una limitación de este código, es una limitación de la propia plataforma sobre esta integración hasta que TikTok apruebe la app.

Respuestas a los 11 puntos pedidos:

| # | Pregunta | Respuesta | Clasificación |
|---|---|---|---|
| A | ¿Fase previa con handle? | Sí — `init` devuelve `publish_id` ANTES de subir/procesar nada | VERIFICADO POR DOCUMENTACIÓN |
| B | ¿Upload separado del publish final? | Sí (si `FILE_UPLOAD`) — init → upload → [status async]. Con `PULL_FROM_URL` se salta el upload manual, TikTok jala el archivo él mismo | VERIFICADO POR DOCUMENTACIÓN |
| C | ¿Qué guardar como `publisher_operation_ref`? | `publish_id` | INFERENCIA (mapeo directo, no documentado literalmente como "esto es tu operation_ref" pero es la pieza exacta con ese propósito) |
| D | ¿Cuándo aparece? | En la respuesta del `init`, ANTES de cualquier subida/procesamiento — igual que `uploadUrl` de YouTube | VERIFICADO POR DOCUMENTACIÓN |
| E | ¿Consultable después? | Sí, vía el endpoint de status | VERIFICADO POR DOCUMENTACIÓN |
| F | ¿Endpoint de consulta? | `POST /v2/post/publish/status/fetch/` | VERIFICADO POR DOCUMENTACIÓN |
| G | ¿Cómo distingue publicado/no/procesando/desconocido? | `PUBLISH_COMPLETE` (publicado) / `FAILED` (no publicado, con `fail_reason`) / `PROCESSING_UPLOAD`\|`PROCESSING_DOWNLOAD`\|`SEND_TO_USER_INBOX` (procesando) / cualquier error HTTP o respuesta inesperada (desconocido) | VERIFICADO POR DOCUMENTACIÓN |
| H | ¿Timeout? | No documentado explícitamente en las páginas consultadas — por convención del resto del sistema (YouTube/Instagram, Fase 5.10), un fallo de red antes de respuesta debe tratarse como `CANNOT_VERIFY`, nunca lanzar sin control | NO VERIFICADO (comportamiento a implementar, no documentado por TikTok) |
| I | ¿Proceso muere entre upload y publish? | El propio `publish_id` YA es la evidencia — el checkpoint universal existente (`markPublishAttemptStarted`/`persistOperationRef`) cubriría esto igual que para YouTube/Instagram, sin cambios de diseño | VERIFICADO POR CÓDIGO (mecanismo ya genérico) |
| J | ¿Publish devuelve timeout? | No aplica igual que en YouTube/Instagram — con `PULL_FROM_URL` no hay una llamada de "publish final" separada del init; el procesamiento es asíncrono y se seguiría vía status-poll | INFERENCIA |
| K | ¿Idempotencia? | No documentada explícitamente en las páginas consultadas (ningún parámetro de idempotencia del lado de TikTok) — la idempotencia dependería, igual que hoy, de NUESTRO propio checkpoint (`publish_id` persistido) + nunca reintentar automáticamente si existe evidencia de intento | NO VERIFICADO |

## 3. Comparación con el modelo actual

| | Handle intermedio | Reconciliable | Categoría |
|---|---|---|---|
| YouTube | `uploadUrl` (antes del PUT) | Sí | 🟢 |
| Instagram | `creationId` (antes de `media_publish`) | Sí | 🟢 |
| Facebook | Ninguno | No | 🔴 |
| **TikTok** | **`publish_id` (antes de subir/procesar)** | **Sí, vía status-fetch documentado** | **🟡 — compatible con limitaciones (ver §11 bloqueadores; el código sería 🟢, el ACCESO real está 🔴 hasta aprobación de TikTok)** |

TikTok es, en el papel, **el caso MÁS compatible de los tres nuevos** (más parecido a YouTube que a Facebook) — con una diferencia real: el acceso a la API en sí (aprobación/auditoría de la app) es un bloqueador externo que no depende de código.

## 4. Contrato propuesto (diseño, NO implementado)

```
publisher (lib/social/tiktok.ts, propuesto):
  input:      SocialPost (video_url o local_file_path) + TikTokCredentials {access_token}
  init:       POST /v2/post/publish/video/init/ (PULL_FROM_URL con video_url, análogo a Instagram/Facebook —
              evita reescribir la entrega directa de YouTube)
  operation_ref: publish_id, reportado vía onOperationRef INMEDIATAMENTE tras el init,
              ANTES de cualquier polling (mismo patrón exacto que Instagram)
  publish:    asíncrono del lado de TikTok — no hay una segunda llamada nuestra que "finalice"
              nada (a diferencia de media_publish de Instagram); el resultado se seguiría
              vía polling de status, igual que Instagram espera FINISHED antes de continuar
  response:   { status: 'PUBLISH_COMPLETE' } -> { externalPostId: publicaly_available_post_id[0] ?? publish_id }
  errors:     status='FAILED' -> Error normal con fail_reason (retryable/permanente según el motivo,
              mismo patrón que retryPolicy.mts); HTTP no-ok / red / JSON inválido tras confirmar
              PUBLISH_COMPLETE -> PublicationOutcomeUncertainError (mismo patrón que los otros 3)

reconciliation (reconciliation.mts, propuesto):
  operation_ref: publish_id
  endpoint:   POST /v2/post/publish/status/fetch/
  CONFIRMED_PUBLISHED:     status === 'PUBLISH_COMPLETE'
  CONFIRMED_NOT_PUBLISHED: status === 'FAILED'
  UNKNOWN (CANNOT_VERIFY): PROCESSING_UPLOAD | PROCESSING_DOWNLOAD | SEND_TO_USER_INBOX |
                           HTTP no-ok | fetch lanza | JSON malformado | campo status ausente
                           (mismo patrón ya endurecido en Fase 5.10 para YouTube/Instagram)

recovery: sin cambios de diseño — el mecanismo genérico ya existente
  (markPublishAttemptStarted/persistOperationRef/recoverStaleClaims/classifyStaleClaim)
  ya cubriría TikTok automáticamente en cuanto exista un publisher real, exactamente
  igual que cubre YouTube/Instagram hoy — CERO cambios necesarios en claimPost.mts/run.mts.
```

**Nada de esto se implementó** — es la especificación que se implementaría SI se autoriza una fase futura, una vez resueltos los bloqueadores de §11.

## 5. Identity y cuentas

**Ya garantizado, sin trabajo nuevo necesario:** la cadena `content_account → channel_id → social_account` que impide "canal A → cuenta TikTok del canal B" es exactamente el mismo mecanismo genérico que ya protege YouTube/Instagram/Facebook (`resolveIdentity.mts` en `agent/publish/`, verificado por `channel_id !== account.channel_id` explícito) y el `resolveTargetsForContentAccount()` de `agent/schedule/` (ya audita `social_accounts.platform === socialPlatform` filtrado por `channel_id`). **No se necesita ninguna migración de base de datos ni campo nuevo** — el esquema ya soporta `social_accounts.platform='tiktok'` (el `CHECK` de `platform` en `schema.sql:33` ya incluye `'tiktok'` desde el diseño original). Lo único que falta es: (a) crear la fila real en `social_accounts` cuando exista una cuenta de TikTok real, y (b) el publisher en sí.

## 6. Metadata — requisitos de TikTok que impactarían el contrato

Confirmado por código ya existente: límites de texto (`titleMax:100, descMin:20, descMax:2200`) ya están definidos y en uso por `buildTiktok()`.

**No verificado en esta fase (requeriría re-consultar documentación al momento de implementar):** el campo `privacy_level` es obligatorio en el `init` de TikTok (valores típicos: `PUBLIC_TO_EVERYONE`/`MUTUAL_FOLLOW_FRIENDS`/`SELF_ONLY`) y, mientras la app no esté auditada, TikTok fuerza `SELF_ONLY` sin importar lo que se envíe — este campo no existe todavía en `PublicationCandidate`/`TikTokMetadata` (`agent/publish/publicationCandidate.mts:34-37`) y tendría que añadirse antes de implementar. Requisitos exactos de formato/duración/tamaño de video, y si algún campo de divulgación de contenido (branded/AI-generated) es obligatorio hoy, **no se confirmaron en esta fase** — no se afirma nada sin evidencia.

## 7. Matriz de tests necesaria (diseño, no implementada — no existe publisher que probar)

Los 18 casos pedidos ya tienen, en su mayoría, un equivalente directo ya PROBADO para YouTube/Instagram con el mismo patrón (`withStubbedFetch`, Fase 5.10): 1-3 (flujo feliz), 4-6 (timeout en cada fase), 7-8 (status consultable/no confirmable → ya existe el patrón exacto en `mapInstagramContainerStatus`/`mapYouTubeResumableStatus`), 9-12 (429/5xx/malformado/credenciales inválidas → ya existe el patrón exacto en `test-reconciliation.mts`), 15-16 (`verification_required`/stale claim → mecanismo genérico ya probado en vivo, Fase 5.6), 17-18 (retry seguro/idempotencia → mecanismo genérico ya probado). Los casos 13-14 (cuenta/canal incorrectos) ya están cubiertos por el mecanismo genérico de identidad (§5), sin necesidad de un test específico de TikTok. **Ninguno de estos 18 tests se escribió en esta fase** porque no existe código de publisher que ejercitar — escribirlos ahora produciría pruebas de una implementación ficticia, contrario a la regla de esta fase.

## 8. Supabase (solo lectura)

4/4 `social_posts` reales intactas. 3/3 `content_accounts` reales en `HISTORICAL`. `social_accounts` reales: `["instagram","facebook","youtube"]` — **cero cuentas de TikTok** en producción. Cero escrituras.

## 9-11. Riesgos, bloqueadores, complejidad

**Riesgos si se implementara sin resolver los bloqueadores:** ninguno de seguridad de datos (el modelo de reconciliación es sólido) — el riesgo real sería de **producto**: publicar solo en privado (`SELF_ONLY`) sin darse cuenta, por la restricción de app no auditada, pensando que se está publicando en público.

**Bloqueadores reales (no de código):**
1. La app de TikTok de este proyecto necesita **aprobación/auditoría de TikTok** para poder publicar en cuentas públicas (`unaudited_client_can_only_post_to_private_accounts`) — sin esto, cualquier implementación sería inútil para el propósito real.
2. Si se usa `PULL_FROM_URL`, el dominio de Supabase Storage necesita **verificación de dominio** en el TikTok Developer Portal.
3. No existe ninguna `social_account` de TikTok real ni credenciales — habría que crearlas (fuera de esta fase, requiere OAuth real).

**Complejidad estimada (cualitativa) para implementar el publisher + reconciliación, UNA VEZ resueltos los bloqueadores 1-3:** **MEDIA** — el patrón es una réplica casi directa de `instagram.ts` (init/handle intermedio → polling opcional → resultado), sin la complejidad de la subida resumible por bytes de YouTube (si se usa `PULL_FROM_URL`). El trabajo de reconciliación (`reconcileTikTok()`) es una réplica directa de `reconcileInstagram()`. El riesgo de tiempo real está en los bloqueadores externos (1-2), no en el código.

## Recomendación para Fase 5.13

No implementar el publisher de TikTok todavía — depende de un bloqueador externo (aprobación de TikTok) fuera del control de este repositorio. Cuando se resuelva, la implementación es de complejidad MEDIA y sigue un patrón ya usado 2 veces en este código (Instagram). Mientras tanto, no hay ninguna acción de código pendiente — el sistema ya está protegido correctamente (scheduler y `PUBLISHERS[platform]` ya bloquean TikTok sin necesidad de cambios).
