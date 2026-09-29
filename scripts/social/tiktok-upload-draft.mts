// Sube 1 video a TikTok como BORRADOR (Content Posting API, FILE_UPLOAD),
// para uso MANUAL desde la terminal — NO está conectado a agent/publish/,
// NO está registrado en lib/social/publishers.ts, NO lo toca el scheduler
// automático. Solo corre cuando un humano lo invoca a propósito.
//
// Uso:
//   npm run social:tiktok-upload-draft -- --channel "SIN EXPLICACIÓN" \
//     --file "D:\MATERIAL VIDEOS\SIN EXPLICACIÓN\Clips\008 - Clip 1.mp4" \
//     --caption "texto..."
//
// Usa el endpoint de "Upload Video to TikTok as a draft"
// (/v2/post/publish/inbox/video/init/, scope video.upload) — NO el de
// Direct Post (/v2/post/publish/video/init/, scope video.publish, que
// nuestro token nunca tuvo). Verificado contra la documentación oficial
// vigente (developers.tiktok.com/doc/content-posting-api-get-started-upload-content/)
// tras un 401 scope_not_authorized real causado por llamar por error al
// endpoint de Direct Post. Ese endpoint de draft NO acepta post_info
// (privacy_level/title) — su body es únicamente source_info; por eso no
// hay forma de fijar privacy_level ni caption en el INIT de este flujo. El
// resultado esperado sigue siendo un borrador en la bandeja de TikTok del
// dueño de la cuenta (status SEND_TO_USER_INBOX), no publicado en público.
//
// SEGURIDAD — nunca se imprime ni se loguea: access_token, refresh_token,
// client_secret, ni el body completo de ninguna petición a TikTok que los
// contenga. Solo se loguean publish_id/status/errores sin credenciales
// (mismo criterio ya usado en scripts/exchange-meta-oauth-code.mts).
//
// client_key/client_secret de TikTok viven en un archivo EXTERNO al
// repositorio (mismo patrón ya usado para Meta —
// scripts/exchange-meta-oauth-code.mts::META_OAUTH_CREDENTIALS_FILE— y para
// Backblaze B2 — agent/publish/config.mts::B2_CREDENTIALS_FILE): nunca en
// .env.local del proyecto, nunca en Git. Solo se necesitan si hace falta
// refrescar el access_token (ver Paso 3 más abajo) — si el access_token
// guardado en Supabase todavía es válido, este archivo ni se lee.
// scripts/pipeline/env.mts DEBE importarse primero (sin depender de nada
// propio) para que .env.local ya esté cargado en process.env antes de que
// supabaseAdmin.ts (más abajo) lo lea al evaluarse — en ES modules, los
// imports de un archivo se evalúan ANTES que su propio código; ver el
// comentario completo en ese archivo.
import "../pipeline/env.mts";
import { statSync, createReadStream } from "node:fs";
import { supabaseAdmin } from "../../lib/social/supabaseAdmin.ts";

const DEFAULT_CREDENTIALS_FILE = "C:\\Users\\angie\\tiktok-oauth.local";
const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";
const STATUS_POLL_ATTEMPTS = 10;
const STATUS_POLL_INTERVAL_MS = 5000;
const TOKEN_EXPIRY_SAFETY_MARGIN_SECONDS = 60; // refresca un poco ANTES de que TikTok lo rechace, no justo al límite

interface ParsedArgs {
  channel?: string;
  file?: string;
  caption?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--channel") result.channel = argv[++i];
    else if (argv[i] === "--file") result.file = argv[++i];
    else if (argv[i] === "--caption") result.caption = argv[++i];
  }
  return result;
}

function maskLength(value: string | undefined | null): string {
  return typeof value === "string" && value.length > 0 ? `PRESENT (length=${value.length})` : "MISSING";
}

interface TikTokCredentials {
  access_token: string;
  refresh_token: string;
  open_id: string;
  expires_in: number;
  scope: string;
  obtained_at: string;
  [key: string]: unknown; // preserva cualquier otro campo ya guardado (token_type, refresh_expires_in, etc.)
}

async function resolveAccount(channelName: string): Promise<{ accountId: string; credentials: TikTokCredentials }> {
  const { data: channel, error: channelErr } = await supabaseAdmin.from("social_channels").select("id,name").eq("name", channelName).maybeSingle();
  if (channelErr) throw new Error(`Error consultando social_channels: ${channelErr.message}`);
  if (!channel) throw new Error(`No existe ningún social_channel con name='${channelName}'.`);

  const { data: account, error: accountErr } = await supabaseAdmin
    .from("social_accounts")
    .select("id,credentials,is_active")
    .eq("channel_id", channel.id)
    .eq("platform", "tiktok")
    .maybeSingle();
  if (accountErr) throw new Error(`Error consultando social_accounts: ${accountErr.message}`);
  if (!account) throw new Error(`El canal '${channelName}' no tiene ninguna social_account de platform='tiktok' conectada.`);
  if (!account.is_active) throw new Error(`La social_account de TikTok de '${channelName}' existe pero is_active=false.`);

  const c = account.credentials as Partial<TikTokCredentials>;
  const missing = (["access_token", "refresh_token", "open_id", "expires_in", "obtained_at"] as const).filter((k) => c[k] === undefined || c[k] === null || c[k] === "");
  if (missing.length > 0) {
    throw new Error(`social_accounts.credentials de TikTok incompleto — faltan: ${missing.join(", ")}.`);
  }
  return { accountId: account.id as string, credentials: c as TikTokCredentials };
}

function isAccessTokenExpired(credentials: TikTokCredentials): boolean {
  const obtainedAtMs = new Date(credentials.obtained_at).getTime();
  if (!Number.isFinite(obtainedAtMs)) return true; // obtained_at ilegible -> tratar como vencido, nunca asumir que sigue valido
  const expiresAtMs = obtainedAtMs + credentials.expires_in * 1000;
  return Date.now() >= expiresAtMs - TOKEN_EXPIRY_SAFETY_MARGIN_SECONDS * 1000;
}

function loadRefreshCredentialsFile(): { clientKey: string | undefined; clientSecret: string | undefined; path: string } {
  const credentialsFile = process.env.TIKTOK_OAUTH_CREDENTIALS_FILE || DEFAULT_CREDENTIALS_FILE;
  try {
    process.loadEnvFile(credentialsFile);
  } catch {
    // Archivo ausente/ilegible - se valida explícitamente donde se usa
    // (PRESENT/MISSING), nunca se asume ni se inventa un valor.
  }
  return {
    clientKey: process.env.TIKTOK_CLIENT_KEY_SANDBOX,
    clientSecret: process.env.TIKTOK_CLIENT_SECRET_SANDBOX,
    path: credentialsFile,
  };
}

// Devuelve las credenciales YA renovadas (o las mismas sin tocar si no hacía
// falta refrescar). Nunca imprime ningún valor de token.
async function ensureFreshAccessToken(accountId: string, credentials: TikTokCredentials): Promise<TikTokCredentials> {
  if (!isAccessTokenExpired(credentials)) {
    console.log("access_token: vigente (no hace falta refrescar).");
    return credentials;
  }
  console.log("access_token: vencido o por vencer — refrescando...");

  const { clientKey, clientSecret, path } = loadRefreshCredentialsFile();
  console.log(`TIKTOK_CLIENT_KEY_SANDBOX=${maskLength(clientKey)} TIKTOK_CLIENT_SECRET_SANDBOX=${maskLength(clientSecret)} (archivo: ${path})`);
  if (!clientKey || !clientSecret) {
    throw new Error(
      `El access_token está vencido pero no se puede refrescar: falta TIKTOK_CLIENT_KEY_SANDBOX/TIKTOK_CLIENT_SECRET_SANDBOX en '${path}'. ` +
        "Agregá ese archivo (mismo patrón que meta-oauth.local) con esas 2 variables y volvé a intentar."
    );
  }

  const res = await fetch(`${TIKTOK_API_BASE}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: credentials.refresh_token,
    }),
  });
  const data = (await res.json()) as Partial<TikTokCredentials> & { error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`TikTok rechazó el refresh (HTTP ${res.status}): ${data.error ?? "sin código"} — ${data.error_description ?? "sin detalle"}.`);
  }

  const refreshed: TikTokCredentials = {
    ...credentials,
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? credentials.refresh_token, // TikTok puede rotar o no el refresh_token
    expires_in: data.expires_in ?? credentials.expires_in,
    obtained_at: new Date().toISOString(),
  };

  const { error: updateErr } = await supabaseAdmin.from("social_accounts").update({ credentials: refreshed }).eq("id", accountId);
  if (updateErr) throw new Error(`El refresh funcionó pero no se pudo guardar en Supabase: ${updateErr.message}`);

  console.log(`access_token: refrescado y guardado (nueva longitud=${data.access_token.length}, nunca impreso).`);
  return refreshed;
}

interface InitResult {
  publishId: string;
  uploadUrl: string;
}

async function initUpload(accessToken: string, videoSize: number): Promise<InitResult> {
  // Body EXACTO documentado para /post/publish/inbox/video/init/: solo
  // source_info. Ningún post_info/privacy_level/title acá - ver el
  // comentario del encabezado del archivo para el porqué.
  const res = await fetch(`${TIKTOK_API_BASE}/post/publish/inbox/video/init/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      source_info: { source: "FILE_UPLOAD", video_size: videoSize, chunk_size: videoSize, total_chunk_count: 1 },
    }),
  });
  const data = (await res.json()) as { data?: { publish_id?: string; upload_url?: string }; error?: { code?: string; message?: string } };
  const publishId = data.data?.publish_id;
  const uploadUrl = data.data?.upload_url;
  if (!res.ok || !publishId || !uploadUrl) {
    const authFailure = res.status === 401 || data.error?.code === "access_token_invalid";
    throw Object.assign(new Error(`TikTok rechazó init (HTTP ${res.status}): ${data.error?.code ?? "sin código"} — ${data.error?.message ?? "sin detalle"}.`), {
      authFailure,
    });
  }
  return { publishId, uploadUrl };
}

async function uploadFile(uploadUrl: string, filePath: string, fileSize: number): Promise<void> {
  const stream = createReadStream(filePath);
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(fileSize),
      "Content-Range": `bytes 0-${fileSize - 1}/${fileSize}`,
    },
    body: stream as unknown as BodyInit,
    duplex: "half",
  } as RequestInit);
  if (!res.ok) throw new Error(`El PUT del video a TikTok falló (HTTP ${res.status}): ${await res.text()}`);
}

type StatusResult = { status: string; failReason: string | null };

async function fetchStatus(accessToken: string, publishId: string): Promise<StatusResult> {
  const res = await fetch(`${TIKTOK_API_BASE}/post/publish/status/fetch/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ publish_id: publishId }),
  });
  const data = (await res.json()) as { data?: { status?: string; fail_reason?: string }; error?: { message?: string } };
  if (!res.ok || !data.data?.status) {
    throw new Error(`TikTok rechazó status/fetch (HTTP ${res.status}): ${data.error?.message ?? "sin detalle"}.`);
  }
  return { status: data.data.status, failReason: data.data.fail_reason ?? null };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.channel || !args.file) {
    console.error('Uso: npm run social:tiktok-upload-draft -- --channel "SIN EXPLICACIÓN" --file "ruta\\al\\video.mp4" [--caption "texto"]');
    process.exitCode = 1;
    return;
  }

  let fileSize: number;
  try {
    fileSize = statSync(args.file).size;
  } catch {
    console.error(`No se pudo leer el archivo: ${args.file}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Canal: ${args.channel}`);
  console.log(`Archivo: ${args.file} (${fileSize} bytes)`);
  console.log(`Caption: ${args.caption ? `"${args.caption}"` : "(sin caption)"}`);
  if (args.caption) {
    console.warn(
      'ADVERTENCIA: --caption se acepta por compatibilidad pero NO se envía a TikTok en este flujo. ' +
        '"Caption is completed by the creator inside TikTok when reviewing the uploaded draft." ' +
        "(el endpoint de Upload-to-TikTok-draft, /post/publish/inbox/video/init/, no admite post_info/title en el INIT)."
    );
  }

  console.log("\nPaso 1/5 — resolviendo social_account de TikTok en Supabase...");
  let accountId: string;
  let credentials: TikTokCredentials;
  try {
    ({ accountId, credentials } = await resolveAccount(args.channel));
  } catch (err) {
    console.error(`DETENIDO — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`  OK — social_accounts.id=${accountId}, scope="${credentials.scope}", open_id=${maskLength(credentials.open_id)}`);

  console.log("\nPaso 2/5 — verificando que el scope incluya 'video.upload'...");
  const scopes = credentials.scope.split(",").map((s) => s.trim());
  if (!scopes.includes("video.upload")) {
    console.error(
      `DETENIDO — el scope guardado ('${credentials.scope}') no incluye 'video.upload'. ` +
        "Hay que reconectar la cuenta desde website/index.html (Connect TikTok) después de que el scope pida video.upload, y volver a correr este script."
    );
    process.exitCode = 1;
    return;
  }
  console.log("  OK — 'video.upload' presente en el scope.");

  console.log("\nPaso 3/5 — verificando vigencia del access_token...");
  try {
    credentials = await ensureFreshAccessToken(accountId, credentials);
  } catch (err) {
    console.error(`DETENIDO — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  console.log("\nPaso 4/5 — iniciando el borrador en TikTok (init -> upload)...");
  let publishId: string;
  try {
    let initResult: InitResult;
    try {
      initResult = await initUpload(credentials.access_token, fileSize);
    } catch (err) {
      // Reintento único: si TikTok respondió que el token es inválido a pesar
      // de que nuestro cálculo de expiración decía que seguía vigente
      // (reloj desincronizado, revocación manual, etc.), se refresca UNA vez
      // y se reintenta init - nunca un loop, nunca más de un reintento.
      if ((err as { authFailure?: boolean }).authFailure) {
        console.log("  TikTok dice que el token no es válido pese a no estar vencido por fecha - refrescando y reintentando UNA vez...");
        credentials = await ensureFreshAccessToken(accountId, { ...credentials, obtained_at: new Date(0).toISOString() }); // fuerza el refresh
        initResult = await initUpload(credentials.access_token, fileSize);
      } else {
        throw err;
      }
    }
    publishId = initResult.publishId;
    console.log(`  OK — publish_id=${publishId}`);
    console.log("  Subiendo bytes del video (PUT directo a TikTok)...");
    await uploadFile(initResult.uploadUrl, args.file, fileSize);
    console.log("  OK — video subido.");
  } catch (err) {
    console.error(`DETENIDO — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  console.log("\nPaso 5/5 — consultando estado (polling)...");
  let finalStatus: StatusResult = { status: "UNKNOWN", failReason: null };
  for (let attempt = 1; attempt <= STATUS_POLL_ATTEMPTS; attempt++) {
    try {
      finalStatus = await fetchStatus(credentials.access_token, publishId);
    } catch (err) {
      console.error(`  Intento ${attempt}/${STATUS_POLL_ATTEMPTS}: error consultando estado - ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
    console.log(`  Intento ${attempt}/${STATUS_POLL_ATTEMPTS}: status=${finalStatus.status}${finalStatus.failReason ? ` (fail_reason=${finalStatus.failReason})` : ""}`);
    if (finalStatus.status === "PUBLISH_COMPLETE" || finalStatus.status === "FAILED" || finalStatus.status === "SEND_TO_USER_INBOX") break;
    if (attempt < STATUS_POLL_ATTEMPTS) await sleep(STATUS_POLL_INTERVAL_MS);
  }

  console.log("\n=== RESULTADO ===");
  console.log(`publish_id: ${publishId}`);
  console.log(`status final: ${finalStatus.status}`);
  if (finalStatus.status === "SEND_TO_USER_INBOX") {
    console.log(
      "\nEsto es lo esperado en Sandbox: el video quedó como BORRADOR en la bandeja de TikTok del dueño de la cuenta. " +
        "Para verlo: abrí la app de TikTok con la cuenta conectada -> notificaciones/bandeja de borradores -> revisar y publicar manualmente si se desea."
    );
  } else if (finalStatus.status === "PUBLISH_COMPLETE") {
    console.log("\nTikTok reportó la publicación como completa (inusual en Sandbox sin auditoría - revisar manualmente en la cuenta).");
  } else if (finalStatus.status === "FAILED") {
    console.log(`\nTikTok rechazó el video. fail_reason: ${finalStatus.failReason ?? "sin detalle"}.`);
  } else {
    console.log(
      "\nTikTok todavía lo está procesando después de todos los intentos de esta corrida. " +
        `Podés volver a consultar el estado más tarde con publish_id=${publishId} (no hay comando dedicado para esto todavía - queda como próximo paso opcional).`
    );
  }
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
