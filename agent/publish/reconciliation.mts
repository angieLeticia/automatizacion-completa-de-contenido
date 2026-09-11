// Fase 5.4 — reconcileUnknownPublication(): decide si un post en
// verification_required realmente se publicó, consultando a la plataforma
// real cuando existe una referencia real (ver staleClaimClassification.mts).
// NO es un publisher genérico — cada plataforma tiene su propia función de
// consulta, con su propia semántica verificada contra documentación oficial
// (ver docs/phase-5.4-claim-recovery.md para las fuentes exactas).
//
// Separación deliberada: las funciones "map*Status" de abajo son PURAS (sin
// red, sin Supabase) y testeables de forma aislada — son las que de verdad
// deciden el resultado. Las funciones "reconcile*" que sí llaman a la
// plataforma real son wrappers finos alrededor de esas funciones puras; no
// se pueden probar sin credenciales reales de OAuth (NOT VERIFIED AGAINST
// REAL PLATFORM, ver informe de Fase 5.4).
import { isRealOperationRef } from "./staleClaimClassification.mts";
import type { SocialPlatform } from "./types.mts";

export type ReconciliationResult = "CONFIRMED_PUBLISHED" | "CONFIRMED_NOT_PUBLISHED" | "CANNOT_VERIFY";

// --- YouTube ---------------------------------------------------------------
// CONFIRMADO (developers.google.com/youtube/v3/guides/using_resumable_upload_protocol):
// un PUT vacío al mismo uploadUrl con "Content-Range: bytes */CONTENT_LENGTH"
// devuelve 201 si la subida ya se completó, o 308 con header Range indicando
// cuántos bytes se recibieron si sigue incompleta. 404 = la sesión expiró
// (duración exacta NOT VERIFIED en la documentación oficial que se consultó).
export function mapYouTubeResumableStatus(httpStatus: number): ReconciliationResult {
  if (httpStatus === 201) return "CONFIRMED_PUBLISHED";
  if (httpStatus === 308) return "CONFIRMED_NOT_PUBLISHED"; // incompleta -> nunca genera un video visible, seguro reintentar desde cero
  if (httpStatus === 404) return "CANNOT_VERIFY"; // sesión expirada, sin evidencia recuperable por esta vía
  return "CANNOT_VERIFY"; // cualquier otro código: no se adivina, no hay evidencia suficiente
}

// Fase 5.10 — envuelto en try/catch a propósito: un fallo de red (timeout,
// DNS, conexión rechazada) o cualquier otra excepción durante el fetch NO
// debe propagarse sin control - la única conclusión segura ante "no pudimos
// ni siquiera completar la consulta" es la misma que ante una respuesta
// ambigua (CANNOT_VERIFY/UNKNOWN), nunca una excepción sin clasificar que
// podría dejar a quien llame en un estado indefinido. No cambia ningún caso
// que ya devolvía CANNOT_VERIFY (404/500/etc. via mapYouTubeResumableStatus)
// - solo cubre el caso, antes no manejado, en que el fetch mismo nunca
// resuelve con una respuesta.
export async function reconcileYouTube(uploadUrl: string, contentLength: string): Promise<ReconciliationResult> {
  try {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Range": `bytes */${contentLength}` },
    });
    return mapYouTubeResumableStatus(res.status);
  } catch {
    return "CANNOT_VERIFY";
  }
}

// --- Instagram ---------------------------------------------------------------
// CONFIRMADO (developers.facebook.com/docs/instagram-platform/content-publishing/):
// GET /{creation_id}?fields=status_code está pensado explícitamente para este
// escenario (media_publish no devolvió el ID final). PUBLISHED = ya se
// publicó de verdad. FINISHED = el contenedor sigue vivo, aún no publicado
// (no es un resultado terminal de reconciliación — sería seguro reintentar
// media_publish sobre el MISMO creationId, una acción distinta a
// reconcileUnknownPublication). ERROR = confirmado que no se publicó.
// EXPIRED = contenedor perdido (>24h), sin evidencia recuperable.
export function mapInstagramContainerStatus(statusCode: string): ReconciliationResult {
  switch (statusCode) {
    case "PUBLISHED":
      return "CONFIRMED_PUBLISHED";
    case "ERROR":
      return "CONFIRMED_NOT_PUBLISHED";
    case "EXPIRED":
      return "CANNOT_VERIFY";
    case "FINISHED":
    case "IN_PROGRESS":
      return "CANNOT_VERIFY"; // no es un resultado terminal; no se adivina
    default:
      return "CANNOT_VERIFY";
  }
}

// Fase 5.10 — mismo motivo que reconcileYouTube(): un fallo de red ANTES de
// cualquier respuesta, o una respuesta con cuerpo malformado (JSON inválido,
// campo status_code ausente), deben resolver a CANNOT_VERIFY/UNKNOWN en vez
// de lanzar. `!res.ok` ya cubría rechazos HTTP normales (401/403/404/429/5xx)
// - esto añade la cobertura para lo que ocurre ANTES o DESPUÉS de esa
// comprobación (el propio fetch, o el parseo del cuerpo).
export async function reconcileInstagram(creationId: string, accessToken: string): Promise<ReconciliationResult> {
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${creationId}?fields=status_code&access_token=${accessToken}`);
    if (!res.ok) return "CANNOT_VERIFY";
    const data = (await res.json()) as { status_code: string };
    if (typeof data.status_code !== "string") return "CANNOT_VERIFY";
    return mapInstagramContainerStatus(data.status_code);
  } catch {
    return "CANNOT_VERIFY";
  }
}

// --- Facebook ---------------------------------------------------------------
// NOT VERIFIED / no encontrado en developers.facebook.com/docs/graph-api/reference/page/videos/:
// ningún mecanismo de consulta posterior con la implementación actual (que
// usa el método simple de una sola llamada con file_url, no el protocolo de
// subida por fases que la documentación menciona pero que este código no
// usa). No se inventa una capacidad que no está confirmada.

export interface ReconciliationContext {
  // YouTube necesita el Content-Length ORIGINAL del archivo para construir
  // "Content-Range: bytes */TOTAL" — no viaja en credentials (que son solo
  // credenciales de autenticación), se calcula del archivo local real en el
  // momento de reconciliar (statSync del mismo content_files.file_path que
  // resolveAndVerifyContentFile ya validó).
  youtubeContentLength?: string;
}

export async function reconcileUnknownPublication(
  platform: SocialPlatform,
  operationRef: string | null | undefined,
  credentials: Record<string, string>,
  context: ReconciliationContext = {}
): Promise<ReconciliationResult> {
  if (!isRealOperationRef(operationRef)) {
    // Facebook siempre cae aquí (nunca tiene una referencia real); también
    // cualquier plataforma que muriera antes de obtener su referencia real.
    return "CANNOT_VERIFY";
  }
  switch (platform) {
    case "youtube": {
      if (!context.youtubeContentLength) return "CANNOT_VERIFY"; // no se puede consultar sin el tamaño original del archivo
      return reconcileYouTube(operationRef as string, context.youtubeContentLength);
    }
    case "instagram":
      return reconcileInstagram(operationRef as string, credentials.access_token);
    default:
      return "CANNOT_VERIFY";
  }
}
