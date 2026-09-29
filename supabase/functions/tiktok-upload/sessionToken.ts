// Token opaco cifrado (AES-256-GCM, Web Crypto — estandar, disponible tanto
// en Deno como en Node moderno) que reemplaza a una tabla nueva en Supabase
// para guardar el estado temporal entre INIT y los N requests de
// upload_chunk/status de una sesion de subida a TikTok.
//
// Por que un token cifrado y no una tabla: el estado (publish_id,
// upload_url, video_size, chunk plan, channel/account) solo necesita vivir
// durante la ventana de una subida (minutos, nunca mas de 1h — el propio
// upload_url de TikTok expira en 1h). Cifrarlo y devolverselo al browser
// como blob opaco evita: crear una tabla nueva con su propia limpieza de
// filas viejas, y cualquier necesidad de storage compartido entre
// invocaciones de la Edge Function (que son stateless). El browser nunca
// puede leer el contenido (AES-GCM, no solo firmado/base64) - upload_url
// jamas queda expuesto ahi. La clave (TIKTOK_UPLOAD_SESSION_KEY) es un
// secret nuevo, server-only, nunca compartido con el browser ni con TikTok.
//
// Sin dependencias de Deno.*/Node.* especificas - solo Web Crypto (SubtleCrypto)
// y JSON, para poder testear esto con Node (scripts/social/test-tiktok-session-token.mts)
// aunque `deno` no este instalado en esta maquina - ver el commit para la nota completa.

export interface UploadSessionPayload {
  publishId: string;
  uploadUrl: string;
  videoSize: number;
  chunkSize: number;
  totalChunkCount: number;
  accountId: string;
  channelName: string;
  exp: number; // epoch ms
}

const IV_LENGTH_BYTES = 12; // tamaño estandar recomendado para AES-GCM

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = base64ToBytes(base64Key);
  if (raw.length !== 32) {
    throw new Error(`TIKTOK_UPLOAD_SESSION_KEY debe decodificar a 32 bytes (AES-256), decodificó a ${raw.length}.`);
  }
  // "as BufferSource": TS(lib.dom) exige ArrayBuffer, no ArrayBufferLike
  // (que incluye SharedArrayBuffer) - un Uint8Array normal SIEMPRE está
  // respaldado por un ArrayBuffer real acá, nunca por un SharedArrayBuffer.
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSession(payload: UploadSessionPayload, base64Key: string): Promise<string> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext as BufferSource));
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);
  return bytesToBase64(combined);
}

export type DecryptResult = { ok: true; payload: UploadSessionPayload } | { ok: false; reason: string };

export async function decryptSession(token: string, base64Key: string): Promise<DecryptResult> {
  let combined: Uint8Array;
  try {
    combined = base64ToBytes(token);
  } catch {
    return { ok: false, reason: "session_id no es base64 válido." };
  }
  if (combined.length <= IV_LENGTH_BYTES) {
    return { ok: false, reason: "session_id demasiado corto para ser válido." };
  }
  const iv = combined.slice(0, IV_LENGTH_BYTES);
  const ciphertext = combined.slice(IV_LENGTH_BYTES);

  let key: CryptoKey;
  try {
    key = await importKey(base64Key);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, ciphertext as BufferSource);
  } catch {
    // AES-GCM falla el decrypt si el token fue alterado o cifrado con otra
    // clave - nunca se distingue el motivo exacto al que llama, por diseño
    // (evita dar pistas a un intento de manipulación).
    return { ok: false, reason: "session_id inválido o corrupto (fallo de autenticación AES-GCM)." };
  }

  let payload: UploadSessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return { ok: false, reason: "session_id descifrado no contiene JSON válido." };
  }

  if (typeof payload.exp !== "number" || Date.now() >= payload.exp) {
    return { ok: false, reason: "la sesión de subida expiró — hay que iniciar un nuevo 'init'." };
  }

  return { ok: true, payload };
}
