// H4-C.1 — nucleo de ERROR RECOVERY (error -> pending), implementando
// EXCLUSIVAMENTE lo aprobado en ERROR RECOVERY CONTRACT v2 (informes H4-B/
// H4-B.1). Mismo patron de Dependency Injection + separacion pura/IO ya
// establecido en verificationResolution.mts/claimPost.mts::recoverStaleClaims():
// evaluateErrorRecoveryEligibility() es pura (testeable sin Supabase),
// recoverErrorPost() es el orquestador con IO real por defecto, inyectable
// en tests.
//
// Alcance DELIBERADAMENTE limitado a esta fase (ver instrucciones H4-C.1):
// SOLO el nucleo. NINGUN CLI todavia (H4-C.2), NINGUN publisher tocado,
// NINGUNA reconciliacion nueva, NINGUN cambio a H1/H2/H3/H5.
import { supabaseAdmin } from "../supabaseClient.mts";
import { MAX_RECOVERIES } from "./config.mts";
import { isRealOperationRef } from "./staleClaimClassification.mts";
import type { SocialPlatform } from "./types.mts";

const REQUIRED_STATUS = "error";

// ==================================================
// Decision PURA (sin IO) - Paso 4/5/6 del nucleo pedido. Separada para ser
// 100% testeable sin Supabase, mismo patron que evaluateChannelAuthorization()/
// evaluateAuthorizationEligibility()/classifyStaleClaim().
// ==================================================
export interface ErrorRecoveryEligibilitySnapshot {
  platform: SocialPlatform;
  publisher_operation_ref: string | null;
  external_post_id: string | null;
  recovery_count: number;
}

export type ErrorRecoveryEligibility =
  | { allowed: true }
  | { allowed: false; code: "FACEBOOK_EXTERNAL_OUTCOME_UNKNOWN" }
  | { allowed: false; code: "RECONCILIATION_REQUIRED"; reason: string }
  | { allowed: false; code: "RECOVERY_LIMIT_EXCEEDED" };

// Paso 4 (Facebook) — bloqueo INCONDICIONAL, nunca basado en error_message.
// Facebook nunca produce una referencia real (publishToFacebook() nunca
// llama a onOperationRef - ver lib/social/facebook.ts/lib/social/publishers.ts),
// asi que "publisher_operation_ref=null" para Facebook NO es evidencia de
// "nunca se intento publicar" (a diferencia de YouTube/Instagram, donde esa
// misma ausencia SI es una prueba activa - ver run.mts, la lectura fresca de
// publisher_operation_ref ya intercepta CUALQUIER evidencia real ANTES de
// que la fila llegue a 'error'). Motivo completo: informe H4-B.1 §1/§2.
//
// Paso 5 (evidencia externa) — isRealOperationRef() reutilizado SIN
// modificar (staleClaimClassification.mts); external_post_id!=null se trata
// con la MISMA severidad (evidencia de exito ya confirmado, no solo
// posible). Ninguno de los dos chequeos inspecciona error_message.
//
// Paso 6 (limite anti-loop) — recovery_count>=MAX_RECOVERIES rechaza ANTES
// de cualquier escritura. Evaluado aqui con el valor YA LEIDO (fresco) por
// el llamador - esta funcion nunca lee Supabase por si misma.
export function evaluateErrorRecoveryEligibility(snapshot: ErrorRecoveryEligibilitySnapshot): ErrorRecoveryEligibility {
  if (snapshot.platform === "facebook") {
    return { allowed: false, code: "FACEBOOK_EXTERNAL_OUTCOME_UNKNOWN" };
  }
  if (isRealOperationRef(snapshot.publisher_operation_ref)) {
    return {
      allowed: false,
      code: "RECONCILIATION_REQUIRED",
      reason: `publisher_operation_ref contiene evidencia de una operacion externa real - requiere reconciliacion (social:reconcile-${snapshot.platform}) antes de cualquier recovery. No se intenta inferir nada desde error_message.`,
    };
  }
  if (snapshot.external_post_id !== null) {
    return {
      allowed: false,
      code: "RECONCILIATION_REQUIRED",
      reason: "external_post_id no es null - la plataforma ya confirmo una publicacion real que no quedo reflejada correctamente. Requiere reconciliacion/revision manual directa, nunca un recovery automatico.",
    };
  }
  if (snapshot.recovery_count >= MAX_RECOVERIES) {
    return { allowed: false, code: "RECOVERY_LIMIT_EXCEEDED" };
  }
  return { allowed: true };
}

// Evidencia append-only en error_message - EXACTAMENTE el mismo patron ya
// establecido por buildRetryEvidence()/buildPublishedEvidence()
// (verificationResolution.mts): una linea prefijada con "[timestamp]", en
// prosa, nunca borra lo anterior (\n). NUNCA se relee para tomar decisiones
// de seguridad - ver evaluateErrorRecoveryEligibility() arriba, que nunca
// toca error_message. Pura, sin IO.
export function buildRecoveryEvidence(
  previousErrorMessage: string | null,
  operatorId: string,
  recoveryCountBefore: number,
  recoveryCountAfter: number,
  retryCountObserved: number,
  nowIso: string
): string {
  const line = `[${nowIso}] Recovery manual por '${operatorId}': error -> pending. recovery_count: ${recoveryCountBefore} -> ${recoveryCountAfter}. retry_count observado (NUNCA modificado por este recovery): ${retryCountObserved}. Confirmado en el momento de este recovery: sin evidencia de operacion externa real (publisher_operation_ref no era una referencia real, external_post_id era null). Autorizacion humana previa (si existia) fue limpiada en esta misma escritura - el siguiente intento real exige una autorizacion nueva y explicita.`;
  if (typeof previousErrorMessage === "string" && previousErrorMessage.trim().length > 0) {
    return `${previousErrorMessage}\n${line}`;
  }
  return line;
}

// ==================================================
// Orquestador - Pasos 1-8 del nucleo pedido.
// ==================================================
export interface ErrorRecoveryPostSnapshot {
  id: string;
  status: string;
  account_id: string;
  retry_count: number;
  publisher_operation_ref: string | null;
  external_post_id: string | null;
  claimed_at: string | null;
  publication_authorized_at: string | null;
  publication_authorized_by: string | null;
  error_message: string | null;
}

export interface ErrorRecoveryDeps {
  fetchPost: (postId: string) => Promise<ErrorRecoveryPostSnapshot | null>;
  // H4-C.1 — separada de fetchPost() A PROPOSITO: recovery_count es la UNICA
  // columna nueva de esta fase, todavia NO aplicada en produccion real (ver
  // supabase/schema.sql) - mismo patron YA establecido en
  // publicationAuthorization.mts para publication_authorized_at/_by (Paso 2
  // de ese archivo). Si la migracion no esta aplicada, Postgres devuelve
  // aqui un error claro, nunca confundido con "post no encontrado".
  fetchRecoveryCount: (postId: string) => Promise<number>;
  // social_posts NO tiene columna `platform` propia (se deriva de
  // social_accounts via account_id) - mismo patron ya usado por
  // instagramReconciliation.mts/reconcile-instagram.mts (fetchPost +
  // fetchAccount separados).
  fetchPlatform: (accountId: string) => Promise<SocialPlatform | null>;
  // true = esta llamada gano el UPDATE condicional (CAS: status='error' AND
  // recovery_count<MAX_RECOVERIES seguian vigentes en el instante del UPDATE).
  updateIfErrorAndUnderLimit: (postId: string, payload: Record<string, unknown>) => Promise<boolean>;
  now?: () => Date;
}

export type ErrorRecoveryResult =
  | { code: "POST_NOT_FOUND"; postId: string }
  | { code: "OPERATOR_ID_MISSING"; postId: string }
  | { code: "WRONG_STATUS"; postId: string; status: string }
  | { code: "ACCOUNT_NOT_FOUND"; postId: string } // defensivo, no pedido explicitamente - ver informe, fail-closed ante datos inconsistentes
  | { code: "FACEBOOK_EXTERNAL_OUTCOME_UNKNOWN"; postId: string }
  | { code: "RECONCILIATION_REQUIRED"; postId: string; reason: string }
  | { code: "RECOVERY_LIMIT_EXCEEDED"; postId: string; recoveryCount: number }
  | { code: "CONFLICT"; postId: string }
  | { code: "RECOVERED"; postId: string; recoveryCountBefore: number; recoveryCountAfter: number };

const defaultErrorRecoveryDeps: ErrorRecoveryDeps = {
  async fetchPost(postId) {
    const { data, error } = await supabaseAdmin
      .from("social_posts")
      .select("id, status, account_id, retry_count, publisher_operation_ref, external_post_id, claimed_at, publication_authorized_at, publication_authorized_by, error_message")
      .eq("id", postId)
      .maybeSingle();
    if (error) throw new Error(`Error al leer social_posts id=${postId}: ${error.message}`);
    return (data as ErrorRecoveryPostSnapshot | null) ?? null;
  },
  async fetchRecoveryCount(postId) {
    const { data, error } = await supabaseAdmin.from("social_posts").select("recovery_count").eq("id", postId).maybeSingle();
    if (error) {
      throw new Error(`Error al leer recovery_count para ${postId} (¿la migracion de H4-C.1 ya esta aplicada en Supabase? ver supabase/schema.sql): ${error.message}`);
    }
    if (!data) {
      throw new Error(`El post ${postId} desaparecio entre la lectura principal y la lectura de recovery_count - no se pudo confirmar el limite de recoveries.`);
    }
    return (data as { recovery_count: number | null }).recovery_count ?? 0;
  },
  async fetchPlatform(accountId) {
    const { data, error } = await supabaseAdmin.from("social_accounts").select("platform").eq("id", accountId).maybeSingle();
    if (error) throw new Error(`Error al leer social_accounts id=${accountId}: ${error.message}`);
    return (data?.platform as SocialPlatform | undefined) ?? null;
  },
  // Paso 7 pedido: UNA sola escritura atomica. CAS: status='error' AND
  // recovery_count<MAX_RECOVERIES - si CUALQUIERA de las dos condiciones ya
  // no coincide (otro recovery ganó primero, o el limite se alcanzo entre la
  // lectura y esta escritura), 0 filas afectadas, NUNCA un segundo intento.
  async updateIfErrorAndUnderLimit(postId, payload) {
    const { data, error } = await supabaseAdmin
      .from("social_posts")
      .update(payload)
      .eq("id", postId)
      .eq("status", REQUIRED_STATUS)
      .lt("recovery_count", MAX_RECOVERIES)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`Error al recuperar social_post ${postId} (error -> pending): ${error.message}`);
    return !!data;
  },
};

// Paso 1: validar operatorId (string no vacio, trim) -> Paso 2: fresh SELECT
// (post + platform + recovery_count, TRES lecturas independientes, nunca el
// objeto en memoria de ningun llamador anterior) -> Paso 3: status==='error'
// exacto -> Pasos 4/5/6: evaluateErrorRecoveryEligibility() (pura) -> Paso 7:
// UNA escritura CAS -> Paso 8: interpretar el resultado del CAS (1 fila =
// RECOVERED, 0 filas = CONFLICT, NUNCA un segundo UPDATE).
export async function recoverErrorPost(
  postId: string,
  operatorId: string,
  deps: ErrorRecoveryDeps = defaultErrorRecoveryDeps
): Promise<ErrorRecoveryResult> {
  // Paso 1 — CERO lectura/escritura si esto falla.
  if (typeof operatorId !== "string" || operatorId.trim().length === 0) {
    return { code: "OPERATOR_ID_MISSING", postId };
  }

  // Paso 2 — fresh SELECT, nunca reutiliza objetos antiguos.
  const post = await deps.fetchPost(postId);
  if (!post) {
    return { code: "POST_NOT_FOUND", postId };
  }

  // Paso 3 — CERO escritura si el status no es exactamente 'error'.
  if (post.status !== REQUIRED_STATUS) {
    return { code: "WRONG_STATUS", postId, status: post.status };
  }

  const platform = await deps.fetchPlatform(post.account_id);
  if (!platform) {
    // Defensivo (dato inconsistente: la cuenta referenciada no existe) - fail
    // closed, CERO escritura. No pedido explicitamente en la especificacion,
    // pero requerido para nunca fabricar/asumir una plataforma (ver
    // instrucciones generales de este proyecto: nunca inventar IDs/resultados).
    return { code: "ACCOUNT_NOT_FOUND", postId };
  }

  const recoveryCountBefore = await deps.fetchRecoveryCount(postId);

  // Pasos 4/5/6 — decision PURA, sin tocar error_message.
  const eligibility = evaluateErrorRecoveryEligibility({
    platform,
    publisher_operation_ref: post.publisher_operation_ref,
    external_post_id: post.external_post_id,
    recovery_count: recoveryCountBefore,
  });
  if (!eligibility.allowed) {
    if (eligibility.code === "FACEBOOK_EXTERNAL_OUTCOME_UNKNOWN") {
      return { code: "FACEBOOK_EXTERNAL_OUTCOME_UNKNOWN", postId };
    }
    if (eligibility.code === "RECONCILIATION_REQUIRED") {
      return { code: "RECONCILIATION_REQUIRED", postId, reason: eligibility.reason };
    }
    return { code: "RECOVERY_LIMIT_EXCEEDED", postId, recoveryCount: recoveryCountBefore };
  }

  // Paso 7 — UNA escritura atomica. retry_count y external_post_id
  // DELIBERADAMENTE ausentes del payload (nunca se tocan). claimed_at/
  // publisher_operation_ref/publication_authorized_at/_by limpiados en la
  // MISMA escritura (defensivo - ya deberian ser null/limpios al llegar
  // aqui, pero se limpian explicitamente por el mismo principio de defensa
  // en profundidad ya aplicado en toda esta capa).
  const nowIso = (deps.now ? deps.now() : new Date()).toISOString();
  const recoveryCountAfter = recoveryCountBefore + 1;
  const payload: Record<string, unknown> = {
    status: "pending",
    recovery_count: recoveryCountAfter,
    claimed_at: null,
    publisher_operation_ref: null,
    publication_authorized_at: null,
    publication_authorized_by: null,
    error_message: buildRecoveryEvidence(post.error_message, operatorId, recoveryCountBefore, recoveryCountAfter, post.retry_count, nowIso),
  };

  // Paso 8 — interpretar el resultado del CAS. 0 filas: CONFLICT, sin ningun
  // segundo UPDATE ni ningun intento de "corregir" - se respeta lo que sea
  // que la fila tenga ahora (otro recovery gano, o el limite se alcanzo
  // entre la lectura y esta escritura).
  const updated = await deps.updateIfErrorAndUnderLimit(postId, payload);
  if (!updated) {
    return { code: "CONFLICT", postId };
  }
  return { code: "RECOVERED", postId, recoveryCountBefore, recoveryCountAfter };
}
