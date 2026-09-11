// Fase 5.4 — decisión pura de qué hacer con un claim vencido (status='publishing'
// con claimed_at más viejo que STALE_CLAIM_MINUTES). Vive en su propio archivo,
// sin ningún import de supabaseClient.mts, por la misma razón que
// channelAuthorization.mts (Fase 5.2.1): supabaseClient.mts construye el
// cliente real al importarse y lanza sin credenciales — separarla es lo que
// permite probar esta lógica sin conexión real.
//
// CASO A (auditoría Fase 5.3-continuación, "publisher nunca pudo iniciarse"):
// publisher_operation_ref es NULL. Ver claimPost.mts/run.mts — este campo se
// escribe (con un valor no-nulo) INMEDIATAMENTE antes de llamar a publish(),
// para TODAS las plataformas, incluida Facebook (que nunca obtiene una
// referencia real de la plataforma) — por eso NULL es una garantía real de
// "nunca llegamos a intentar publicar", no una suposición.
//
// CASO B/C (misma auditoría, "el publisher pudo haberse iniciado" /
// "no podemos determinar el resultado"): publisher_operation_ref NO es nulo.
// Da igual si es una referencia real de la plataforma (uploadUrl, creationId)
// o el placeholder "pending:<platform>" (Facebook, o cualquier plataforma que
// muera antes de obtener su referencia real) — en ambos casos, la única
// acción segura desde recoverStaleClaims() es verification_required. La
// diferencia entre B y C solo importa para reconcileUnknownPublication()
// (reconciliation.mts), no para esta clasificación.
export type StaleClaimAction = "retry" | "verification_required";

export interface StaleClaimClassification {
  action: StaleClaimAction;
  reason: string;
}

export function classifyStaleClaim(publisherOperationRef: string | null | undefined): StaleClaimClassification {
  if (!publisherOperationRef) {
    return {
      action: "retry",
      reason: "publisher_operation_ref ausente — el publisher real nunca pudo haberse iniciado (CASO A).",
    };
  }
  return {
    action: "verification_required",
    reason: `publisher_operation_ref presente ('${publisherOperationRef}') — no se puede descartar que el publisher real se haya iniciado (CASO B/C). Requiere reconciliación o revisión humana, nunca reintento automático.`,
  };
}

// Distingue si un publisher_operation_ref es una referencia REAL de la
// plataforma (uploadUrl de YouTube, creationId de Instagram) o solo el
// placeholder de "intento marcado" escrito antes de conocer una referencia
// real (Facebook, o un crash entre marcar el intento y obtener la referencia
// real de YouTube/Instagram). Solo las referencias reales son candidatas a
// reconcileUnknownPublication() — un placeholder no tiene nada que consultar.
export function isRealOperationRef(publisherOperationRef: string | null | undefined): boolean {
  return typeof publisherOperationRef === "string" && publisherOperationRef.length > 0 && !publisherOperationRef.startsWith("pending:");
}

export function publishAttemptPlaceholder(platform: string): string {
  return `pending:${platform}`;
}
