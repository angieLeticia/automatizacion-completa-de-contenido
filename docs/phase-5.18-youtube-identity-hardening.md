# Fase 5.18 — Identidad estructural real de YouTube

> Objetivo: que Agent 3 nunca dependa de un `label` humano para confiar en
> que una `social_account` es realmente el canal de YouTube que dice ser.
> Ninguna publicación real en esta fase. `DRY_RUN` y `channel_status` sin
> cambios en ningún momento.

## 1. Problema encontrado en Fase 5.17

La única "verificación de identidad" existente era leer `social_account.label`
(`"[PRUEBA FASE 4A] SIN EXPLICACION - YouTube"`) y compararlo, a ojo, contra
el `title` que devolvía Google. Ningún código comparaba un identificador
estructural — un label es texto libre, editable, y no tiene ninguna garantía
de corresponder al canal real autenticado por OAuth.

## 2. Colisión de nombre encontrada en la auditoría previa

`social_accounts` ya tenía una columna `channel_id` — pero es un **UUID
interno** (FK a `social_channels.id`), sin relación con el channel ID de
YouTube (string tipo `UCHtU7U5zZ1gndN5o-C2eeFQ`). Proponer una migración
`ADD COLUMN channel_id TEXT` habría fallado en Postgres (nombre duplicado) y,
aunque no fallara, habría sido peligrosamente confuso (dos "channel_id" con
significados distintos en la misma fila).

## 3. Solución elegida (sin migración de esquema)

Siguiendo el patrón ya usado por Instagram (`ig_user_id`) y Facebook
(`page_id`) — ambos guardan su identificador externo de plataforma **dentro
de `credentials` (JSONB)**, no como columna estructural — se agregó
**`credentials.channel_id`** para YouTube. Cero `ALTER TABLE`, cero riesgo de
colisión, consistente con el diseño ya existente.

## 4. Campo utilizado y regla exacta de comparación

`agent/publish/youtubeChannelIdentity.mts` (nuevo):
- `evaluateChannelIdentityMatch(realChannelId, configuredChannelId)` — pura, sin red. Compara **exactamente**, nunca por label/title/customUrl/email/is_active.
- `verifyYoutubeChannelIdentity(credentials)` — llama a Google de verdad (token exchange + `channels.list?mine=true`), envuelta en try/catch (mismo patrón que `reconciliation.mts`, Fase 5.10).

| Situación | Resultado | `retryable` |
|---|---|---|
| `credentials.channel_id` ausente/vacío | `IDENTITY_UNVERIFIED` | `false` (config, no transitorio) |
| Real ≠ configurado | `IDENTITY_MISMATCH` | `false` |
| Error de red/HTTP/parseo | `CHECK_FAILED` | `true` (posible transitorio) |
| Real === configurado | `VERIFIED` | — |

**Fail-closed real:** si `credentials.channel_id` está ausente, la función ni siquiera llama a `fetch` — bloquea de inmediato (confirmado por test, cero llamadas).

## 5. Dónde se aplica el gate (integración con la cadena existente)

`agent/publish/run.mts::processPost()` — **después** del gate combinado
existente (`DRY_RUN || !channel_status_ACTIVE || !humanAuthorized`) y
**antes** del checkpoint (`markPublishAttemptStarted`)/publisher, **solo para
`platform === "youtube"`**. Deliberado: este es el único punto donde ya se
confirmó que se está genuinamente a punto de publicar (los otros 3 gates ya
pasaron) — evita gastar cuota de la API de Google o depender de su
disponibilidad en cada ciclo rutinario de `DRY_RUN`. Ninguna barrera existente
se reemplazó — todas siguen siendo obligatorias, confirmado por tests de
composición (casos 14-18).

## 6. Configuración de la cuenta piloto

`social_accounts.credentials.channel_id = "UCHtU7U5zZ1gndN5o-C2eeFQ"` — escrito
con autorización explícita, verificado antes (confirmó ser exactamente la fila
`[PRUEBA FASE 4A] SIN EXPLICACION - YouTube`) y después (merge preservando
`client_id`/`client_secret`/`refresh_token` intactos, nunca impresos).

## 7. Hallazgo real durante la verificación en vivo (no un bug de código)

El primer intento de verificación en vivo reveló una **confusión real de
credenciales**, no un defecto del módulo:
- Existen credenciales OAuth **separadas por canal** en `.env.local`
  (`YOUTUBE_CLIENT_ID_SIN_EXPLICACION`, `_ENCIENDE_EL_CAOS`, `_LUNA_VERDE`,
  `_OBJETOS_MALDITOS`), además de un juego **genérico** sin sufijo que
  `scripts/get-youtube-refresh-token.mts` es el único que lee.
- El juego genérico, en el momento del primer intento, contenía las
  credenciales de **Enciende El Caos** (proyecto de Google Cloud
  `162278820106` / `astute-surge-508402-t9`) — un proyecto **distinto** al de
  SIN EXPLICACIÓN (`322527320866`).
- `verifyYoutubeChannelIdentity()` — el código real de esta fase — detectó
  correctamente `IDENTITY_MISMATCH` (`channelId` real `UCvoDZTSqHNGutaNiBhTY19w`,
  "Enciende El Caos", contra el configurado `UCHtU7U5zZ1gndN5o-C2eeFQ`) en
  vez de asumir éxito. **Es exactamente el escenario que esta fase existe para
  prevenir**, confirmado en producción real antes de haber tocado
  publicación.
- Corregido reautorizando específicamente con la cuenta de Google dueña de
  SIN EXPLICACIÓN, usando las credenciales `*_SIN_EXPLICACION` (no las
  genéricas) para generar un `refresh_token` nuevo.

## 8. Resultado final — verificación real en vivo (esta fase)

Usando exclusivamente `YOUTUBE_CLIENT_ID_SIN_EXPLICACION`/
`YOUTUBE_CLIENT_SECRET_SIN_EXPLICACION`/`YOUTUBE_REFRESH_TOKEN_SIN_EXPLICACION`:

- OAuth (intercambio de tokens): **PASS** (HTTP 200, scope `youtube.readonly` + `youtube.upload`).
- `channels.list(part=snippet,contentDetails,statistics, mine=true)`: **PASS** (HTTP 200).
- Canal real: `channelId=UCHtU7U5zZ1gndN5o-C2eeFQ`, `title="Sin Explicación"`, `customUrl=@sinexplicacion.oficial`.
- Comparación contra `UCHtU7U5zZ1gndN5o-C2eeFQ`: **MATCH**.
- `verifyYoutubeChannelIdentity()` (código real, sin reimplementar): **`VERIFIED`**.

Ningún secreto (`client_secret`/`refresh_token`/`access_token`) fue impreso, logueado, documentado o commiteado en ningún momento de esta fase.

## 9. Tests

`agent/publish/test-youtube-identity.mts` (`npm run youtube-identity:test`) — **18/18 🟢**: coincidencia exacta, mismatch, ausente/null/vacío, respuesta malformada, error HTTP en token exchange y en `channels.list`, excepción de red, cero llamadas cuando no hay `channel_id` configurado, y 5 pruebas de composición confirmando que `DRY_RUN`/`channel_status`/Human Review siguen bloqueando aunque la identidad esté verificada.

Regresión completa: `tsc --noEmit` limpio; `human-review` 24/24, `uncertain-outcome` 24/24, `claim-recovery` 18/18, `publish-authorization` 8/8, `gap-closure-5.4.3` 13/13 (ajustado para reconocer `deploy-website-pages.yml`, un workflow legítimo y no relacionado con publicación agregado fuera de esta sesión), `reconciliation` 20/20.

## 10. Supabase

Sin cambios en esta fase más allá de lo ya autorizado y reportado (`credentials.channel_id` de la fila piloto). Las 4 `social_posts` reales y las 3 `content_accounts` reales permanecen intactas — confirmado por lectura antes/después. Ninguna otra `social_account` fue tocada.

## 11. Publicación

**NO REALIZADA.** Ninguna llamada de escritura contra YouTube en ningún momento.

## 12. Limitaciones

- El gate de identidad estructural solo cubre **YouTube** — Instagram/Facebook no tienen `credentials.channel_id` equivalente ni se tocaron en esta fase (fuera de alcance explícito).
- `scripts/get-youtube-refresh-token.mts` sigue sin ser consciente de las credenciales por canal (`*_SIN_EXPLICACION`, etc.) — el operador debe cargar manualmente las variables correctas en las genéricas antes de correrlo para un canal específico. No se automatizó esto en esta fase (no se pidió, y automatizarlo sin que el usuario lo solicite sería exceder el alcance).
- La reconciliación real contra una operación de subida genuina sigue pendiente (Fase 5.17), sin cambios.

## 13. Siguiente paso

Ninguna acción de código pendiente para el piloto de YouTube — identidad estructural real, verificada de punta a punta. Antes de repetir este proceso con otro canal (Enciende El Caos, Luna Verde, Objetos Malditos) o de considerar activación real, sería razonable unificar cómo se generan/gestionan las credenciales por canal (decisión de producto, no de código).
