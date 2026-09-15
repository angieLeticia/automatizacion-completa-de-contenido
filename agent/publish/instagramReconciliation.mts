// Fase 20 — orquestacion PURA/testable del comando operativo de
// reconciliacion de Instagram. Sin ejecucion al importar, sin leer Supabase
// directamente, sin llamar a Meta directamente - todo via `deps` inyectadas,
// exactamente el mismo patron ya usado en scripts/metaOAuthExchange.mts/
// scripts/metaAssetDiscovery.mts (fetch inyectable) para poder probar la
// logica completa con mocks, sin red real, sin credenciales reales.
//
// DISEÑO DE ESTA PRIMERA VERSION (auditoria FINAL_RECONCILIATION_SAFETY_AUDIT,
// fase previa): READ -> VERIFY -> REPORT. NUNCA decide-y-escribe. Ningun
// resultado de esta funcion produce, por si mismo, un UPDATE a social_posts -
// eso es una propiedad estructural, no una promesa: esta funcion no importa
// supabaseAdmin, no tiene ninguna funcion de escritura entre sus `deps`.
//
// IMPORTANTE (hallazgo de la auditoria previa, documentado aqui de forma
// permanente): `verification_required` NO puede convertirse en `pending` ni
// en `published` mediante un UPDATE simple sin condicion atomica equivalente
// al `WHERE status='pending'` que ya protege el claim original
// (agent/publish/claimPost.mts::claimPost()). Esta version NO escribe nada,
// asi que esa proteccion todavia no es necesaria - pero cualquier fase futura
// que SI escriba debe diseñar (no improvisar) un mecanismo de exclusion
// equivalente antes de tocar el estado de este post concurrentemente.
//
// creationId != external_post_id (confirmado con documentacion oficial de
// Meta en la auditoria previa: la respuesta de media_publish es la UNICA
// fuente documentada del ID final del medio publicado - el creationId nunca
// se convierte en ese valor, ni hay un GET que lo revele a partir del
// contenedor). Por eso CONFIRMED_PUBLISHED nunca escribe external_post_id.
import { isRealOperationRef } from "./staleClaimClassification.mts";

export interface ReconciliationPostRow {
  id: string;
  status: string;
  account_id: string;
  publisher_operation_ref: string | null;
}

export interface ReconciliationAccountRow {
  platform: string;
  credentials: Record<string, string>;
}

export interface IdentityCheckResult {
  status: string;
  reason: string;
}

export type ReconcileVerdict = "CONFIRMED_PUBLISHED" | "CONFIRMED_NOT_PUBLISHED" | "CANNOT_VERIFY";

export interface ReconciliationDeps {
  fetchPost: (postId: string) => Promise<ReconciliationPostRow | null>;
  fetchAccount: (accountId: string) => Promise<ReconciliationAccountRow | null>;
  verifyIdentity: (credentials: { ig_user_id: string; access_token: string }) => Promise<IdentityCheckResult>;
  reconcile: (creationId: string, accessToken: string) => Promise<ReconcileVerdict>;
  now?: () => Date;
}

// Cada variante lleva exactamente la informacion que el comando debe poder
// MOSTRAR - nunca mas de lo que realmente se conoce (ej. nunca un
// external_post_id inventado).
export type ReconciliationCommandResult =
  | { code: "POST_NOT_FOUND"; postId: string }
  | { code: "ACCOUNT_NOT_FOUND"; postId: string; accountId: string }
  | { code: "WRONG_PLATFORM"; postId: string; platform: string }
  | { code: "WRONG_STATUS"; postId: string; status: string }
  | { code: "MISSING_OPERATION_REF"; postId: string }
  | { code: "PLACEHOLDER_OPERATION_REF"; postId: string; ref: string }
  | { code: "CREDENTIALS_MISSING"; postId: string; missing: string[] }
  | { code: "IDENTITY_NOT_VERIFIED"; postId: string; identityStatus: string; reason: string }
  | { code: "CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW"; postId: string; creationId: string; reconciledAt: string }
  | { code: "CONFIRMED_NOT_PUBLISHED_REQUIRES_HUMAN_REVIEW"; postId: string; creationId: string; reconciledAt: string }
  | { code: "CANNOT_VERIFY"; postId: string; creationId: string; reconciledAt: string };

const REQUIRED_STATUS = "verification_required";
const REQUIRED_PLATFORM = "instagram";

// Pura salvo por las llamadas a `deps` (inyectadas por quien la use - reales
// en el CLI, mockeadas en los tests). Nunca importa supabaseAdmin ni fetch
// directamente - por eso es 100% testeable sin Supabase real y sin red real,
// mismo motivo por el que channelAuthorization.mts/staleClaimClassification.mts
// viven separados de supabaseClient.mts en este proyecto.
export async function runInstagramReconciliation(postId: string, deps: ReconciliationDeps): Promise<ReconciliationCommandResult> {
  const post = await deps.fetchPost(postId);
  if (!post) {
    return { code: "POST_NOT_FOUND", postId };
  }

  const account = await deps.fetchAccount(post.account_id);
  if (!account) {
    return { code: "ACCOUNT_NOT_FOUND", postId, accountId: post.account_id };
  }

  // Rechazo de plataforma ANTES de tocar Meta - este comando es
  // deliberadamente exclusivo de Instagram en esta primera version (Facebook/
  // YouTube/TikTok tienen semanticas de reconciliacion distintas o
  // inexistentes, fuera de alcance aqui).
  if (account.platform !== REQUIRED_PLATFORM) {
    return { code: "WRONG_PLATFORM", postId, platform: account.platform };
  }

  // Rechazo de estado ANTES de tocar Meta - unico estado de entrada aceptado.
  if (post.status !== REQUIRED_STATUS) {
    return { code: "WRONG_STATUS", postId, status: post.status };
  }

  const ref = post.publisher_operation_ref;
  if (!ref) {
    return { code: "MISSING_OPERATION_REF", postId };
  }
  // Nunca aceptar "pending:instagram" (u otro placeholder equivalente) como
  // si fuera un creationId real consultable - isRealOperationRef() ya existe
  // y ya es la fuente de verdad para esta distincion (staleClaimClassification.mts).
  if (!isRealOperationRef(ref)) {
    return { code: "PLACEHOLDER_OPERATION_REF", postId, ref };
  }

  const missingCreds: string[] = [];
  if (typeof account.credentials?.ig_user_id !== "string" || account.credentials.ig_user_id.length === 0) missingCreds.push("ig_user_id");
  if (typeof account.credentials?.access_token !== "string" || account.credentials.access_token.length === 0) missingCreds.push("access_token");
  if (missingCreds.length > 0) {
    return { code: "CREDENTIALS_MISSING", postId, missing: missingCreds };
  }

  // Identidad SIEMPRE se verifica contra la cuenta EXACTA asociada al post -
  // nunca se confia en que Meta por si sola rechace un cruce de cuentas
  // (hallazgo explicito de la auditoria previa). Si no es VERIFIED, NUNCA se
  // llega a consultar el creationId.
  const identity = await deps.verifyIdentity({ ig_user_id: account.credentials.ig_user_id, access_token: account.credentials.access_token });
  if (identity.status !== "VERIFIED") {
    return { code: "IDENTITY_NOT_VERIFIED", postId, identityStatus: identity.status, reason: identity.reason };
  }

  const verdict = await deps.reconcile(ref, account.credentials.access_token);
  const reconciledAt = (deps.now ? deps.now() : new Date()).toISOString();

  if (verdict === "CONFIRMED_PUBLISHED") {
    return { code: "CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW", postId, creationId: ref, reconciledAt };
  }
  if (verdict === "CONFIRMED_NOT_PUBLISHED") {
    return { code: "CONFIRMED_NOT_PUBLISHED_REQUIRES_HUMAN_REVIEW", postId, creationId: ref, reconciledAt };
  }
  return { code: "CANNOT_VERIFY", postId, creationId: ref, reconciledAt };
}

// Texto de reporte SEGURO (nunca token/URL firmada) para stdout - separado en
// su propia funcion pura para poder testear el contenido exacto del mensaje
// sin capturar console.log.
export function describeReconciliationResult(result: ReconciliationCommandResult): string[] {
  const lines: string[] = [];
  switch (result.code) {
    case "POST_NOT_FOUND":
      lines.push(`RESULT=POST_NOT_FOUND`, `post_id=${result.postId}`);
      break;
    case "ACCOUNT_NOT_FOUND":
      lines.push(`RESULT=ACCOUNT_NOT_FOUND`, `post_id=${result.postId}`, `account_id=${result.accountId}`);
      break;
    case "WRONG_PLATFORM":
      lines.push(`RESULT=WRONG_PLATFORM`, `post_id=${result.postId}`, `platform=${result.platform}`, `reason=Este comando es exclusivo de Instagram en esta version.`);
      break;
    case "WRONG_STATUS":
      lines.push(
        `RESULT=WRONG_STATUS`,
        `post_id=${result.postId}`,
        `status=${result.status}`,
        `reason=Solo se acepta status='verification_required'. Rechazado ANTES de consultar Meta.`
      );
      break;
    case "MISSING_OPERATION_REF":
      lines.push(`RESULT=MISSING_OPERATION_REF`, `post_id=${result.postId}`, `reason=publisher_operation_ref ausente - no hay nada que reconciliar.`);
      break;
    case "PLACEHOLDER_OPERATION_REF":
      lines.push(`RESULT=PLACEHOLDER_OPERATION_REF`, `post_id=${result.postId}`, `ref=${result.ref}`, `reason=No es un creationId real consultable (placeholder).`);
      break;
    case "CREDENTIALS_MISSING":
      lines.push(`RESULT=CREDENTIALS_MISSING`, `post_id=${result.postId}`, `missing=${result.missing.join(",")}`);
      break;
    case "IDENTITY_NOT_VERIFIED":
      lines.push(
        `RESULT=IDENTITY_NOT_VERIFIED`,
        `post_id=${result.postId}`,
        `identity_status=${result.identityStatus}`,
        `reason=${result.reason}`,
        `NOTE=No se consultó el creationId - la identidad debe ser VERIFIED antes de tocar Meta.`
      );
      break;
    case "CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW":
      lines.push(
        `RESULT=CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW`,
        `post_id=${result.postId}`,
        `creationId=${result.creationId}`,
        `status_code=PUBLISHED`,
        `identity=VERIFIED`,
        `reconciled_at=${result.reconciledAt}`,
        `external_post_id=UNKNOWN`,
        `NOTE=creationId != external_post_id (Meta no expone el ID final del medio a partir del contenedor). status NO fue modificado - sigue en verification_required. Requiere revision humana antes de marcar published.`
      );
      break;
    case "CONFIRMED_NOT_PUBLISHED_REQUIRES_HUMAN_REVIEW":
      lines.push(
        `RESULT=CONFIRMED_NOT_PUBLISHED_REQUIRES_HUMAN_REVIEW`,
        `post_id=${result.postId}`,
        `creationId=${result.creationId}`,
        `status_code=ERROR`,
        `identity=VERIFIED`,
        `reconciled_at=${result.reconciledAt}`,
        `NOTE=status NO fue modificado - sigue en verification_required. Un nuevo intento de publicación requerirá aprobación humana explícita (no implementado en esta version).`
      );
      break;
    case "CANNOT_VERIFY":
      lines.push(
        `RESULT=CANNOT_VERIFY`,
        `post_id=${result.postId}`,
        `creationId=${result.creationId}`,
        `identity=VERIFIED`,
        `reconciled_at=${result.reconciledAt}`,
        `NOTE=Evidencia insuficiente. status NO fue modificado - permanece en verification_required. Ningún campo fue tocado.`
      );
      break;
  }
  return lines;
}
