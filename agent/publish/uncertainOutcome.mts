// Fase 5.4.1 — vive en su propio archivo, sin ningún import de
// supabaseClient.mts a propósito: mismo motivo que
// staleClaimClassification.mts (Fase 5.4) / channelAuthorization.mts
// (Fase 5.2.1) — ese módulo construye el cliente Supabase real al
// importarse y lanza sin credenciales, lo que haría imposible probar esta
// lógica pura sin conexión real.
import { PublicationOutcomeUncertainError } from "../../lib/social/types.ts";
import type { SocialPlatform } from "../../lib/social/types.ts";

// Construye el payload SIN incluir claimed_at ni publisher_operation_ref a
// propósito: a diferencia de revertToPending()/finishWithFailure() (que
// SIEMPRE los limpian porque el proceso, vivo, observó directamente que la
// operación terminó de forma segura - éxito, fallo antes de publicar, o
// fallo HTTP normal), un resultado incierto significa que la plataforma
// pudo haber aceptado/publicado de verdad - la evidencia (uploadUrl/
// creationId/placeholder, y el propio claimed_at para auditoría) debe
// conservarse intacta para reconciliación o revisión humana.
export function buildUncertainOutcomeUpdatePayload(err: PublicationOutcomeUncertainError): Record<string, unknown> {
  return {
    status: "verification_required",
    error_message: err.message,
  };
}

// Fase 5.4.1 (segundo audit adversarial) — hallazgo simétrico al del
// parseo: si publish() ya tuvo éxito (externalPostId real conocido) pero la
// escritura final a Supabase falla, ES INCLUSO MÁS CIERTO que "incierto" -
// se conoce el ID real, solo falló persistirlo. Se reutiliza el mismo
// mecanismo (verification_required) para no inventar un tercer estado; el
// externalPostId ya conocido queda en el mensaje para que la reconciliación
// humana sea directa. Pura - sin I/O, testeable sin Supabase.
export function buildPersistenceFailureError(
  platform: SocialPlatform,
  externalPostId: string,
  persistError: { message: string }
): PublicationOutcomeUncertainError {
  return new PublicationOutcomeUncertainError(
    `La plataforma '${platform}' confirmó la publicación (external_post_id='${externalPostId}') pero no se pudo persistir el resultado en Supabase: ${persistError.message}`,
    { platform, operationRef: externalPostId, originalError: persistError }
  );
}

// Fase 5.4.3 (GAP 2 de la auditoría Fase 5.4.2) — finishWithUncertainOutcome()
// (claimPost.mts) descartaba el resultado del UPDATE que escribe
// 'verification_required' sin comprobar {error}/fila afectada. Si ese UPDATE
// falla (ej. hoy, antes de la migración: 'verification_required' viola el
// CHECK constraint real), el fallo quedaba completamente silencioso - la fila
// se queda huérfana en 'publishing' sin ninguna señal. Esta función pura
// construye el mensaje/metadata de log para ese caso - NUNCA decide volver a
// pending, NUNCA reintenta, NUNCA llama a publish(): eso ya es verdad por
// construcción (finishWithUncertainOutcome no hace ninguna otra escritura),
// esta función solo hace observable el fallo. causeMessage describe CÓMO
// falló (error de Postgres devuelto, fila no encontrada, o excepción/red) -
// no cambia el resultado, solo el detalle registrado.
export function buildUncertainOutcomePersistFailureLog(
  postId: string,
  err: PublicationOutcomeUncertainError,
  causeMessage: string
): { message: string; meta: Record<string, unknown> } {
  return {
    message:
      "[PUBLISH] No se pudo persistir 'verification_required' - el resultado incierto de la plataforma NO quedó reflejado en la fila (posible violación de constraint si la migración de Fase 5.4 aún no está aplicada, o fallo real de conexión). Requiere revisión manual directa contra Supabase - la fila puede seguir en 'publishing'.",
    meta: {
      postId,
      platform: err.platform,
      operationRef: err.operationRef,
      httpStatus: err.httpStatus,
      originalReason: err.message,
      persistFailureCause: causeMessage,
    },
  };
}
