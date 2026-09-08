// Politica de reintentos usando UNICAMENTE social_posts.retry_count (columna ya
// existente desde la Fase 1, nunca antes usada en publicacion). Sin columnas nuevas.
import { MAX_RETRIES } from "./config.mts";

export type ErrorClass = "permanent" | "retryable";

// Esta funcion clasifica UNICAMENTE errores lanzados al intentar publicar de
// verdad (fallo de red/API de una plataforma, o fallo de subida a Storage) -
// los fallos de resolucion de archivo/identidad ya traen su propio flag
// `retryable` explicito desde el origen (resolveContentFile.mts,
// resolveIdentity.mts) y no pasan por aqui.
const PERMANENT_PATTERNS: RegExp[] = [/\b401\b/, /\b403\b/];

export function classifyError(message: string): ErrorClass {
  return PERMANENT_PATTERNS.some((re) => re.test(message)) ? "permanent" : "retryable";
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
