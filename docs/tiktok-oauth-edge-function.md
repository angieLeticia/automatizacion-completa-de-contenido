# TikTok OAuth exchange — Supabase Edge Function (Sandbox)

> Alcance: Sandbox/demo. Intercambia el `code` de TikTok por tokens del lado
> del servidor y los guarda en `public.social_accounts.credentials`. La web
> (GitHub Pages) nunca ve ni maneja `access_token`/`refresh_token`.

## Flujo

```
website/index.html ("Connect TikTok")
  -> TikTok authorize (AUTHORIZE_BASE_URL, client_key público)
  -> website/oauth/tiktok-callback.html?code=...
  -> POST supabase/functions/tiktok-oauth-exchange { code, channel_name }
  -> Edge Function: code -> tokens (server-side) -> upsert social_accounts
  -> callback muestra "Conectado ✅" (nunca tokens)
```

## Secrets requeridos (ya creados en Supabase — solo nombres, nunca valores)

| Secret | Uso |
|---|---|
| `TIKTOK_CLIENT_KEY_SANDBOX` | `client_key` del exchange con TikTok |
| `TIKTOK_CLIENT_SECRET_SANDBOX` | `client_secret` — SOLO se usa server-side, nunca llega al HTML |
| `TIKTOK_REDIRECT_URI` | debe coincidir EXACTO con el configurado en TikTok Developer Portal (`https://angieleticia.github.io/automatizacion-completa-de-contenido/oauth/tiktok-callback.html`) |
| `SB_SERVICE_ROLE_KEY` | service role de Supabase — `social_accounts` tiene RLS `USING (false)`, así que **solo** la service role puede escribir ahí. Se llama así (no `SUPABASE_SERVICE_ROLE_KEY`) porque la plataforma no permite secrets con prefijo `SUPABASE_` |
| `SUPABASE_URL` | inyectada automáticamente por Supabase en toda Edge Function — no hace falta crearla a mano |

## Deploy

```bash
# Una sola vez, si el proyecto todavía no está vinculado:
supabase link --project-ref <tu-project-ref>

# Deploy de la función:
supabase functions deploy tiktok-oauth-exchange
```

`supabase/config.toml` ya trae `verify_jwt = false` para esta función — necesario porque GitHub Pages la llama sin sesión de Supabase Auth (sin JWT de usuario).

## Antes de producción real (no aplica todavía a Sandbox)

`verify_jwt = false` es una decisión deliberada para esta fase de Sandbox/demo, **no** algo listo para producción real. Antes de eso:
- Validar `state` del lado del servidor (hoy se genera en el navegador y nunca se verifica contra nada — cualquiera podría llamar al endpoint con un `code` ajeno si lo consiguiera).
- Considerar autenticación propia (ej. un secreto compartido entre `index.html` y la función, o Supabase Auth real) para que no cualquiera con la URL pública de la función pueda invocarla.
- `CHANNEL_NAME` está hardcodeado a `"SIN EXPLICACIÓN"` en `tiktok-callback.html` — antes de soportar más de un canal desde la web hace falta un selector real (fuera de esta fase; `website/index.html` no se tocó).

## Cómo probar (sin publicar nada)

1. Local: `supabase functions serve tiktok-oauth-exchange --env-file .env.local` (con los 4 secrets de arriba en ese `.env.local`, **nunca commiteado**).
2. En el sitio real, click en "Connect TikTok", completar el login de TikTok Sandbox, volver al callback.
3. Confirmar en pantalla: **"Conectado ✅"**.

## Verificar en Supabase sin mostrar tokens

```sql
select platform, credentials->>'open_id', created_at
from social_accounts
where platform = 'tiktok';
```

Esto muestra el `open_id` (no sensible) y la fecha, nunca `access_token`/`refresh_token`.
