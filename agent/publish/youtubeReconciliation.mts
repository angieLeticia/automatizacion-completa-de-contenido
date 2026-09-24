// H3 (hardening, auditoria final H1+H2+H5) — orquestacion PURA/testable del
// comando operativo de reconciliacion de YouTube. Mismo patron exacto que
// instagramReconciliation.mts (Fase 20): READ -> VERIFY -> REPORT, NUNCA
// decide-y-escribe - propiedad ESTRUCTURAL: este archivo no importa
// supabaseClient.mts, no tiene ninguna funcion de escritura entre sus `deps`.
//
// Diferencias deliberadas respecto a Instagram (NO es una copia mecanica):
//   - YouTube necesita el content_file asociado, para poder calcular el
//     Content-Length ORIGINAL del archivo (via `statSync`, inyectado como
//     `getFileSize`) - Instagram no necesita ningun archivo local para
//     reconciliar (solo el creationId + access_token).
//   - YouTube SI puede recuperar un `externalPostId` real desde la propia
//     reconciliacion (ver reconciliation.mts::reconcileYouTube, corregido en
//     esta misma fase - hallazgo LOW) - Instagram estructuralmente no puede
//     (creationId != external_post_id, Meta nunca lo expone via el
//     contenedor, ver instagramReconciliation.mts).
//   - No hay una verificacion de identidad estructural previa aqui (YouTube
//     no tiene un "GET barato" equivalente al de Instagram) - la seguridad
//     de que la sesion pertenece a la cuenta correcta viene de que la
//     uploadUrl es una sesion pre-autorizada por Google en el momento de la
//     subida original, no de un ID que pudiera pertenecer a otra cuenta.
import { isRealOperationRef } from "./staleClaimClassification.mts";

export interface ReconciliationPostRow {
  id: string;
  status: string;
  account_id: string;
  content_file_id: string | null;
  publisher_operation_ref: string | null;
}

export interface ReconciliationAccountRow {
  platform: string;
}

export interface ReconciliationContentFileRow {
  file_path: string;
}

export interface YouTubeReconcileVerdict {
  result: "CONFIRMED_PUBLISHED" | "CONFIRMED_NOT_PUBLISHED" | "CANNOT_VERIFY";
  externalPostId?: string;
}

export interface YouTubeReconciliationDeps {
  fetchPost: (postId: string) => Promise<ReconciliationPostRow | null>;
  fetchAccount: (accountId: string) => Promise<ReconciliationAccountRow | null>;
  fetchContentFile: (contentFileId: string) => Promise<ReconciliationContentFileRow | null>;
  // null = archivo no accesible/no existe/no se pudo leer su tamaño - NUNCA
  // se asume un tamaño por defecto ante un fallo de fs.
  getFileSize: (filePath: string) => Promise<number | null>;
  reconcile: (uploadUrl: string, contentLength: string) => Promise<YouTubeReconcileVerdict>;
  now?: () => Date;
}

// Cada variante lleva exactamente la informacion que el comando debe poder
// MOSTRAR - nunca mas de lo que realmente se conoce (mismo principio que
// instagramReconciliation.mts). Nunca incluye la uploadUrl completa (podria
// considerarse sensible por su capacidad operativa) ni ningun secreto.
export type YouTubeReconciliationCommandResult =
  | { code: "POST_NOT_FOUND"; postId: string }
  | { code: "ACCOUNT_NOT_FOUND"; postId: string; accountId: string }
  | { code: "WRONG_PLATFORM"; postId: string; platform: string }
  | { code: "WRONG_STATUS"; postId: string; status: string }
  | { code: "MISSING_OPERATION_REF"; postId: string }
  | { code: "PLACEHOLDER_OPERATION_REF"; postId: string; ref: string }
  | { code: "MISSING_CONTENT_FILE"; postId: string }
  | { code: "CONTENT_FILE_NOT_FOUND"; postId: string; contentFileId: string }
  | { code: "LOCAL_FILE_UNAVAILABLE"; postId: string; filePath: string }
  | { code: "CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW"; postId: string; externalPostId: string; reconciledAt: string }
  | { code: "CONFIRMED_NOT_PUBLISHED_REQUIRES_HUMAN_REVIEW"; postId: string; reconciledAt: string }
  | { code: "CANNOT_VERIFY"; postId: string; reconciledAt: string };

const REQUIRED_STATUS = "verification_required";
const REQUIRED_PLATFORM = "youtube";

// Todas las validaciones de esta funcion ocurren ANTES de llamar a
// `deps.reconcile` (que es quien de verdad toca YouTube) - ningun camino
// llega a la red sin haber pasado las 8 comprobaciones pedidas. Sin
// fallback silencioso: cada rechazo es un `code` explicito y distinto.
export async function runYoutubeReconciliation(postId: string, deps: YouTubeReconciliationDeps): Promise<YouTubeReconciliationCommandResult> {
  const post = await deps.fetchPost(postId);
  if (!post) {
    return { code: "POST_NOT_FOUND", postId };
  }

  const account = await deps.fetchAccount(post.account_id);
  if (!account) {
    return { code: "ACCOUNT_NOT_FOUND", postId, accountId: post.account_id };
  }

  // Rechazo de plataforma ANTES de tocar YouTube - este comando es
  // exclusivo de YouTube (Instagram ya tiene el suyo, Facebook/TikTok no
  // tienen mecanismo de reconciliacion implementado, ver reconciliation.mts).
  if (account.platform !== REQUIRED_PLATFORM) {
    return { code: "WRONG_PLATFORM", postId, platform: account.platform };
  }

  // Rechazo de estado ANTES de tocar YouTube - unico estado de entrada aceptado.
  if (post.status !== REQUIRED_STATUS) {
    return { code: "WRONG_STATUS", postId, status: post.status };
  }

  const ref = post.publisher_operation_ref;
  if (!ref) {
    return { code: "MISSING_OPERATION_REF", postId };
  }
  // Nunca aceptar "pending:youtube" (u otro placeholder equivalente) como si
  // fuera una uploadUrl real consultable - isRealOperationRef() ya existe y
  // ya es la fuente de verdad para esta distincion (staleClaimClassification.mts).
  if (!isRealOperationRef(ref)) {
    return { code: "PLACEHOLDER_OPERATION_REF", postId, ref };
  }

  if (!post.content_file_id) {
    return { code: "MISSING_CONTENT_FILE", postId };
  }
  const contentFile = await deps.fetchContentFile(post.content_file_id);
  if (!contentFile) {
    return { code: "CONTENT_FILE_NOT_FOUND", postId, contentFileId: post.content_file_id };
  }

  const fileSize = await deps.getFileSize(contentFile.file_path);
  if (fileSize === null) {
    return { code: "LOCAL_FILE_UNAVAILABLE", postId, filePath: contentFile.file_path };
  }

  const verdict = await deps.reconcile(ref, String(fileSize));
  const reconciledAt = (deps.now ? deps.now() : new Date()).toISOString();

  if (verdict.result === "CONFIRMED_PUBLISHED") {
    // Defensa en profundidad: aunque reconcileYouTube() ya exige un id real
    // para clasificar CONFIRMED_PUBLISHED (H3, hallazgo LOW), esta capa
    // NUNCA confia ciegamente en el campo - si por cualquier motivo llegara
    // sin externalPostId, se reporta como CANNOT_VERIFY en vez de afirmar
    // "publicado" sin evidencia recuperable.
    if (!verdict.externalPostId) {
      return { code: "CANNOT_VERIFY", postId, reconciledAt };
    }
    return { code: "CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW", postId, externalPostId: verdict.externalPostId, reconciledAt };
  }
  if (verdict.result === "CONFIRMED_NOT_PUBLISHED") {
    return { code: "CONFIRMED_NOT_PUBLISHED_REQUIRES_HUMAN_REVIEW", postId, reconciledAt };
  }
  return { code: "CANNOT_VERIFY", postId, reconciledAt };
}

// Texto de reporte SEGURO (nunca uploadUrl completa, nunca token/credencial)
// para stdout - separado en su propia funcion pura para poder testear el
// contenido exacto del mensaje sin capturar console.log.
export function describeYoutubeReconciliationResult(result: YouTubeReconciliationCommandResult): string[] {
  const lines: string[] = [];
  switch (result.code) {
    case "POST_NOT_FOUND":
      lines.push(`RESULT=POST_NOT_FOUND`, `post_id=${result.postId}`);
      break;
    case "ACCOUNT_NOT_FOUND":
      lines.push(`RESULT=ACCOUNT_NOT_FOUND`, `post_id=${result.postId}`, `account_id=${result.accountId}`);
      break;
    case "WRONG_PLATFORM":
      lines.push(`RESULT=WRONG_PLATFORM`, `post_id=${result.postId}`, `platform=${result.platform}`, `reason=Este comando es exclusivo de YouTube.`);
      break;
    case "WRONG_STATUS":
      lines.push(
        `RESULT=WRONG_STATUS`,
        `post_id=${result.postId}`,
        `status=${result.status}`,
        `reason=Solo se acepta status='verification_required'. Rechazado ANTES de consultar YouTube.`
      );
      break;
    case "MISSING_OPERATION_REF":
      lines.push(`RESULT=MISSING_OPERATION_REF`, `post_id=${result.postId}`, `reason=publisher_operation_ref ausente - no hay nada que reconciliar.`);
      break;
    case "PLACEHOLDER_OPERATION_REF":
      lines.push(`RESULT=PLACEHOLDER_OPERATION_REF`, `post_id=${result.postId}`, `ref=${result.ref}`, `reason=No es una uploadUrl real consultable (placeholder).`);
      break;
    case "MISSING_CONTENT_FILE":
      lines.push(`RESULT=MISSING_CONTENT_FILE`, `post_id=${result.postId}`, `reason=El post no tiene content_file_id - no se puede calcular el tamaño original del archivo.`);
      break;
    case "CONTENT_FILE_NOT_FOUND":
      lines.push(`RESULT=CONTENT_FILE_NOT_FOUND`, `post_id=${result.postId}`, `content_file_id=${result.contentFileId}`);
      break;
    case "LOCAL_FILE_UNAVAILABLE":
      lines.push(`RESULT=LOCAL_FILE_UNAVAILABLE`, `post_id=${result.postId}`, `file_path=${result.filePath}`, `reason=No se pudo obtener el tamaño del archivo local - no se puede consultar YouTube sin el Content-Length original.`);
      break;
    case "CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW":
      lines.push(
        `RESULT=CONFIRMED_PUBLISHED_REQUIRES_HUMAN_REVIEW`,
        `post_id=${result.postId}`,
        `external_post_id=${result.externalPostId}`,
        `reconciled_at=${result.reconciledAt}`,
        `NOTE=status NO fue modificado - sigue en verification_required. Requiere revision humana (npm run social:resolve-verification) antes de marcar published.`
      );
      break;
    case "CONFIRMED_NOT_PUBLISHED_REQUIRES_HUMAN_REVIEW":
      lines.push(
        `RESULT=CONFIRMED_NOT_PUBLISHED_REQUIRES_HUMAN_REVIEW`,
        `post_id=${result.postId}`,
        `reconciled_at=${result.reconciledAt}`,
        `NOTE=status NO fue modificado - sigue en verification_required. Un nuevo intento de publicación requerirá aprobación humana explícita.`
      );
      break;
    case "CANNOT_VERIFY":
      lines.push(
        `RESULT=CANNOT_VERIFY`,
        `post_id=${result.postId}`,
        `reconciled_at=${result.reconciledAt}`,
        `NOTE=Evidencia insuficiente. status NO fue modificado - permanece en verification_required. Ningún campo fue tocado.`
      );
      break;
  }
  return lines;
}
