// Politica de reintentos usando UNICAMENTE social_posts.retry_count (columna ya
// existente desde la Fase 1, nunca antes usada en publicacion). Sin columnas nuevas.
import { MAX_RETRIES } from "./config.mts";

export type ErrorClass = "permanent" | "retryable";

// Esta funcion clasifica UNICAMENTE errores lanzados al intentar publicar de
// verdad (fallo de red/API de una plataforma, o fallo de subida a Storage) -
// los fallos de resolucion de archivo/identidad ya traen su propio flag
// `retryable` explicito desde el origen (resolveContentFile.mts,
// resolveIdentity.mts) y no pasan por aqui.
//
// Fase 5.20 (Phase A4, auditoria post-piloto) — la clasificacion anterior
// (solo 401/403 = permanente, TODO lo demas = retryable) era demasiado
// generica: un 400 (peticion malformada) o un 404 (recurso inexistente)
// nunca se arreglan solos reintentando, pero se trataban igual que un 500
// transitorio. Tabla explicita, basada en la semantica real de cada codigo:
//   - NO retryable: 400 (peticion invalida), 401/403 (credenciales/permiso
//     invalido), 404 (recurso/endpoint inexistente) - ninguno se resuelve
//     repitiendo la misma llamada.
//   - Retryable: 408 (timeout del lado servidor), 429 (rate limit - se
//     espera que se libere), 500/502/503/504 (fallos transitorios del
//     servidor) - candidatos genuinos a "puede que la proxima vez funcione".
// Un mensaje SIN ninguno de estos codigos (ej. un error de red generico como
// "fetch failed"/ECONNRESET que YA paso por publishToYouTube/Instagram/
// Facebook sin convertirse en PublicationOutcomeUncertainError - ver
// Fase 5.20 Phase A2/A3, o cualquier error no HTTP) conserva el default
// seguro anterior: "retryable" - nunca se asume "permanente" sin evidencia
// explicita de un codigo que lo justifique.
//
// IMPORTANTE: esta funcion NUNCA ve un PublicationOutcomeUncertainError - ese
// tipo se intercepta ANTES, en run.mts (`if (err instanceof
// PublicationOutcomeUncertainError)`), precisamente para que un resultado
// incierto jamas se clasifique como retryable/permanente por esta tabla. Por
// eso "Uncertain" no es un tercer valor de ErrorClass: arquitectonicamente,
// nunca compite con esta clasificacion - vive en un camino completamente
// separado (ver agent/publish/claimPost.mts::finishWithUncertainOutcome).
const NOT_RETRYABLE_STATUSES = new Set([400, 401, 403, 404]);
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

// Pura, exportada para ser testeable de forma aislada. Los mensajes de este
// codebase siempre embeben el status HTTP como numero suelto (ej.
// `${res.status}`) - se busca el primer codigo RECONOCIDO (de la union de
// ambas tablas) como palabra completa, nunca un numero de 3 digitos
// arbitrario que pueda aparecer por coincidencia en otro contexto del texto.
const KNOWN_STATUS_PATTERN = /\b(400|401|403|404|408|429|500|502|503|504)\b/;

export function extractHttpStatus(message: string): number | null {
  const match = message.match(KNOWN_STATUS_PATTERN);
  return match ? Number(match[1]) : null;
}

export function classifyError(message: string): ErrorClass {
  const status = extractHttpStatus(message);
  if (status !== null) {
    if (NOT_RETRYABLE_STATUSES.has(status)) return "permanent";
    if (RETRYABLE_STATUSES.has(status)) return "retryable";
  }
  return "retryable"; // sin codigo reconocido - default seguro conservado (comportamiento previo)
}

export interface RetryDecision {
  nextStatus: "pending" | "error";
  nextRetryCount: number;
}

// currentRetryCount = el valor ANTES de este intento fallido.
export function decideRetry(errorClass: ErrorClass, currentRetryCount: number): RetryDecision {
  if (errorClass === "permanent") {
    return { nextStatus: "error", nextRetryCount: currentRetryCount };
  }
  const nextRetryCount = currentRetryCount + 1;
  if (nextRetryCount >= MAX_RETRIES) {
    return { nextStatus: "error", nextRetryCount };
  }
  return { nextStatus: "pending", nextRetryCount };
}
