# Fase 5.17 — Verificación OAuth real de YouTube (sin publicación)

> Primera integración OAuth real de una plataforma. Ningún upload, ningún
> `videos.insert`, ninguna publicación. Ningún secreto (refresh_token/
> access_token/client_secret) impreso, logueado, documentado o commiteado en
> ningún momento de esta fase.

## 1. Soporte OAuth existente (auditoría previa)

Ya implementado desde antes de esta fase, sin cambios de arquitectura:
- **Mecanismo:** OAuth 2.0 refresh-token flow (`lib/social/youtube.ts::getAccessToken()` — `POST oauth2.googleapis.com/token`, `grant_type=refresh_token`).
- **Credenciales de producción:** `social_accounts.credentials` (JSONB) — `client_id`/`client_secret`/`refresh_token`, nunca `.env.local` (confirmado en `lib/social/credentialFields.ts`).
- **Generación inicial del refresh_token:** `scripts/get-youtube-refresh-token.mts` (`npm run social:youtube-token`) — servidor local en `:8787`, intercambio código→tokens, imprime el refresh_token en la terminal del usuario para pegarlo manualmente en Supabase.

## 2. Hallazgo inicial — OAuth Client inexistente

La `social_account` real de YouTube (`id=20c85b1b-...`, label `[PRUEBA FASE 4A] SIN EXPLICACION - YouTube`) ya tenía `client_id`/`client_secret`/`refresh_token` guardados, pero el intento real de intercambio devolvió `invalid_client` — el OAuth Client no existía en Google. Se configuró un OAuth Client nuevo (Desktop App, en estado Testing) en Google Cloud Console, siguiendo las instrucciones entregadas paso a paso (pantallas exactas, sin que ningún secreto pasara por este chat).

## 3. Scope ampliado (cambio de código, único de esta fase)

Primer intento con el OAuth Client nuevo: intercambio de tokens exitoso, pero `GET /youtube/v3/channels?mine=true` devolvió `HTTP 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT` — el scope original del script (`youtube.upload` únicamente) no autoriza lectura de identidad de canal. **Corregido**: `scripts/get-youtube-refresh-token.mts` ahora solicita `youtube.upload` **y** `youtube.readonly`. Cambio de una línea, exclusivamente en este script manual de setup — `lib/social/youtube.ts` (el publisher real) no se tocó, sigue usando solo lo que necesitaba.

## 4. Autenticación real completada

Usuario reautorizó la misma cuenta con el scope ampliado; nuevo `refresh_token` colocado directamente en `.env.local` (`YOUTUBE_REFRESH_TOKEN`), nunca visto por mí. Verificado con variables de entorno locales (`YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET`/`YOUTUBE_REFRESH_TOKEN`), sin tocar Supabase para esta prueba:

- Intercambio `refresh_token → access_token`: **VÁLIDO**. Scope concedido: `youtube.readonly` + `youtube.upload`.
- Ningún valor de token impreso en ningún momento — solo `CONFIGURADO`/`VÁLIDO`/`INVÁLIDO` y metadata pública de respuesta (scope, expiración, tipo de token).

## 5. Identidad real del canal (READ-ONLY)

`GET https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true` → **HTTP 200**:

- `channelId`: `UCHtU7U5zZ1gndN5o-C2eeFQ`
- `title`: **"Sin Explicación"**
- `customUrl`: `@sinexplicacion.oficial`
- `publishedAt`: `2026-08-10T23:48:37Z`

Ningún dato sensible en esta respuesta — es información pública del canal.

## 6. Comparación con `social_accounts` (READ-ONLY)

`social_account` real: `{id: "20c85b1b-...", channel_id: "d989e221-...", platform: "youtube", label: "[PRUEBA FASE 4A] SIN EXPLICACION - YouTube", is_active: true}`.

**Nota de diseño, no un gap:** `social_accounts` no almacena el YouTube channel ID de Google como campo propio (solo credenciales de autenticación) — el `channel_id` que sí tiene es el UUID interno de `social_channels`, sin relación con el ID de Google. La única comparación posible es semántica: el `label` dice "SIN EXPLICACION" y el canal real devuelto por Google se llama **"Sin Explicación"** (`@sinexplicacion.oficial`) — **coinciden**, confirmado por lectura humana del nombre, no por un campo automatizado (no existe tal campo, y no se creó uno en esta fase — sería una migración de esquema fuera de alcance). **Sin mismatch.**

## 7. Supabase — integridad confirmada (antes y después)

4/4 `social_posts` reales: `pending`/`retry_count=0`/`error_message=null`/`external_post_id=null`/`published_at=null`/`claimed_at=null`/`publisher_operation_ref=null`/`publication_authorized_at=null`/`publication_authorized_by=null` — **sin cambios**. 3/3 `content_accounts` reales: `channel_status='HISTORICAL'` — **sin cambios**. La fila real de `social_accounts` (credenciales) **no se modificó** en esta fase — todas las pruebas usaron `.env.local`, nunca escribieron a Supabase.

## 8. Publicación real

**NO REALIZADA.** Ningún `videos.insert`, ningún upload, ninguna llamada de escritura a la YouTube Data API en ningún momento de esta fase.

## 9. Reconciliación

**PENDIENTE.** `reconcileYouTube()` (Fase 5.4/5.10) necesita un `uploadUrl` real de una sesión de subida resumible en curso — no se fabricó ninguna (regla explícita: no subir un video solo para probar). Clasificación exacta:

- A. OAuth real verificado: **SÍ**
- B. access_token real obtenido: **SÍ**
- C. `channels.list` real verificado: **SÍ** (HTTP 200, tras ampliar el scope)
- D. Identidad del canal verificada: **SÍ** (coincide con el label esperado)
- E. Publicación real: **NO REALIZADA**
- F. Reconciliación contra una operación real: **PENDIENTE** (requiere una primera operación real futura, fuera de esta fase)

## 10. Seguridad

Ningún secreto impreso, logueado, documentado o commiteado — confirmado por revisión de cada script temporal antes de borrarlo y de este documento. `.env.local` sigue sin trackear (confirmado). Todos los scripts de auditoría (`.tmp-audit-517-*`) creados y eliminados en su propio turno.

## 11. Tests

`tsc --noEmit` limpio. `reconciliation` 20/20, `uncertain-outcome` 24/24, `claim-recovery` 18/18, `publish-authorization` 8/8, `human-review` 24/24, `gap-closure-5.4.3` 13/13 — sin regresiones, sin cambios necesarios en ningún test existente.

## 12. Limitaciones

- `channels.list` requiere `youtube.readonly` explícito — no estaba documentado previamente en este proyecto; ahora sí (este documento + el comentario en el script).
- No existe un campo en `social_accounts` para el YouTube channel ID real — la verificación de identidad es semántica (nombre del canal), no un chequeo automatizado por ID. Si se quisiera automatizar esa comparación en el futuro, requeriría una migración de esquema (fuera de alcance de esta fase).
- Reconciliación real contra una operación genuina de YouTube sigue sin probarse — requiere una futura operación de subida real y autorizada, no simulable sin publicar de verdad.

## 13. Siguiente paso

Cerrar por completo esta cuenta piloto de YouTube (ya lograda: identidad real confirmada) antes de repetir el proceso con otra plataforma. Cualquier prueba de reconciliación real requeriría, en una fase separada y explícitamente autorizada, una primera operación de subida real — decisión de producto, no técnica.
