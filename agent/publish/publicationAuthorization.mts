// Fase 5.14 — servicio central de autorización humana POR PUBLICACIÓN.
// Import de supabaseClient.mts a propósito (necesita leer/escribir Supabase
// real) - la lógica pura que SÍ es testeable sin conexión vive en
// humanReviewGate.mts, mismo patrón ya establecido en claimPost.mts/
// channelAuthorization.mts.
//
// IMPORTANTE (ver docs/phase-5.14-human-review.md): las columnas
// `publication_authorized_at`/`publication_authorized_by` todavía NO existen
// en producción real (propuestas en supabase/schema.sql, no aplicadas). Las
// funciones de este archivo hacen sus comprobaciones de elegibilidad
// (existencia del post, status) usando SOLO columnas que ya existen hoy -
// pero el paso final de lectura/escritura de esas 2 columnas nuevas
// necesita, inevitablemente, que la migración ya esté aplicada. Si se llama
// contra Supabase real sin la migración aplicada, Postgres devuelve un error
// claro ("column does not exist") - NUNCA se silencia ni se confunde con
// "post no encontrado" o cualquier otro resultado.
import { supabaseAdmin } from "../supabaseClient.mts";
import { evaluateAuthorizationEligibility, isPublicationAuthorized } from "./humanReviewGate.mts";

export type AuthorizePublicationResult =
  | { ok: true; alreadyAuthorized: boolean; authorizedAt: string; authorizedBy: string }
  | { ok: false; reason: string };

export type RevokePublicationAuthorizationResult = { ok: true } | { ok: false; reason: string };

// Idempotente por diseño: si el post YA está autorizado, se devuelve la
// autorización EXISTENTE tal cual (nunca se sobreescribe silenciosamente
// quién/cuándo autorizó primero) - una "re-autorización" accidental de la
// misma persona u otra nunca debe borrar el registro original.
export async function authorizePublication(postId: string, authorizedBy: string): Promise<AuthorizePublicationResult> {
  if (typeof authorizedBy !== "string" || authorizedBy.trim().length === 0) {
    return { ok: false, reason: "authorizedBy vacío - toda autorización debe identificar explícitamente a la persona que la otorga." };
  }

  // Paso 1 — SOLO columnas que YA existen hoy (id, status). Deliberadamente
  // separado del paso 2: esto hace que "post inexistente" y "post ya
  // publicado" sean comprobables contra Supabase real HOY MISMO, sin
  // depender de que la migración de Fase 5.14 esté aplicada (ver
  // docs/phase-5.14-human-review.md).
  const { data: post, error } = await supabaseAdmin.from("social_posts").select("id, status").eq("id", postId).maybeSingle();
  if (error) {
    return { ok: false, reason: `Error consultando el post: ${error.message}` };
  }
  if (!post) {
    return { ok: false, reason: `No existe ningún social_post con id='${postId}'.` };
  }

  const eligibility = evaluateAuthorizationEligibility(post.status);
  if (!eligibility.eligible) {
    return { ok: false, reason: eligibility.reason! };
  }

  // Paso 2 — a partir de aquí SÍ se necesitan las 2 columnas nuevas. Si la
  // migración todavía no está aplicada, Postgres devuelve un error claro
  // aquí (nunca antes, nunca confundido con "post no encontrado").
  const { data: authState, error: authError } = await supabaseAdmin
    .from("social_posts")
    .select("publication_authorized_at, publication_authorized_by")
    .eq("id", postId)
    .maybeSingle();
  if (authError) {
    return { ok: false, reason: `Error consultando el estado de autorización (¿la migración de Fase 5.14 ya está aplicada en Supabase?): ${authError.message}` };
  }
  if (!authState) {
    return { ok: false, reason: `El post ${postId} desapareció entre la primera y la segunda consulta - no se pudo confirmar la autorización.` };
  }

  if (isPublicationAuthorized(authState)) {
    // Ya autorizado - se devuelve la autorización existente sin tocarla.
    return {
      ok: true,
      alreadyAuthorized: true,
      authorizedAt: authState.publication_authorized_at as string,
      authorizedBy: authState.publication_authorized_by as string,
    };
  }

  // UPDATE atomico condicionado al status EXACTO leido en el Paso 1 (no un
  // valor hardcodeado): evaluateAuthorizationEligibility() acepta varios
  // estados (todos salvo 'published'), asi que la condicion correcta no es
  // "WHERE status='verification_required'" fijo, sino "WHERE status sigue
  // siendo el mismo que se valido" - cubre TODA la ventana desde la lectura
  // inicial (Paso 1) hasta esta escritura, incluida la lectura intermedia
  // del Paso 2. Si CUALQUIER otro proceso cambio el status mientras tanto
  // (ej. resolveVerificationRequired(..., "retry", ...) moviendo el post a
  // 'pending' y limpiando la autorizacion en el mismo instante), este UPDATE
  // no afecta ninguna fila y la autorizacion tardia queda rechazada - mismo
  // patron atomico que claimPost()/resolveVerificationRequired()/recoverStaleClaims().
  const authorizedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("social_posts")
    .update({ publication_authorized_at: authorizedAt, publication_authorized_by: authorizedBy })
    .eq("id", postId)
    .eq("status", post.status)
    .select("publication_authorized_at, publication_authorized_by")
    .maybeSingle();

  if (updateError) {
    return { ok: false, reason: `Error persistiendo la autorización: ${updateError.message}` };
  }
  if (!updated) {
    return {
      ok: false,
      reason: `El estado del post ${postId} cambió (ya no es '${post.status}') entre la lectura inicial y la escritura - otro proceso lo modificó primero. No se aplicó esta autorización.`,
    };
  }

  return {
    ok: true,
    alreadyAuthorized: false,
    authorizedAt: updated.publication_authorized_at as string,
    authorizedBy: updated.publication_authorized_by as string,
  };
}

// Revoca una autorización existente - solo tiene sentido ANTES de que el
// post sea reclamado/publicado. Bloqueada para 'published' por el mismo
// motivo que authorizePublication(): no tiene efecto útil revocar algo que
// ya ocurrió, y podría sugerir engañosamente que la publicación real "se
// deshizo" (nunca es el caso - revocar nunca despublica nada).
export async function revokePublicationAuthorization(postId: string): Promise<RevokePublicationAuthorizationResult> {
  const { data: post, error } = await supabaseAdmin.from("social_posts").select("id, status").eq("id", postId).maybeSingle();
  if (error) return { ok: false, reason: `Error consultando el post: ${error.message}` };
  if (!post) return { ok: false, reason: `No existe ningún social_post con id='${postId}'.` };

  const eligibility = evaluateAuthorizationEligibility(post.status);
  if (!eligibility.eligible) {
    return { ok: false, reason: eligibility.reason! };
  }

  // Mismo principio atomico que authorizePublication(): condicionar al
  // status EXACTO leido arriba, no solo al id, para que un cambio de estado
  // concurrente (por cualquier otro proceso) impida una revocacion tardia
  // sobre un post que ya paso a otro estado.
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("social_posts")
    .update({ publication_authorized_at: null, publication_authorized_by: null })
    .eq("id", postId)
    .eq("status", post.status)
    .select("id")
    .maybeSingle();
  if (updateError) return { ok: false, reason: `Error revocando la autorización: ${updateError.message}` };
  if (!updated) {
    return {
      ok: false,
      reason: `El estado del post ${postId} cambió (ya no es '${post.status}') entre la lectura inicial y la escritura - otro proceso lo modificó primero. No se aplicó esta revocación.`,
    };
  }
  return { ok: true };
}
