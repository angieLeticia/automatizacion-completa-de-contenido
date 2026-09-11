// Fase 5.14 — cierra la brecha encontrada en la auditoría de Fase 5.13:
// `publication_authorized_at`/`publication_authorized_by` existían en
// supabase/schema.sql pero ningún código los leía ni los escribía. Este
// archivo vive SIN ningún import de supabaseClient.mts, exactamente por el
// mismo motivo que channelAuthorization.mts (Fase 5.2.1)/staleClaimClassification.mts
// (Fase 5.4): supabaseClient.mts construye el cliente real al importarse y
// lanza sin credenciales - separar la lógica pura es lo que permite probarla
// sin conexión real.
//
// Filosofía DELIBERADAMENTE distinta a CLAIMED_AT_MIGRATION_APPLIED: aquella
// bandera hace que código nuevo sea un NO-OP mientras la migración no está
// aplicada (seguro porque su ausencia no desbloqueaba nada). Aquí, al
// contrario, la ausencia de la migración/autorización debe BLOQUEAR
// activamente - por eso no existe ninguna bandera "aplicado/no aplicado":
// isPublicationAuthorized() simplemente trata "el campo no existe todavía"
// exactamente igual que "el campo existe pero es null" -> NUNCA autorizado.
// Ningún post puede publicarse por accidente solo porque la migración no se
// aplicó; ocurre lo contrario, todo permanece bloqueado por defecto.
import type { SocialPostStatus } from "./types.mts";

export interface AuthorizationFields {
  publication_authorized_at?: string | null;
  publication_authorized_by?: string | null;
}

// Requiere AMBOS campos presentes y no vacíos - un timestamp sin autor (o un
// autor sin timestamp) es una autorización incompleta/corrupta, nunca una
// autorización válida. No se "adivina" el campo faltante.
export function isPublicationAuthorized(post: AuthorizationFields): boolean {
  const hasTimestamp = typeof post.publication_authorized_at === "string" && post.publication_authorized_at.length > 0;
  const hasAuthor = typeof post.publication_authorized_by === "string" && post.publication_authorized_by.trim().length > 0;
  return hasTimestamp && hasAuthor;
}

export function describeAuthorizationGap(post: AuthorizationFields): string {
  if (isPublicationAuthorized(post)) return "autorizado";
  const hasTimestamp = typeof post.publication_authorized_at === "string" && post.publication_authorized_at.length > 0;
  const hasAuthor = typeof post.publication_authorized_by === "string" && post.publication_authorized_by.trim().length > 0;
  if (hasTimestamp && !hasAuthor) return "publication_authorized_at presente pero publication_authorized_by ausente/vacío - autorización incompleta, tratada como NO autorizada.";
  if (!hasTimestamp && hasAuthor) return "publication_authorized_by presente pero publication_authorized_at ausente - autorización incompleta, tratada como NO autorizada.";
  return "sin autorización humana (publication_authorized_at/publication_authorized_by ausentes) - pendiente de revisión.";
}

// Fase 5.14 — pre-condición de ELEGIBILIDAD para autorizar (no de PUBLICACIÓN):
// separada de isPublicationAuthorized() porque authorizePublication() la usa
// ANTES de tocar Supabase, con columnas que YA existen hoy (`status`), sin
// depender de que la migración de publication_authorized_at/_by esté
// aplicada - por eso es testeable contra Supabase real desde ya (Fase 5.14),
// a diferencia de la escritura real de las 2 columnas nuevas (que sí
// requiere la migración).
//
// Único caso bloqueado: 'published' - autorizar algo que ya ocurrió no tiene
// ningún efecto útil y podría confundir una auditoría futura ("¿por qué este
// post ya publicado tiene autorización de ayer?"). Cualquier otro estado
// (pending/publishing/error/verification_required) puede autorizarse sin
// riesgo: la autorización por sí sola nunca dispara nada, solo levanta UNA
// de las condiciones que run.mts ya exige para llegar al publisher.
export interface AuthorizationEligibility {
  eligible: boolean;
  reason?: string;
}

export function evaluateAuthorizationEligibility(status: SocialPostStatus): AuthorizationEligibility {
  if (status === "published") {
    return { eligible: false, reason: "El post ya está publicado (status='published') - no tiene sentido autorizar algo que ya ocurrió." };
  }
  return { eligible: true };
}
