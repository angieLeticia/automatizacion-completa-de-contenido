// Supabase Edge Function — intercambio server-side del authorization code de
// TikTok por access_token/refresh_token, y guardado en
// public.social_accounts.credentials. Nunca devuelve tokens al frontend.
//
// Contrato:
//   POST { code: string, channel_name?: string, channel_id?: string }
//   -> { ok: true, platform: "tiktok", open_id_masked: string }
//   -> { ok: false, error: string, message: string }
//
// Seguridad:
//   - Usa la service role key (nunca la anon key) porque
//     social_accounts tiene RLS "FOR ALL USING (false)" — solo la service
//     role puede leer/escribir esta tabla (ver supabase/schema.sql).
//   - client_secret de TikTok solo se usa acá (Deno, server-side) — nunca
//     llega al HTML/JS del navegador.
//   - Nunca se hace console.log de code/access_token/refresh_token ni de
//     ningún secreto — solo de identificadores no sensibles (channel_id,
//     platform, códigos de error).
//   - verify_jwt = false (ver supabase/config.toml): esto es DELIBERADO para
//     Sandbox/demo, porque GitHub Pages llama a esta función sin sesión de
//     Supabase Auth. Antes de producción real, endurecer con verificación de
//     `state` del lado del servidor o autenticación propia — documentado en
//     docs/tiktok-oauth-edge-function.md.

const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";

const ALLOWED_ORIGIN = "https://angieleticia.github.io";

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function errorResponse(error: string, message: string, status: number): Response {
  return jsonResponse({ ok: false, error, message }, status);
}

// Nunca imprime el valor real — solo para mostrarlo en logs/estructuras de
// diagnóstico de forma segura si hiciera falta en el futuro.
function mask(value: string): string {
  if (!value) return "";
  if (value.length <= 6) return "****";
  return `${value.slice(0, 2)}****${value.slice(-4)}`;
}

type TikTokTokenResponse = {
  access_token?: string;
  expires_in?: number;
  open_id?: string;
  refresh_token?: string;
  refresh_expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
  message?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Esta función solo acepta POST.", 405);
  }

  // --- 1) Parseo y validación del body — nunca se llama a TikTok si falta algo obligatorio ---
  let body: { code?: unknown; channel_name?: unknown; channel_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_JSON", "El body no es JSON válido.", 400);
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) {
    return errorResponse("MISSING_CODE", "Falta 'code' en el body.", 400);
  }

  const channelName = typeof body.channel_name === "string" ? body.channel_name.trim() : "";
  const channelIdInput = typeof body.channel_id === "string" ? body.channel_id.trim() : "";
  if (!channelName && !channelIdInput) {
    return errorResponse("MISSING_CHANNEL", "Falta 'channel_name' o 'channel_id' en el body.", 400);
  }

  // --- 2) Cliente Supabase con SERVICE ROLE (nunca anon key) ---
  // SUPABASE_URL: si existe, se usa (Supabase la inyecta automáticamente en
  // el entorno de toda Edge Function). Si por algún motivo no estuviera
  // presente, se falla explícito en vez de asumir una URL.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  // El nombre del secret NO puede empezar con "SUPABASE_" (restricción de la
  // plataforma) — por eso la service role vive en SB_SERVICE_ROLE_KEY, no en
  // el nombre convencional SUPABASE_SERVICE_ROLE_KEY.
  const serviceRoleKey = Deno.env.get("SB_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[tiktok-oauth-exchange] faltan credenciales de Supabase en el entorno (SUPABASE_URL / SB_SERVICE_ROLE_KEY)");
    return errorResponse("SERVER_MISCONFIGURED", "La función no tiene configuradas sus credenciales de Supabase.", 500);
  }

  const restHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  // --- 3) Resolver channel_id (por channel_id directo o por channel_name) ---
  let channelId = channelIdInput;
  if (!channelId) {
    const lookupUrl = `${supabaseUrl}/rest/v1/social_channels?select=id&name=eq.${encodeURIComponent(channelName)}&limit=1`;
    let lookupRes: Response;
    try {
      lookupRes = await fetch(lookupUrl, { headers: restHeaders });
    } catch (err) {
      console.error("[tiktok-oauth-exchange] error de red resolviendo channel_name", err instanceof Error ? err.message : String(err));
      return errorResponse("CHANNEL_LOOKUP_FAILED", "No se pudo verificar el canal (error de red).", 502);
    }
    if (!lookupRes.ok) {
      console.error("[tiktok-oauth-exchange] error HTTP resolviendo channel_name", lookupRes.status);
      return errorResponse("CHANNEL_LOOKUP_FAILED", "No se pudo verificar el canal.", 502);
    }
    const rows = (await lookupRes.json()) as { id: string }[];
    if (!rows || rows.length === 0) {
      return errorResponse("CHANNEL_NOT_FOUND", `No existe ningún canal con name='${channelName}'.`, 404);
    }
    channelId = rows[0].id;
  } else {
    // Si vino channel_id directo, se confirma que exista ANTES de gastar el
    // code contra TikTok (fail-closed, mismo criterio que el resto del
    // proyecto: nunca gastar un recurso de un solo uso para descubrir
    // después que el destino no era válido).
    const existsUrl = `${supabaseUrl}/rest/v1/social_channels?select=id&id=eq.${encodeURIComponent(channelId)}&limit=1`;
    let existsRes: Response;
    try {
      existsRes = await fetch(existsUrl, { headers: restHeaders });
    } catch (err) {
      console.error("[tiktok-oauth-exchange] error de red verificando channel_id", err instanceof Error ? err.message : String(err));
      return errorResponse("CHANNEL_LOOKUP_FAILED", "No se pudo verificar el canal (error de red).", 502);
    }
    if (!existsRes.ok) {
      return errorResponse("CHANNEL_LOOKUP_FAILED", "No se pudo verificar el canal.", 502);
    }
    const rows = (await existsRes.json()) as { id: string }[];
    if (!rows || rows.length === 0) {
      return errorResponse("CHANNEL_NOT_FOUND", `No existe ningún canal con id='${channelId}'.`, 404);
    }
  }

  // --- 4) Credenciales de TikTok (Sandbox) ---
  const clientKey = Deno.env.get("TIKTOK_CLIENT_KEY_SANDBOX");
  const clientSecret = Deno.env.get("TIKTOK_CLIENT_SECRET_SANDBOX");
  const redirectUri = Deno.env.get("TIKTOK_REDIRECT_URI");
  if (!clientKey || !clientSecret || !redirectUri) {
    console.error("[tiktok-oauth-exchange] faltan secrets de TikTok en el entorno");
    return errorResponse("SERVER_MISCONFIGURED", "La función no tiene configuradas las credenciales de TikTok.", 500);
  }

  // --- 5) Intercambio real con TikTok — recién acá se gasta el code ---
  const tokenParams = new URLSearchParams();
  tokenParams.set("client_key", clientKey);
  tokenParams.set("client_secret", clientSecret);
  tokenParams.set("code", code);
  tokenParams.set("grant_type", "authorization_code");
  tokenParams.set("redirect_uri", redirectUri);

  let tiktokRes: Response;
  try {
    tiktokRes = await fetch(TIKTOK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: tokenParams.toString(),
    });
  } catch (err) {
    console.error("[tiktok-oauth-exchange] error de red llamando a TikTok", err instanceof Error ? err.message : String(err));
    return errorResponse("TIKTOK_EXCHANGE_FAILED", "No se pudo contactar a TikTok (error de red).", 502);
  }

  let tokenData: TikTokTokenResponse;
  try {
    tokenData = (await tiktokRes.json()) as TikTokTokenResponse;
  } catch {
    return errorResponse("TIKTOK_EXCHANGE_FAILED", "TikTok devolvió una respuesta no-JSON.", 502);
  }

  if (!tiktokRes.ok || tokenData.error || !tokenData.access_token) {
    // error/error_description son códigos y descripciones públicas de
    // TikTok (no son secretos) — está bien loguearlos y devolverlos.
    console.error("[tiktok-oauth-exchange] TikTok rechazó el exchange", tokenData.error ?? tiktokRes.status);
    return errorResponse(
      "TIKTOK_EXCHANGE_FAILED",
      tokenData.error_description || tokenData.message || `TikTok respondió ${tiktokRes.status} sin access_token.`,
      502
    );
  }

  // --- 6) Guardar en social_accounts (upsert por channel_id+platform) ---
  const credentials = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token ?? null,
    open_id: tokenData.open_id ?? null,
    expires_in: tokenData.expires_in ?? null,
    refresh_expires_in: tokenData.refresh_expires_in ?? null,
    scope: tokenData.scope ?? null,
    token_type: tokenData.token_type ?? null,
    obtained_at: new Date().toISOString(),
  };

  const upsertRes = await fetch(`${supabaseUrl}/rest/v1/social_accounts?on_conflict=channel_id,platform`, {
    method: "POST",
    headers: {
      ...restHeaders,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([
      {
        channel_id: channelId,
        platform: "tiktok",
        label: "TikTok Sandbox",
        credentials,
        is_active: true,
      },
    ]),
  });

  if (!upsertRes.ok) {
    const detail = await upsertRes.text().catch(() => "");
    // `detail` es el mensaje de error de PostgREST (esquema/constraint), no
    // contiene tokens — seguro de loguear tal cual.
    console.error("[tiktok-oauth-exchange] falló el upsert en social_accounts", upsertRes.status, detail);
    return errorResponse("DB_WRITE_FAILED", "No se pudo guardar la conexión en la base de datos.", 500);
  }

  // Nunca se devuelve access_token/refresh_token — solo una versión
  // enmascarada de open_id, solo para que la UI pueda mostrar algo que
  // confirme "esta es la cuenta correcta" sin exponer nada sensible.
  return jsonResponse({ ok: true, platform: "tiktok", open_id_masked: mask(tokenData.open_id ?? "") }, 200);
});
