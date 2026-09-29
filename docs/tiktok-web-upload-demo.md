# TikTok Web Upload Demo (App Review) — arquitectura y deploy

Interfaz web real para grabar el demo de App Review de TikTok: Login Kit
(`user.info.basic`) + Content Posting API (`video.upload`), usando
exactamente la misma lógica de endpoint/chunking ya probada con una subida
real exitosa desde `scripts/social/tiktok-upload-draft.mts` (commit
`bf941c3`, 172,649,788 bytes / 17 chunks, hoy en TikTok Inbox).

## Arquitectura

```
Browser (GitHub Pages, https://angieleticia.github.io)
   │ 1. POST {action:"user_info", channel}         → display_name/avatar_url
   │ 2. POST {action:"init", channel, video_size}   → session_id (opaco, cifrado), publish_id, chunk_size, total_chunk_count
   │ 3. POST ?action=upload_chunk&session_id=..&chunk_index=N  (body = bytes crudos del chunk) × total_chunk_count
   │ 4. POST {action:"status", session_id}          → status de TikTok
   ▼
Edge Function supabase/functions/tiktok-upload/
   - Lee/refresca access_token desde social_accounts (nunca lo expone)
   - INIT llama a POST /v2/post/publish/inbox/video/init/ (Upload-to-draft,
     NO Direct Post) con body { source_info } únicamente
   - upload_chunk relayea CADA chunk a upload_url EN STREAMING (nunca
     bufferiza el video completo — pasa req.body, un ReadableStream, directo
     como body del fetch saliente)
   - upload_url NUNCA llega al browser en texto plano — vive solo dentro del
     session_id cifrado (AES-256-GCM)
```

**Por qué proxy por chunks y no browser-direct a `upload_url`:** análisis de
headers (Content-Type/Content-Range no están en la lista "safe" de CORS,
TikTok no documenta manejo de preflight en ningún lado) indicó riesgo alto
de que el navegador bloquee el PUT directo. Arquitectura aprobada
explícitamente: proxy por chunks vía Edge Function.

**Por qué un token cifrado y no una tabla nueva en Supabase:** el estado
(`publish_id`, `upload_url`, `video_size`, plan de chunks, cuenta) solo
necesita vivir durante la ventana de una subida (minutos). Un blob opaco
cifrado (AES-256-GCM, `sessionToken.ts`) evita crear una tabla nueva con su
propia limpieza de filas viejas, y el browser nunca puede leer su contenido
— a diferencia de un JWT firmado-pero-no-cifrado, que sí expondría
`upload_url` en base64 legible.

## Archivos nuevos/modificados
- `supabase/functions/tiktok-upload/index.ts` — reescrita por completo (la
  versión anterior, nunca pusheada, tenía los 2 bugs ya corregidos en el CLI).
- `supabase/functions/tiktok-upload/chunkPlan.ts` — puerto exacto de
  `planUploadChunks`/`validateUploadPlan` (mismo algoritmo que el CLI y que
  `website/tiktok-chunking.js`, verificado idéntico con
  `npm run tiktok-chunk-plan-deno-port:test`).
- `supabase/functions/tiktok-upload/sessionToken.ts` — cifrado/descifrado
  AES-256-GCM del token de sesión opaco (verificado con
  `npm run tiktok-session-token:test`).
- `website/tiktok-chunking.js` — misma lógica de chunking, puerto para el
  browser (verificado idéntico con `npm run tiktok-chunking-browser-port:test`).
- `website/demo-upload.html` — reescrita por completo.
- `website/index.html` — 1 link agregado a la demo, sin tocar el flujo de
  "Connect TikTok" existente.
- `supabase/config.toml` — sección `[functions.tiktok-upload]` agregada.

## Secrets nuevos necesarios en Supabase (además de los ya existentes)
Ya existen (de fases anteriores): `SB_SERVICE_ROLE_KEY`,
`TIKTOK_CLIENT_KEY_SANDBOX`, `TIKTOK_CLIENT_SECRET_SANDBOX`,
`TIKTOK_REDIRECT_URI`.

**Nuevo, hace falta crearlo:**
```
TIKTOK_UPLOAD_SESSION_KEY
```
32 bytes aleatorios en base64 (AES-256). Generar con:
```bash
openssl rand -base64 32
```

## Comandos de deploy (para correr manualmente — no se ejecutó nada de esto)

```bash
# 1. Crear el secret nuevo (una sola vez, con el valor real generado arriba)
supabase secrets set TIKTOK_UPLOAD_SESSION_KEY="<el valor generado por openssl rand -base64 32>"

# 2. Desplegar la función
supabase functions deploy tiktok-upload

# 3. (opcional) confirmar que los secrets necesarios están todos presentes
supabase secrets list
```

## Limitación conocida — sin `deno` history de verificación en producción
Se corrió `npx --yes deno check index.ts` en esta máquina (Deno 2.9.6,
descargado on-demand vía npx) y pasó sin errores — pero no hay Docker/CLI de
Supabase local para levantar la función real y probarla de punta a punta sin
desplegarla. La verificación real de punta a punta queda para cuando se
autorice una subida real después del deploy.
