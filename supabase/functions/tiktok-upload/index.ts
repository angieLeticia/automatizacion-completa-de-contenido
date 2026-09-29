// Supabase Edge Function — sube un video a TikTok (Content Posting API,
// FILE_UPLOAD) como BORRADOR, para el demo web de App Review. Reemplaza por
// completo el intento anterior (feat/tiktok-upload-demo, NUNCA pusheado a
// agents-origin/main) — ese intento tenía los 2 mismos bugs ya encontrados
// y corregidos en scripts/social/tiktok-upload-draft.mts (commit a13af94 +
// bf941c3), que es la ÚNICA referencia correcta usada acá:
//   1) endpoint equivocado (Direct Post en vez de Upload-to-draft) -> 401
//      scope_not_authorized real.
//   2) sin chunking real (siempre chunk_size=video_size, total_chunk_count=1)
//      -> 400 invalid_params ("The chunk size is invalid") real, para
//      cualquier archivo >64MB.
// Ambos ya se probaron corregidos con una subida real exitosa de
// 172,649,788 bytes / 17 chunks (hoy) desde el CLI - esta función usa
// EXACTAMENTE la misma lógica de endpoint/chunking (ver chunkPlan.ts).
//
// Arquitectura elegida (aprobada explícitamente): browser -> Edge Function
// -> TikTok, con proxy POR CHUNKS (nunca browser-direct a upload_url - el
// análisis de headers de la fase de investigación mostró que Content-Type/
// Content-Range no están en la lista "safe" de CORS y TikTok no documenta
// manejo de preflight en ningún lado). La Edge Function relayea cada chunk
// en STREAMING (nunca hace .arrayBuffer()/.blob() sobre el chunk entrante -
// pasa req.body, un ReadableStream, directo como body del fetch saliente a
// TikTok) - nunca bufferiza el video completo en memoria.
//
// Estado temporal entre init/upload_chunk/status: un token opaco CIFRADO
// (AES-256-GCM, sessionToken.ts) en vez de una tabla nueva de Supabase - ver
// ese archivo para el razonamiento completo. upload_url NUNCA llega al
// browser en texto plano - solo dentro de ese blob cifrado, que el browser
// no puede leer.
//
// SEGURIDAD - nunca se imprime ni se devuelve al browser: access_token,
// refresh_token, client_secret, service_role key, ni upload_url en texto
// plano.
import { planUploadChunks, validateUploadPlan } from "./chunkPlan.ts";
import { encryptSession, decryptSession, type UploadSessionPayload } from "./sessionToken.ts";

const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";
const ALLOWED_ORIGIN = "https://angieleticia.github.io";
const SESSION_TTL_MS = 55 * 60 * 1000; // upload_url de TikTok expira en 1h - dejamos margen

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders() } });
}

function errorResponse(error: string, message: string, status: number): Response {
  return json({ ok: false, error, message }, status);
}

interface TikTokCredentials {
  access_token: string;
  refresh_token: string;
  open_id: string;
  expires_in: number;
  scope: string;
  obtained_at: string;
  [key: string]: unknown;
}

type SupabaseEnv = { supabaseUrl: string; serviceRoleKey: string };

function loadSupabaseEnv(): SupabaseEnv | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SB_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;
  return { supabaseUrl, serviceRoleKey };
}

type AccountLookup =
  | { ok: true; accountId: string; credentials: TikTokCredentials }
  | { ok: false; error: string; message: string; status: number };

// Mismo patrón de resolución de canal ya usado en tiktok-oauth-exchange -
// "copiado, no importado" (Deno no puede importar los .mts de Node de este
// repo) - único cambio real: acá TAMBIÉN se valida que existan los 5 campos
// de credentials que scripts/social/tiktok-upload-draft.mts exige.
async function resolveAccount(env: SupabaseEnv, channelName: string): Promise<AccountLookup> {
  const restHeaders = { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, "Content-Type": "application/json" };

  const channelUrl = `${env.supabaseUrl}/rest/v1/social_channels?select=id&name=eq.${encodeURIComponent(channelName)}&limit=1`;
  const channelRes = await fetch(channelUrl, { headers: restHeaders }).catch(() => null);
  if (!channelRes || !channelRes.ok) return { ok: false, error: "CHANNEL_LOOKUP_FAILED", message: "No se pudo verificar el canal.", status: 502 };
  const channelRows = (await channelRes.json()) as { id: string }[];
  if (!channelRows || channelRows.length === 0) {
    return { ok: false, error: "CHANNEL_NOT_FOUND", message: `No existe ningún canal con name='${channelName}'.`, status: 404 };
  }
  const channelId = channelRows[0].id;

  const accUrl = `${env.supabaseUrl}/rest/v1/social_accounts?select=id,credentials,is_active&channel_id=eq.${encodeURIComponent(channelId)}&platform=eq.tiktok&limit=1`;
  const accRes = await fetch(accUrl, { headers: restHeaders }).catch(() => null);
  if (!accRes || !accRes.ok) return { ok: false, error: "ACCOUNT_LOOKUP_FAILED", message: "No se pudo consultar la cuenta de TikTok conectada.", status: 502 };
  const accRows = (await accRes.json()) as { id: string; credentials?: Partial<TikTokCredentials>; is_active?: boolean }[];
  if (!accRows || accRows.length === 0) {
    return { ok: false, error: "TIKTOK_ACCOUNT_NOT_CONNECTED", message: "Este canal todavía no tiene una cuenta de TikTok conectada.", status: 404 };
  }
  const row = accRows[0];
  if (!row.is_active) {
    return { ok: false, error: "TIKTOK_ACCOUNT_NOT_CONNECTED", message: "La cuenta de TikTok de este canal no está activa.", status: 404 };
  }
  const c = row.credentials ?? {};
  const missing = (["access_token", "refresh_token", "open_id", "expires_in", "obtained_at"] as const).filter((k) => c[k] === undefined || c[k] === null || c[k] === "");
  if (missing.length > 0) {
    return { ok: false, error: "TIKTOK_ACCOUNT_NOT_CONNECTED", message: `Credenciales incompletas — faltan: ${missing.join(", ")}.`, status: 404 };
  }
  return { ok: true, accountId: row.id, credentials: c as TikTokCredentials };
}

function isAccessTokenExpired(credentials: TikTokCredentials): boolean {
  const obtainedAtMs = new Date(credentials.obtained_at).getTime();
  if (!Number.isFinite(obtainedAtMs)) return true;
  const SAFETY_MARGIN_MS = 60_000;
  return Date.now() >= obtainedAtMs + credentials.expires_in * 1000 - SAFETY_MARGIN_MS;
}

type RefreshResult = { ok: true; credentials: TikTokCredentials } | { ok: false; error: string; message: string; status: number };

// Mismo flujo que scripts/social/tiktok-upload-draft.mts::ensureFreshAccessToken,
// pero client_key/client_secret salen de los secrets de Supabase (ya
// existentes, usados por tiktok-oauth-exchange) en vez de un archivo local -
// acá SÍ están disponibles server-side, a diferencia del CLI.
async function ensureFreshAccessToken(env: SupabaseEnv, accountId: string, credentials: TikTokCredentials): Promise<RefreshResult> {
  if (!isAccessTokenExpired(credentials)) return { ok: true, credentials };

  const clientKey = Deno.env.get("TIKTOK_CLIENT_KEY_SANDBOX");
  const clientSecret = Deno.env.get("TIKTOK_CLIENT_SECRET_SANDBOX");
  if (!clientKey || !clientSecret) {
    console.error("[tiktok-upload] faltan TIKTOK_CLIENT_KEY_SANDBOX/TIKTOK_CLIENT_SECRET_SANDBOX para refrescar");
    return { ok: false, error: "SERVER_MISCONFIGURED", message: "No se puede refrescar el token — faltan credenciales de TikTok en el entorno.", status: 500 };
  }

  let refreshRes: Response;
  try {
    refreshRes = await fetch(`${TIKTOK_API_BASE}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: credentials.refresh_token }),
    });
  } catch (err) {
    console.error("[tiktok-upload] error de red refrescando token", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "TIKTOK_REFRESH_FAILED", message: "No se pudo contactar a TikTok para refrescar el token.", status: 502 };
  }
  const data = (await refreshRes.json().catch(() => ({}))) as Partial<TikTokCredentials> & { error?: string; error_description?: string };
  if (!refreshRes.ok || !data.access_token) {
    console.error("[tiktok-upload] TikTok rechazó el refresh", data.error ?? refreshRes.status);
    return { ok: false, error: "TIKTOK_REFRESH_FAILED", message: data.error_description || "TikTok rechazó el refresh del token.", status: 502 };
  }

  const refreshed: TikTokCredentials = {
    ...credentials,
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? credentials.refresh_token,
    expires_in: data.expires_in ?? credentials.expires_in,
    obtained_at: new Date().toISOString(),
  };

  const restHeaders = { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, "Content-Type": "application/json" };
  const updateRes = await fetch(`${env.supabaseUrl}/rest/v1/social_accounts?id=eq.${accountId}`, {
    method: "PATCH",
    headers: { ...restHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ credentials: refreshed }),
  }).catch(() => null);
  if (!updateRes || !updateRes.ok) {
    console.error("[tiktok-upload] el refresh funcionó pero no se pudo guardar en Supabase", updateRes?.status);
    // El token refrescado SIGUE siendo válido para este request aunque no
    // se haya podido persistir — se usa igual, no se bloquea la operación
    // en curso por un fallo de escritura (mismo criterio que el resto del
    // proyecto: un fallo de persistencia nunca se confunde con un fallo de
    // la operación real).
  }

  return { ok: true, credentials: refreshed };
}

async function getSessionKey(): Promise<string | null> {
  return Deno.env.get("TIKTOK_UPLOAD_SESSION_KEY") ?? null;
}

// ---------------------------- action: user_info ----------------------------
async function handleUserInfo(env: SupabaseEnv, channel: string): Promise<Response> {
  const account = await resolveAccount(env, channel);
  if (!account.ok) return errorResponse(account.error, account.message, account.status);

  const refreshed = await ensureFreshAccessToken(env, account.accountId, account.credentials);
  if (!refreshed.ok) return errorResponse(refreshed.error, refreshed.message, refreshed.status);

  let infoRes: Response;
  try {
    infoRes = await fetch(`${TIKTOK_API_BASE}/user/info/?fields=display_name,avatar_url`, {
      headers: { Authorization: `Bearer ${refreshed.credentials.access_token}` },
    });
  } catch (err) {
    console.error("[tiktok-upload] error de red en user_info", err instanceof Error ? err.message : String(err));
    return errorResponse("TIKTOK_USER_INFO_FAILED", "No se pudo contactar a TikTok.", 502);
  }
  const data = (await infoRes.json().catch(() => ({}))) as { data?: { user?: { display_name?: string; avatar_url?: string } }; error?: { message?: string } };
  const user = data.data?.user;
  if (!infoRes.ok || !user) {
    return errorResponse("TIKTOK_USER_INFO_FAILED", data.error?.message || `TikTok respondió ${infoRes.status} sin datos de usuario.`, 502);
  }

  return json({ ok: true, display_name: user.display_name ?? null, avatar_url: user.avatar_url ?? null }, 200);
}

// ------------------------------- action: init -------------------------------
async function handleInit(env: SupabaseEnv, channel: string, videoSize: number): Promise<Response> {
  if (!Number.isFinite(videoSize) || videoSize <= 0) {
    return errorResponse("MISSING_VIDEO_SIZE", "Falta 'video_size' (bytes, número > 0) válido.", 400);
  }

  const account = await resolveAccount(env, channel);
  if (!account.ok) return errorResponse(account.error, account.message, account.status);

  const scopes = account.credentials.scope.split(",").map((s) => s.trim());
  if (!scopes.includes("video.upload")) {
    return errorResponse("SCOPE_NOT_AUTHORIZED", `El scope guardado ('${account.credentials.scope}') no incluye 'video.upload'.`, 403);
  }

  const refreshed = await ensureFreshAccessToken(env, account.accountId, account.credentials);
  if (!refreshed.ok) return errorResponse(refreshed.error, refreshed.message, refreshed.status);

  // Plan de chunks calculado y VALIDADO server-side ANTES de llamar a
  // TikTok — mismo criterio fail-closed que el CLI: si el plan no es
  // válido, se aborta acá, nunca se gasta la llamada a TikTok.
  const plan = planUploadChunks(Math.trunc(videoSize));
  const planCheck = validateUploadPlan(plan);
  if (!planCheck.ok) {
    console.error("[tiktok-upload] plan de chunks inválido, no se llama a TikTok", planCheck.reason);
    return errorResponse("INVALID_CHUNK_PLAN", `Plan de chunks inválido: ${planCheck.reason}`, 400);
  }

  let initRes: Response;
  try {
    // Endpoint de "Upload Video to TikTok as a draft" (NO Direct Post) -
    // body EXACTO documentado: solo source_info, nunca post_info. Ver el
    // comentario de encabezado de este archivo para el porqué.
    initRes = await fetch(`${TIKTOK_API_BASE}/post/publish/inbox/video/init/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${refreshed.credentials.access_token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        source_info: { source: "FILE_UPLOAD", video_size: plan.videoSize, chunk_size: plan.chunkSize, total_chunk_count: plan.totalChunkCount },
      }),
    });
  } catch (err) {
    console.error("[tiktok-upload] error de red en init", err instanceof Error ? err.message : String(err));
    return errorResponse("TIKTOK_INIT_FAILED", "No se pudo contactar a TikTok (error de red).", 502);
  }

  const initData = (await initRes.json().catch(() => ({}))) as { data?: { publish_id?: string; upload_url?: string }; error?: { code?: string; message?: string } };
  const publishId = initData.data?.publish_id;
  const uploadUrl = initData.data?.upload_url;
  if (!initRes.ok || !publishId || !uploadUrl) {
    console.error("[tiktok-upload] TikTok rechazó init", initData.error?.code ?? initRes.status);
    return errorResponse("TIKTOK_INIT_FAILED", initData.error?.message || `TikTok respondió ${initRes.status} sin publish_id/upload_url.`, 502);
  }

  const sessionKey = await getSessionKey();
  if (!sessionKey) {
    console.error("[tiktok-upload] falta TIKTOK_UPLOAD_SESSION_KEY en el entorno");
    return errorResponse("SERVER_MISCONFIGURED", "Falta configurar la clave de sesión de subida en el servidor.", 500);
  }

  const sessionPayload: UploadSessionPayload = {
    publishId,
    uploadUrl,
    videoSize: plan.videoSize,
    chunkSize: plan.chunkSize,
    totalChunkCount: plan.totalChunkCount,
    accountId: account.accountId,
    channelName: channel,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const sessionId = await encryptSession(sessionPayload, sessionKey);

  // upload_url NUNCA se devuelve — solo el token opaco cifrado que la
  // contiene, más los metadatos no sensibles que el browser necesita para
  // manejar la barra de progreso.
  return json({ ok: true, session_id: sessionId, publish_id: publishId, chunk_size: plan.chunkSize, total_chunk_count: plan.totalChunkCount }, 200);
}

// --------------------------- action: upload_chunk ---------------------------
async function handleUploadChunk(req: Request, sessionKey: string, sessionId: string, chunkIndexRaw: string | null): Promise<Response> {
  const session = await decryptSession(sessionId, sessionKey);
  if (!session.ok) return errorResponse("INVALID_SESSION", session.reason, 400);

  const chunkIndex = Number(chunkIndexRaw);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.payload.totalChunkCount) {
    return errorResponse("INVALID_CHUNK_INDEX", `chunk_index inválido o fuera de rango [0, ${session.payload.totalChunkCount - 1}].`, 400);
  }

  // Se recalcula el plan completo a partir de videoSize/chunkSize (mismos
  // valores ya usados en el init real, guardados en la sesión) — nunca se
  // confía en un start/end que mandara el browser: son deterministas, se
  // derivan server-side.
  const plan = planUploadChunks(session.payload.videoSize, session.payload.chunkSize);
  const planCheck = validateUploadPlan(plan);
  if (!planCheck.ok) return errorResponse("INVALID_CHUNK_PLAN", `Plan de chunks inconsistente: ${planCheck.reason}`, 500);
  const target = plan.chunks[chunkIndex];

  const contentLengthHeader = req.headers.get("content-length");
  const declaredLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;
  if (!Number.isFinite(declaredLength) || declaredLength !== target.length) {
    return errorResponse(
      "CHUNK_SIZE_MISMATCH",
      `El chunk ${chunkIndex} debe medir exactamente ${target.length} bytes (Content-Length recibido: ${contentLengthHeader ?? "ausente"}).`,
      400
    );
  }
  if (!req.body) {
    return errorResponse("MISSING_BODY", "Falta el cuerpo (bytes del chunk) en la request.", 400);
  }

  let putRes: Response;
  try {
    // STREAMING real: req.body es un ReadableStream, se pasa TAL CUAL como
    // body del fetch saliente — nunca se materializa el chunk completo en
    // memoria con .arrayBuffer()/.blob(). "duplex: half" es requerido por
    // el estándar fetch cuando el body es un stream.
    putRes = await fetch(session.payload.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(target.length),
        "Content-Range": `bytes ${target.start}-${target.end}/${session.payload.videoSize}`,
      },
      body: req.body,
      duplex: "half",
    } as RequestInit);
  } catch (err) {
    console.error("[tiktok-upload] error de red relayeando chunk a TikTok", err instanceof Error ? err.message : String(err));
    return errorResponse("TIKTOK_UPLOAD_FAILED", "No se pudo contactar a TikTok para subir este chunk.", 502);
  }
  if (!putRes.ok) {
    const detail = await putRes.text().catch(() => "");
    return errorResponse("TIKTOK_UPLOAD_FAILED", `TikTok rechazó el chunk ${chunkIndex} (HTTP ${putRes.status}): ${detail}`, 502);
  }

  return json({ ok: true, chunk_index: chunkIndex }, 200);
}

// ------------------------------ action: status ------------------------------
async function handleStatus(env: SupabaseEnv, sessionKey: string, sessionId: string): Promise<Response> {
  const session = await decryptSession(sessionId, sessionKey);
  if (!session.ok) return errorResponse("INVALID_SESSION", session.reason, 400);

  const accRestHeaders = { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, "Content-Type": "application/json" };
  const accRes = await fetch(`${env.supabaseUrl}/rest/v1/social_accounts?select=id,credentials,is_active&id=eq.${session.payload.accountId}&limit=1`, {
    headers: accRestHeaders,
  }).catch(() => null);
  if (!accRes || !accRes.ok) return errorResponse("ACCOUNT_LOOKUP_FAILED", "No se pudo releer la cuenta de TikTok.", 502);
  const accRows = (await accRes.json()) as { id: string; credentials?: Partial<TikTokCredentials>; is_active?: boolean }[];
  if (!accRows || accRows.length === 0 || !accRows[0].is_active) {
    return errorResponse("TIKTOK_ACCOUNT_NOT_CONNECTED", "La cuenta de TikTok de esta sesión ya no está disponible.", 404);
  }
  const refreshed = await ensureFreshAccessToken(env, session.payload.accountId, accRows[0].credentials as TikTokCredentials);
  if (!refreshed.ok) return errorResponse(refreshed.error, refreshed.message, refreshed.status);

  let statusRes: Response;
  try {
    statusRes = await fetch(`${TIKTOK_API_BASE}/post/publish/status/fetch/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${refreshed.credentials.access_token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ publish_id: session.payload.publishId }),
    });
  } catch (err) {
    console.error("[tiktok-upload] error de red en status", err instanceof Error ? err.message : String(err));
    return errorResponse("TIKTOK_STATUS_FAILED", "No se pudo contactar a TikTok.", 502);
  }
  const data = (await statusRes.json().catch(() => ({}))) as { data?: { status?: string; fail_reason?: string }; error?: { message?: string } };
  if (!statusRes.ok || !data.data?.status) {
    return errorResponse("TIKTOK_STATUS_FAILED", data.error?.message || `TikTok respondió ${statusRes.status} sin status.`, 502);
  }

  return json({ ok: true, status: data.data.status, fail_reason: data.data.fail_reason ?? null, publish_id: session.payload.publishId }, 200);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "POST") return errorResponse("METHOD_NOT_ALLOWED", "Esta función solo acepta POST.", 405);

  const env = loadSupabaseEnv();
  if (!env) {
    console.error("[tiktok-upload] faltan SUPABASE_URL / SB_SERVICE_ROLE_KEY en el entorno");
    return errorResponse("SERVER_MISCONFIGURED", "La función no tiene configuradas sus credenciales de Supabase.", 500);
  }

  const url = new URL(req.url);
  // upload_chunk manda los bytes del chunk como body CRUDO (nunca JSON) -
  // por eso su metadata (action/session_id/chunk_index) viaja en la query
  // string, no en un body JSON como las otras 3 acciones.
  const queryAction = url.searchParams.get("action");

  if (queryAction === "upload_chunk") {
    const sessionKey = await getSessionKey();
    if (!sessionKey) return errorResponse("SERVER_MISCONFIGURED", "Falta configurar la clave de sesión de subida en el servidor.", 500);
    const sessionId = url.searchParams.get("session_id");
    const chunkIndex = url.searchParams.get("chunk_index");
    if (!sessionId || chunkIndex === null) return errorResponse("MISSING_PARAMS", "Faltan 'session_id' o 'chunk_index' en la query string.", 400);
    return handleUploadChunk(req, sessionKey, sessionId, chunkIndex);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_JSON", "El body no es JSON válido.", 400);
  }

  const action = typeof body.action === "string" ? body.action : queryAction ?? "";
  const channel = typeof body.channel === "string" ? body.channel.trim() : "";

  if (action === "user_info") {
    if (!channel) return errorResponse("MISSING_CHANNEL", "Falta 'channel'.", 400);
    return handleUserInfo(env, channel);
  }
  if (action === "init") {
    if (!channel) return errorResponse("MISSING_CHANNEL", "Falta 'channel'.", 400);
    const videoSize = typeof body.video_size === "number" ? body.video_size : NaN;
    return handleInit(env, channel, videoSize);
  }
  if (action === "status") {
    const sessionKey = await getSessionKey();
    if (!sessionKey) return errorResponse("SERVER_MISCONFIGURED", "Falta configurar la clave de sesión de subida en el servidor.", 500);
    const sessionId = typeof body.session_id === "string" ? body.session_id : "";
    if (!sessionId) return errorResponse("MISSING_SESSION_ID", "Falta 'session_id'.", 400);
    return handleStatus(env, sessionKey, sessionId);
  }

  return errorResponse("UNKNOWN_ACTION", "action debe ser 'user_info', 'init', 'upload_chunk' o 'status'.", 400);
});
