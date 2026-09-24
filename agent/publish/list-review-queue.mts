// Fase — OBSERVABILIDAD OPERATIVA DE AGENT 3. CLI de SOLO LECTURA que
// permite descubrir que social_posts requieren atencion humana sin conocer
// de antemano ningun post_id y sin consultar Supabase manualmente.
//
// Uso: npm run social:review-queue (sin argumentos)
//
// READ -> FORMAT -> REPORT, EXACTAMENTE - mismo principio ya establecido en
// reconcile-instagram.mts/reconcile-youtube.mts (Fase 20/H3): este archivo
// NUNCA escribe nada, NUNCA llama a ningun publisher, NUNCA autoriza,
// NUNCA recupera, NUNCA resuelve verification_required - solo lee y reporta.
//
// Reutiliza, SIN MODIFICAR: humanReviewGate.mts::isPublicationAuthorized()
// (unica fuente de verdad de "autorizado si/no", igual que en
// publicationAuthorization.mts/run.mts) y staleClaimClassification.mts::isRealOperationRef()
// (unica fuente de verdad de "referencia real vs. placeholder/ausente",
// igual que en operationEvidenceGate.mts/errorRecovery.mts) - cero logica de
// decision nueva o duplicada.
//
// HALLAZGO DOCUMENTADO (no resuelto aqui, por diseno): el modelo existente
// (isPublicationAuthorized/evaluateAuthorizationEligibility) NO distingue
// "un post pending que genuinamente necesita autorizacion humana AHORA" de
// "un post pending por razones mundanas" (esperando su scheduled_at, o
// bloqueado por channel_status/DRY_RUN) - esa distincion vive en la
// condicion COMPUESTA de run.mts (DRY_RUN || !authorizedForRealPublication
// || !humanAuthorized), fuera de alcance reproducir aqui (duplicaria logica
// de gating real). La categoria C de este CLI usa la interpretacion mas
// fiel posible al modelo YA EXISTENTE, sin inventar ninguna condicion nueva:
// status='pending' AND !isPublicationAuthorized(post). Se documenta
// explicitamente en la propia salida del CLI para que el operador entienda
// el alcance real de esta señal.
import "./config.mts";
import { fileURLToPath } from "node:url";
import { supabaseAdmin } from "../supabaseClient.mts";
import { isPublicationAuthorized } from "./humanReviewGate.mts";
import { isRealOperationRef } from "./staleClaimClassification.mts";
import type { SocialPlatform } from "./types.mts";

export interface ReviewQueuePostRow {
  id: string;
  account_id: string;
  content_file_id: string | null;
  status: string;
  scheduled_at: string;
  retry_count: number;
  recovery_count?: number;
  publisher_operation_ref: string | null;
  external_post_id: string | null;
  publication_authorized_at: string | null;
  publication_authorized_by: string | null;
  error_message: string | null;
  created_at: string;
  published_at: string | null;
}

export interface ReviewQueueAccountInfo {
  platform: SocialPlatform | null;
  label: string | null;
  folderName: string | null;
}

export type ReviewCategory = "VERIFICATION_REQUIRED" | "ERROR" | "AUTHORIZATION_PENDING";

export interface ReviewQueueItem {
  category: ReviewCategory;
  post: ReviewQueuePostRow;
  account: ReviewQueueAccountInfo;
}

// --- Dependencias inyectables (mismo patron que verificationResolution.mts/
// errorRecovery.mts) - permiten probar la logica de clasificacion/formato
// real sin tocar Supabase, y dejan un unico punto de I/O real por defecto. ---
export interface ReviewQueueDeps {
  fetchReviewablePosts: () => Promise<ReviewQueuePostRow[]>;
  fetchAccountsById: () => Promise<Map<string, { channel_id: string; platform: SocialPlatform; label: string | null }>>;
  fetchChannelFolderNames: () => Promise<Map<string, string>>;
}

const defaultReviewQueueDeps: ReviewQueueDeps = {
  async fetchReviewablePosts() {
    const { data, error } = await supabaseAdmin
      .from("social_posts")
      .select(
        "id, account_id, content_file_id, status, scheduled_at, retry_count, recovery_count, publisher_operation_ref, external_post_id, publication_authorized_at, publication_authorized_by, error_message, created_at, published_at"
      )
      .in("status", ["error", "verification_required", "pending"]);
    if (error) throw new Error(`Error al leer social_posts: ${error.message}`);
    return (data ?? []) as ReviewQueuePostRow[];
  },
  async fetchAccountsById() {
    const { data, error } = await supabaseAdmin.from("social_accounts").select("id, channel_id, platform, label");
    if (error) throw new Error(`Error al leer social_accounts: ${error.message}`);
    return new Map((data ?? []).map((a) => [a.id as string, { channel_id: a.channel_id as string, platform: a.platform as SocialPlatform, label: a.label as string | null }]));
  },
  async fetchChannelFolderNames() {
    const { data, error } = await supabaseAdmin.from("content_accounts").select("channel_id, folder_name");
    if (error) throw new Error(`Error al leer content_accounts: ${error.message}`);
    return new Map((data ?? []).map((c) => [c.channel_id as string, c.folder_name as string]));
  },
};

// Pura - clasifica y arma la lista completa de items a revisar, sin ningun
// acceso a I/O propio (recibe todo ya leido). Reutiliza isPublicationAuthorized()
// SIN modificarla ni reimplementar su regla.
export function buildReviewQueue(
  posts: ReviewQueuePostRow[],
  accountsById: Map<string, { channel_id: string; platform: SocialPlatform; label: string | null }>,
  folderNamesByChannelId: Map<string, string>
): ReviewQueueItem[] {
  const items: ReviewQueueItem[] = [];
  for (const post of posts) {
    const acc = accountsById.get(post.account_id);
    const account: ReviewQueueAccountInfo = {
      platform: acc?.platform ?? null,
      label: acc?.label ?? null,
      folderName: acc ? (folderNamesByChannelId.get(acc.channel_id) ?? null) : null,
    };

    if (post.status === "verification_required") {
      items.push({ category: "VERIFICATION_REQUIRED", post, account });
    } else if (post.status === "error") {
      items.push({ category: "ERROR", post, account });
    } else if (post.status === "pending" && !isPublicationAuthorized(post)) {
      items.push({ category: "AUTHORIZATION_PENDING", post, account });
    }
    // status='pending' Y autorizado -> no requiere atencion, se omite.
  }

  // Orden pedido: verification_required -> error -> authorization_pending.
  // Razon tecnica (documentada, no inventada): no existe ninguna columna
  // "updated_at"/"status_changed_at" en social_posts (confirmado en schema.sql -
  // el unico trigger de ese tipo en todo el schema es sobre content_metadata,
  // una tabla distinta) - el dato temporal mas util disponible dentro de cada
  // categoria es `scheduled_at` (indica cuanto tiempo lleva vencido), usado
  // ascendente (el mas antiguo primero, el mas urgente para revisar).
  const CATEGORY_ORDER: Record<ReviewCategory, number> = { VERIFICATION_REQUIRED: 0, ERROR: 1, AUTHORIZATION_PENDING: 2 };
  items.sort((a, b) => {
    const catDiff = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    if (catDiff !== 0) return catDiff;
    return new Date(a.post.scheduled_at).getTime() - new Date(b.post.scheduled_at).getTime();
  });
  return items;
}

// Representacion SEGURA de publisher_operation_ref - NUNCA el valor crudo
// (puede ser una uploadUrl de YouTube con un identificador de sesion
// sensible) - mismo criterio de seguridad ya establecido en H4-A.2 para
// logs (operationRefPresent/operationRefLength, nunca el valor).
export function describeOperationRef(ref: string | null): string {
  if (ref === null) return "ausente";
  if (!isRealOperationRef(ref)) return `placeholder (${ref})`; // "pending:<platform>" - no es sensible, es un literal fijo conocido
  return `evidencia real presente (longitud=${ref.length}, valor no mostrado por seguridad)`;
}

const ERROR_MESSAGE_MAX_LENGTH = 300;
function truncate(text: string | null, max: number): string {
  if (text === null) return "(ninguno)";
  return text.length > max ? `${text.slice(0, max)}... (truncado, ${text.length} caracteres totales)` : text;
}

// Formatea UN item como lineas de texto seguras para consola/PowerShell.
export function describeReviewQueueItem(item: ReviewQueueItem): string[] {
  const { post, account, category } = item;
  return [
    `[${category}] post_id=${post.id}`,
    `  status=${post.status}`,
    `  account_id=${post.account_id}`,
    `  canal=${account.folderName ?? "(no resoluble)"}  plataforma=${account.platform ?? "(no resoluble)"}  cuenta=${account.label ?? "(sin label)"}`,
    `  content_file_id=${post.content_file_id ?? "(ninguno)"}`,
    `  scheduled_at=${post.scheduled_at}`,
    `  retry_count=${post.retry_count}  recovery_count=${post.recovery_count ?? "(columna no leida - ver nota de migracion)"}`,
    `  publisher_operation_ref=${describeOperationRef(post.publisher_operation_ref)}`,
    `  external_post_id=${post.external_post_id ?? "(ninguno)"}`,
    `  publication_authorized_at=${post.publication_authorized_at ?? "(ninguno)"}  publication_authorized_by=${post.publication_authorized_by ?? "(ninguno)"}`,
    `  created_at=${post.created_at}  published_at=${post.published_at ?? "(ninguno)"}`,
    `  error_message=${truncate(post.error_message, ERROR_MESSAGE_MAX_LENGTH)}`,
  ];
}

export interface ReviewQueueReport {
  lines: string[];
  totalCount: number;
}

// Pura - arma el reporte completo (resumen + detalle) a partir de la lista
// ya clasificada y ordenada. Nunca inventa datos - si un campo no se pudo
// resolver, lo dice explicitamente ("no resoluble"), nunca lo omite en
// silencio ni lo rellena con un valor de relleno.
export function buildReviewQueueReport(items: ReviewQueueItem[]): ReviewQueueReport {
  const lines: string[] = ["=== COLA DE REVISION - AGENT 3 (solo lectura) ==="];

  if (items.length === 0) {
    lines.push("", "No hay posts que requieran atención humana.");
    return { lines, totalCount: 0 };
  }

  const byCategory = new Map<ReviewCategory, number>();
  const byPlatform = new Map<string, number>();
  for (const item of items) {
    byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + 1);
    const platformKey = item.account.platform ?? "(desconocida)";
    byPlatform.set(platformKey, (byPlatform.get(platformKey) ?? 0) + 1);
  }

  lines.push("", `Total de posts que requieren atención: ${items.length}`, "");
  lines.push("Por categoría:");
  for (const [cat, count] of byCategory) lines.push(`  ${cat}: ${count}`);
  lines.push("", "Por plataforma:");
  for (const [platform, count] of byPlatform) lines.push(`  ${platform}: ${count}`);

  lines.push(
    "",
    "NOTA sobre AUTHORIZATION_PENDING: esta categoría usa exactamente el modelo",
    "existente (isPublicationAuthorized() de humanReviewGate.mts) aplicado a",
    "status='pending' - NO distingue un post que genuinamente necesita",
    "autorización ahora de uno que simplemente todavía no llegó a su",
    "scheduled_at o está bloqueado por channel_status/DRY_RUN. Es informativo,",
    "no una predicción de qué se publicará a continuación."
  );

  lines.push("", "--- Detalle ---");
  for (const item of items) {
    lines.push("", ...describeReviewQueueItem(item));
  }

  return { lines, totalCount: items.length };
}

export interface RunReviewQueueOutcome {
  exitCode: number;
  lines: string[];
}

// Orquestacion - UNICO punto que hace I/O real (via las deps, inyectables en
// tests). Cualquier fallo de lectura se reporta CLARO, exit code != 0, NUNCA
// se intenta un fallback que escriba ni se silencia el error.
export async function runReviewQueue(deps: ReviewQueueDeps = defaultReviewQueueDeps): Promise<RunReviewQueueOutcome> {
  let posts: ReviewQueuePostRow[];
  let accountsById: Map<string, { channel_id: string; platform: SocialPlatform; label: string | null }>;
  let folderNamesByChannelId: Map<string, string>;
  try {
    posts = await deps.fetchReviewablePosts();
    accountsById = await deps.fetchAccountsById();
    folderNamesByChannelId = await deps.fetchChannelFolderNames();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, lines: ["=== COLA DE REVISION - AGENT 3 (solo lectura) ===", "", `RESULT=QUERY_ERROR`, `reason=${message}`] };
  }

  const items = buildReviewQueue(posts, accountsById, folderNamesByChannelId);
  const { lines } = buildReviewQueueReport(items);
  return { exitCode: 0, lines };
}

async function main(): Promise<void> {
  const { exitCode, lines } = await runReviewQueue();
  for (const line of lines) console.log(line);
  process.exitCode = exitCode;
}

// Guard de ejecucion directa - mismo patron que resolve-verification.mts/
// recover-error.mts: permite importar este archivo desde
// test-list-review-queue.mts sin disparar main() contra Supabase real.
const isDirectRun = typeof process.argv[1] === "string" && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch((err) => {
    console.error(`ERROR inesperado: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
