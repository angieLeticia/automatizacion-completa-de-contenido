// Fase 21 (parte 1) — cierre operativo de `verification_required`. Funcion
// de dominio + persistencia, aislada y testeable, siguiendo EXACTAMENTE el
// mismo patron de Dependency Injection que recoverStaleClaims()
// (claimPost.mts): se extraen unicamente las DOS operaciones de persistencia
// que esta funcion necesita (leer el post, UPDATE atomico condicional), con
// un default que reproduce el mismo SELECT/UPDATE contra supabaseAdmin.
//
// Alcance DELIBERADAMENTE limitado a esta fase (ver auditoria previa "AUDIT:
// OPERATIONAL CLOSURE OF verification_required"): solo la transicion de
// reconciliacion en si (published/retry/keep-blocked). NO llama a
// authorizePublication() - autorizar un nuevo intento de publicacion es una
// decision DISTINTA, a disenar como fase separada.
//
// creationId != external_post_id (auditoria de reconciliacion, fase previa):
// la rama "published" NUNCA escribe publisher_operation_ref en
// external_post_id - external_post_id permanece exactamente como estaba,
// null o no.
import { supabaseAdmin } from "../supabaseClient.mts";
import { isPublicationAuthorized } from "./humanReviewGate.mts";

export type VerificationDecision = "published" | "retry" | "keep-blocked";

export interface VerificationPostSnapshot {
  id: string;
  status: string;
  publisher_operation_ref: string | null;
  error_message: string | null;
  // Fase 21 (parte 2, cierre del Gap #2 de la auditoria E2E) - se leen
  // UNICAMENTE para poder describir con precision, en la evidencia de texto
  // de la rama "retry", si de verdad habia una autorizacion previa que se
  // esta limpiando (Caso 4 de test-verification-resolution.mts) - nunca se
  // escriben aqui, solo se leen. isPublicationAuthorized() (humanReviewGate.mts,
  // SIN modificar) ya es la fuente de verdad para esta comprobacion.
  publication_authorized_at: string | null;
  publication_authorized_by: string | null;
}

export interface VerificationResolutionDeps {
  fetchPost: (postId: string) => Promise<VerificationPostSnapshot | null>;
  // true = esta llamada gano el UPDATE condicional (WHERE status='verification_required' seguia vigente).
  updateIfVerificationRequired: (postId: string, payload: Record<string, unknown>) => Promise<boolean>;
  now?: () => Date;
}

export type VerificationResolutionResult =
  | { code: "POST_NOT_FOUND"; postId: string }
  | { code: "WRONG_STATUS"; postId: string; status: string }
  | { code: "OPERATOR_ID_MISSING"; postId: string }
  | { code: "CONFLICT"; postId: string; decision: VerificationDecision }
  | { code: "RESOLVED_PUBLISHED"; postId: string; publishedAt: string }
  | { code: "RESOLVED_RETRY"; postId: string }
  | { code: "RESOLVED_KEEP_BLOCKED"; postId: string };

const REQUIRED_STATUS = "verification_required";

// Pura - separada para poder testear el texto exacto de la evidencia sin
// pasar por Supabase. Conserva el error_message anterior (si existe) en vez
// de descartarlo - "no borres la evidencia anterior de forma innecesaria".
export function buildPublishedEvidence(previousErrorMessage: string | null, operationRef: string | null, operatorId: string, nowIso: string): string {
  const line = `[${nowIso}] Reconciliacion cerrada manualmente por '${operatorId}': CONFIRMED_PUBLISHED. publisher_operation_ref/creationId original: ${operationRef ?? "ninguno"}.`;
  if (typeof previousErrorMessage === "string" && previousErrorMessage.trim().length > 0) {
    return `${previousErrorMessage}\n${line}`;
  }
  return line;
}

// Fase 21 (parte 2, cierre del Gap #2 "sin evidencia de retry" de la
// auditoria E2E) — misma convencion EXACTA que buildPublishedEvidence()
// (unica convencion existente en este archivo para acumular evidencia en
// error_message: una linea prefijada con "[timestamp]", en prosa, append-only
// via "\n"; NUNCA se inventa un formato nuevo tipo bloque-con-tags). Pura,
// sin I/O, testeable de forma aislada.
//
// "reconciliation=no proporcionado" es deliberado: resolveVerificationRequired()
// recibe UNICAMENTE (postId, decision, operatorId) - nunca el resultado real
// de reconcile-instagram.mts (esa herramienta imprime su resultado solo por
// stdout, nunca lo persiste - ver reconcile-instagram.mts:62). Cambiar la
// firma para aceptar ese resultado es una decision de API que esta fase
// deliberadamente NO toma (ver auditoria previa a esta implementacion) - la
// evidencia distingue honestamente "no se nos proporciono" de "se confirmo
// tal cosa", nunca inventa ni asume un resultado de Meta.
export function buildRetryEvidence(previousErrorMessage: string | null, operationRef: string | null, wasAuthorized: boolean, operatorId: string, nowIso: string): string {
  const line = `[${nowIso}] Resolucion manual RETRY por '${operatorId}': verification_required -> pending. publisher_operation_ref anterior: ${operationRef ?? "ninguno"} (limpiado en esta misma operacion). Autorizacion humana previa: ${wasAuthorized ? "SI existia - limpiada en esta misma operacion" : "no existia"}. Resultado de reconciliacion: no proporcionado a esta funcion (resolveVerificationRequired() no lo recibe como parametro).`;
  if (typeof previousErrorMessage === "string" && previousErrorMessage.trim().length > 0) {
    return `${previousErrorMessage}\n${line}`;
  }
  return line;
}

const defaultVerificationResolutionDeps: VerificationResolutionDeps = {
  async fetchPost(postId) {
    const { data, error } = await supabaseAdmin
      .from("social_posts")
      .select("id, status, publisher_operation_ref, error_message, publication_authorized_at, publication_authorized_by")
      .eq("id", postId)
      .maybeSingle();
    if (error) throw new Error(`Error al leer social_posts id=${postId}: ${error.message}`);
    return (data as VerificationPostSnapshot | null) ?? null;
  },
  async updateIfVerificationRequired(postId, payload) {
    const { data, error } = await supabaseAdmin
      .from("social_posts")
      .update(payload)
      .eq("id", postId)
      .eq("status", REQUIRED_STATUS)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`Error al resolver verification_required para ${postId}: ${error.message}`);
    return !!data;
  },
};

// Validacion de entrada ANTES de tocar la fila (mismo orden que
// instagramReconciliation.mts): operatorId presente -> post existe ->
// status EXACTAMENTE 'verification_required'. Cualquier otro estado
// (pending/publishing/published/error) se rechaza ANTES del UPDATE, sin
// intentar corregirlo. 'keep-blocked' pasa por las MISMAS validaciones de
// entrada (el operador debe seguir identificandose, y el post debe seguir
// existiendo/estar en el estado esperado) pero nunca ejecuta un UPDATE - es
// un resultado explicito de "no actuar todavia", no un no-op silencioso.
export async function resolveVerificationRequired(
  postId: string,
  decision: VerificationDecision,
  operatorId: string,
  deps: VerificationResolutionDeps = defaultVerificationResolutionDeps
): Promise<VerificationResolutionResult> {
  if (typeof operatorId !== "string" || operatorId.trim().length === 0) {
    return { code: "OPERATOR_ID_MISSING", postId };
  }

  const post = await deps.fetchPost(postId);
  if (!post) {
    return { code: "POST_NOT_FOUND", postId };
  }
  if (post.status !== REQUIRED_STATUS) {
    return { code: "WRONG_STATUS", postId, status: post.status };
  }

  if (decision === "keep-blocked") {
    return { code: "RESOLVED_KEEP_BLOCKED", postId };
  }

  const nowIso = (deps.now ? deps.now() : new Date()).toISOString();

  if (decision === "published") {
    // NUNCA incluye external_post_id ni publisher_operation_ref en el
    // payload - permanecen EXACTAMENTE como estaban (null o no). El
    // creationId original se conserva unicamente como TEXTO de evidencia en
    // error_message, nunca como valor de external_post_id.
    const payload = {
      status: "published",
      published_at: nowIso,
      error_message: buildPublishedEvidence(post.error_message, post.publisher_operation_ref, operatorId, nowIso),
    };
    const updated = await deps.updateIfVerificationRequired(postId, payload);
    if (!updated) return { code: "CONFLICT", postId, decision };
    return { code: "RESOLVED_PUBLISHED", postId, publishedAt: nowIso };
  }

  // decision === "retry" — mismo patron de limpieza que revertToPending()
  // (claimPost.mts), pero WHERE status='verification_required' en vez de
  // 'publishing'. NUNCA toca external_post_id, retry_count, account_id,
  // content_file_id - todos los gates existentes (DRY_RUN, channel_status,
  // identidad, hash, B2) se reevaluan solos en el proximo ciclo de run.mts
  // en cuanto el post vuelve a 'pending', sin ningun bypass. (error_message
  // SI se actualiza desde Fase 21 parte 2 - ver comentario de
  // buildRetryEvidence() mas abajo - siempre append-only, nunca sobrescribe.)
  //
  // publication_authorized_at/publication_authorized_by SE LIMPIAN aqui a
  // proposito (auditoria "HUMAN REVIEW FOR RETRY-AFTER-CONFIRMED_NOT_PUBLISHED"):
  // ninguna otra funcion del pipeline los toca jamas (ver claimPost.mts/run.mts),
  // asi que sobrevivirian intactos a esta transicion si no se limpiaran aqui -
  // permitiendo que una autorizacion humana anterior (dada ANTES del intento
  // ambiguo) cubriera automaticamente un segundo intento real sin que ningun
  // humano haya revisado el resultado CONFIRMED_NOT_PUBLISHED. La resolucion
  // del estado y la autorizacion de un nuevo intento son decisiones
  // independientes - esta rama NUNCA llama a authorizePublication() ni a
  // revokePublicationAuthorization(): limpia los dos campos directamente en
  // el MISMO UPDATE atomico condicional, para que nunca exista un instante
  // intermedio donde el post este en 'pending' pero todavia "autorizado".
  // Fase 21 (parte 2) — error_message ahora tambien se actualiza en esta
  // MISMA escritura atomica (buildRetryEvidence(), append-only, nunca borra
  // lo anterior) para dejar constancia de quien decidio el retry, cuando, y
  // si habia una autorizacion previa que se limpio - cierra el Gap #2 de la
  // auditoria E2E sin agregar un segundo UPDATE ni una ventana intermedia.
  const wasAuthorized = isPublicationAuthorized(post);
  const payload = {
    status: "pending",
    claimed_at: null,
    publisher_operation_ref: null,
    publication_authorized_at: null,
    publication_authorized_by: null,
    error_message: buildRetryEvidence(post.error_message, post.publisher_operation_ref, wasAuthorized, operatorId, nowIso),
  };
  const updated = await deps.updateIfVerificationRequired(postId, payload);
  if (!updated) return { code: "CONFLICT", postId, decision };
  return { code: "RESOLVED_RETRY", postId };
}
