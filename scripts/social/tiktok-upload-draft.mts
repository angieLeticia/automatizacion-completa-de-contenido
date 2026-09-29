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
import { pathToFileURL } from "node:url";
import { supabaseAdmin } from "../../lib/social/supabaseAdmin.ts";

const DEFAULT_CREDENTIALS_FILE = "C:\\Users\\angie\\tiktok-oauth.local";
const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";
const STATUS_POLL_ATTEMPTS = 10;
const STATUS_POLL_INTERVAL_MS = 5000;
const TOKEN_EXPIRY_SAFETY_MARGIN_SECONDS = 60; // refresca un poco ANTES de que TikTok lo rechace, no justo al límite

// --- Chunking (Media Transfer Guide) ---------------------------------------
// Límites EXACTOS citados de developers.tiktok.com/doc/content-posting-api-media-transfer-guide
// (consultado en vivo, no estimado):
//   "Each chunk must be at least 5 MB but no greater than 64 MB" (chunks
//   estándar, es decir todos salvo el último).
//   "except for the final chunk, which can be greater than chunk_size (up
//   to 128 MB)".
//   "The value of total_chunk_count should be equal to video_size divided
//   by chunk_size, rounded down to the nearest integer."
//   "There must be a minimum of 1 chunk and a maximum of 1000 chunks."
//   "Videos with a total size less than 5 MB must be uploaded as a whole,
//   with chunk_size equal to the entire video's byte size."
//   El propio ejemplo oficial de la doc usa un chunk de 10,000,000 bytes
//   (byte 9,999,999 = último byte de "a 10,000,000-byte chunk") - evidencia
//   directa de que TikTok usa MB decimal (1,000,000), no MiB binario. Todas
//   las constantes de abajo usan esa misma unidad.
const MIN_CHUNK_SIZE = 5_000_000; // 5 MB
const MAX_CHUNK_SIZE = 64_000_000; // 64 MB - techo de cualquier chunk que NO sea el último
const MAX_FINAL_CHUNK_SIZE = 128_000_000; // 128 MB - techo del ÚLTIMO chunk cuando hay más de uno
const MAX_CHUNK_COUNT = 1000;
const DEFAULT_CHUNK_SIZE = 10_000_000; // mismo tamaño que el ejemplo oficial de TikTok - dentro de [MIN,MAX] con margen amplio

export interface ChunkPlan {
  index: number;
  start: number;
  end: number; // inclusivo, igual que Content-Range y que el 2do argumento de fs.createReadStream({end})
  length: number;
}

export interface UploadPlan {
  videoSize: number;
  chunkSize: number; // el chunk_size que se declara en el INIT (source_info.chunk_size)
  totalChunkCount: number;
  chunks: ChunkPlan[];
}

// Determinista y pura (sin red, sin fs) — ver PARTE 3/5 de la auditoría.
// Regla de "un solo chunk": si el video entero cabe dentro del techo
// ESTÁNDAR de un chunk (<=64MB), se manda entero como chunk único
// (cubre tanto el caso documentado "<5MB entero" como cualquier video
// <=64MB - no depende de la excepción ambigua del último chunk de
// hasta 128MB, que solo se usa acá cuando YA hay más de un chunk).
export function planUploadChunks(videoSize: number, chunkSize: number = DEFAULT_CHUNK_SIZE): UploadPlan {
  if (!Number.isInteger(videoSize) || videoSize <= 0) {
    throw new Error(`videoSize inválido: ${videoSize} (debe ser un entero positivo).`);
  }
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`chunkSize inválido: ${chunkSize} (debe ser un entero positivo).`);
  }

  if (videoSize <= MAX_CHUNK_SIZE) {
    return {
      videoSize,
      chunkSize: videoSize,
      totalChunkCount: 1,
      chunks: [{ index: 0, start: 0, end: videoSize - 1, length: videoSize }],
    };
  }

  // Multi-chunk: total_chunk_count = floor(videoSize / chunkSize), regla
  // oficial citada arriba. El ÚLTIMO chunk absorbe el resto (nunca queda un
  // resto como chunk propio, que podría caer bajo el mínimo de 5MB si el
  // resto fuera diminuto) - queda >= chunkSize siempre, muy por debajo del
  // techo de 128MB del último chunk con nuestro DEFAULT_CHUNK_SIZE de 10MB.
  const totalChunkCount = Math.floor(videoSize / chunkSize);
  const chunks: ChunkPlan[] = [];
  for (let i = 0; i < totalChunkCount; i++) {
    const start = i * chunkSize;
    const isLast = i === totalChunkCount - 1;
    const end = isLast ? videoSize - 1 : start + chunkSize - 1;
    chunks.push({ index: i, start, end, length: end - start + 1 });
  }
  return { videoSize, chunkSize, totalChunkCount, chunks };
}

// Validación FAIL-CLOSED independiente del cálculo de arriba - nunca confía
// ciegamente en planUploadChunks(), reverifica cada invariante desde cero.
// Se llama SIEMPRE antes del INIT; si falla, se aborta sin llamar a TikTok.
export function validateUploadPlan(plan: UploadPlan): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(plan.videoSize) || plan.videoSize <= 0) {
    return { ok: false, reason: `videoSize inválido: ${plan.videoSize}.` };
  }
  if (plan.totalChunkCount < 1 || plan.totalChunkCount > MAX_CHUNK_COUNT) {
    return { ok: false, reason: `totalChunkCount=${plan.totalChunkCount} fuera de rango [1, ${MAX_CHUNK_COUNT}].` };
  }
  if (plan.chunks.length !== plan.totalChunkCount) {
    return { ok: false, reason: `plan.chunks.length=${plan.chunks.length} no coincide con totalChunkCount=${plan.totalChunkCount}.` };
  }

  if (plan.totalChunkCount === 1) {
    const only = plan.chunks[0];
    if (plan.chunkSize !== plan.videoSize || only.length !== plan.videoSize) {
      return { ok: false, reason: "con totalChunkCount=1, chunkSize y el length del único chunk deben ser exactamente videoSize." };
    }
  } else {
    if (plan.chunkSize < MIN_CHUNK_SIZE || plan.chunkSize > MAX_CHUNK_SIZE) {
      return { ok: false, reason: `chunkSize=${plan.chunkSize} fuera de [${MIN_CHUNK_SIZE}, ${MAX_CHUNK_SIZE}] bytes.` };
    }
    for (let i = 0; i < plan.chunks.length - 1; i++) {
      if (plan.chunks[i].length !== plan.chunkSize) {
        return { ok: false, reason: `chunk[${i}].length=${plan.chunks[i].length} debe ser exactamente chunkSize=${plan.chunkSize} (no es el último chunk).` };
      }
    }
    const last = plan.chunks[plan.chunks.length - 1];
    if (last.length <= 0 || last.length > MAX_FINAL_CHUNK_SIZE) {
      return { ok: false, reason: `el último chunk (length=${last.length}) debe ser >0 y <= ${MAX_FINAL_CHUNK_SIZE} bytes.` };
    }
    if (last.length < MIN_CHUNK_SIZE) {
      return { ok: false, reason: `el último chunk (length=${last.length}) quedó por debajo del mínimo de ${MIN_CHUNK_SIZE} bytes.` };
    }
  }

  // Suma exacta, sin huecos ni overlaps, primer start=0, último end=videoSize-1.
  let expectedStart = 0;
  let sum = 0;
  for (const c of plan.chunks) {
    if (c.start !== expectedStart) {
      return { ok: false, reason: `chunk[${c.index}].start=${c.start} esperado=${expectedStart} (hueco u overlap).` };
    }
    if (c.end !== c.start + c.length - 1) {
      return { ok: false, reason: `chunk[${c.index}] inconsistente: end=${c.end}, start=${c.start}, length=${c.length}.` };
    }
    sum += c.length;
    expectedStart = c.end + 1;
  }
  if (sum !== plan.videoSize) {
    return { ok: false, reason: `la suma de los length de todos los chunks (${sum}) no coincide con videoSize (${plan.videoSize}).` };
  }
  const lastChunk = plan.chunks[plan.chunks.length - 1];
  if (lastChunk.end !== plan.videoSize - 1) {
    return { ok: false, reason: `el último chunk termina en end=${lastChunk.end}, esperado videoSize-1=${plan.videoSize - 1}.` };
  }

  return { ok: true };
}

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

async function initUpload(accessToken: string, plan: UploadPlan): Promise<InitResult> {
  // Body EXACTO documentado para /post/publish/inbox/video/init/: solo
  // source_info. Ningún post_info/privacy_level/title acá - ver el
  // comentario del encabezado del archivo para el porqué. chunk_size/
  // total_chunk_count salen del plan YA validado por validateUploadPlan()
  // antes de llegar acá (ver main()) - nunca se recalculan ni se confía en
  // un valor fijo como antes (bug real: siempre chunk_size=video_size,
  // total_chunk_count=1, rechazado por TikTok con "The chunk size is invalid"
  // para archivos >64MB).
  const res = await fetch(`${TIKTOK_API_BASE}/post/publish/inbox/video/init/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      source_info: { source: "FILE_UPLOAD", video_size: plan.videoSize, chunk_size: plan.chunkSize, total_chunk_count: plan.totalChunkCount },
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

// upload_url es la MISMA para todos los chunks ("will be shared across all
// chunks", Media Transfer Guide) - se hace un PUT por chunk, en orden,
// secuencial (nunca en paralelo: mantiene el comportamiento determinista y
// evita cualquier ambigüedad sobre el orden en que TikTok ensambla los
// bytes). Cada PUT usa un slice de lectura acotado por {start,end} - nunca
// carga el archivo completo en memoria.
async function uploadChunks(uploadUrl: string, filePath: string, plan: UploadPlan): Promise<void> {
  for (const chunk of plan.chunks) {
    const stream = createReadStream(filePath, { start: chunk.start, end: chunk.end });
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${chunk.start}-${chunk.end}/${plan.videoSize}`,
      },
      body: stream as unknown as BodyInit,
      duplex: "half",
    } as RequestInit);
    if (!res.ok) {
      throw new Error(
        `El PUT del chunk ${chunk.index + 1}/${plan.totalChunkCount} (bytes ${chunk.start}-${chunk.end}) a TikTok falló (HTTP ${res.status}): ${await res.text()}`
      );
    }
  }
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

  console.log("\nPaso 1/6 — planificando chunks (sin red, cálculo local)...");
  const plan = planUploadChunks(fileSize);
  const planCheck = validateUploadPlan(plan);
  if (!planCheck.ok) {
    console.error(`DETENIDO — plan de chunks inválido, no se llama a TikTok: ${planCheck.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`  chunk_size=${plan.chunkSize} total_chunk_count=${plan.totalChunkCount}`);
  const chunksToShow = plan.chunks.length <= 20 ? plan.chunks : [...plan.chunks.slice(0, 3), ...plan.chunks.slice(-2)];
  for (const c of chunksToShow) {
    console.log(`    chunk ${c.index}: start=${c.start} end=${c.end} length=${c.length}`);
  }
  if (plan.chunks.length > 20) console.log(`    ... (${plan.chunks.length - 5} chunks intermedios omitidos del log, no del plan real)`);

  console.log("\nPaso 2/6 — resolviendo social_account de TikTok en Supabase...");
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

  console.log("\nPaso 3/6 — verificando que el scope incluya 'video.upload'...");
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

  console.log("\nPaso 4/6 — verificando vigencia del access_token...");
  try {
    credentials = await ensureFreshAccessToken(accountId, credentials);
  } catch (err) {
    console.error(`DETENIDO — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  console.log("\nPaso 5/6 — iniciando el borrador en TikTok (init -> upload)...");
  let publishId: string;
  try {
    let initResult: InitResult;
    try {
      initResult = await initUpload(credentials.access_token, plan);
    } catch (err) {
      // Reintento único: si TikTok respondió que el token es inválido a pesar
      // de que nuestro cálculo de expiración decía que seguía vigente
      // (reloj desincronizado, revocación manual, etc.), se refresca UNA vez
      // y se reintenta init - nunca un loop, nunca más de un reintento.
      if ((err as { authFailure?: boolean }).authFailure) {
        console.log("  TikTok dice que el token no es válido pese a no estar vencido por fecha - refrescando y reintentando UNA vez...");
        credentials = await ensureFreshAccessToken(accountId, { ...credentials, obtained_at: new Date(0).toISOString() }); // fuerza el refresh
        initResult = await initUpload(credentials.access_token, plan);
      } else {
        throw err;
      }
    }
    publishId = initResult.publishId;
    console.log(`  OK — publish_id=${publishId}`);
    console.log(`  Subiendo bytes del video (${plan.totalChunkCount} PUT(s) directo(s) a TikTok, secuencial)...`);
    await uploadChunks(initResult.uploadUrl, args.file, plan);
    console.log("  OK — video subido.");
  } catch (err) {
    console.error(`DETENIDO — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  console.log("\nPaso 6/6 — consultando estado (polling)...");
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

// Guard de ejecución directa (mismo patrón ya usado en
// scripts/pipeline/authorization.mts) - permite importar este archivo desde
// un test (para probar planUploadChunks()/validateUploadPlan(), exportadas
// arriba) sin disparar main() ni tocar Supabase/red.
const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    console.error("Error inesperado:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
