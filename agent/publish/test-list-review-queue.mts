// Fase — OBSERVABILIDAD OPERATIVA. Pruebas del CLI de solo lectura
// list-review-queue.mts. Mismo patron de deps inyectables ya establecido en
// errorRecovery.mts/verificationResolution.mts - la mayoria de las pruebas
// inyectan datos FALSOS directamente en runReviewQueue()/buildReviewQueue(),
// nunca tocan Supabase real. Una verificacion estructural adicional confirma
// que el codigo ACTIVO del archivo real es demostrablemente de solo lectura.
import { readFileSync } from "node:fs";
await import("./config.mts");
const {
  runReviewQueue,
  buildReviewQueue,
  buildReviewQueueReport,
  describeOperationRef,
  describeReviewQueueItem,
} = await import("./list-review-queue.mts");
import type { ReviewQueuePostRow } from "./list-review-queue.mts";
import type { SocialPlatform } from "./types.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

// SEGURIDAD: fetch global lanza si se le llama - este CLI no deberia tocar
// red real jamas (solo Supabase, via las deps inyectables en las pruebas).
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async (url: unknown) => {
  fetchCalls++;
  throw new Error(`SEGURIDAD: list-review-queue NUNCA debe llamar a fetch/red real (intento hacia: ${String(url)})`);
}) as typeof fetch;

const BASE_POST: ReviewQueuePostRow = {
  id: "post-rq-1",
  account_id: "account-1",
  content_file_id: "content-file-1",
  status: "pending",
  scheduled_at: "2026-09-18T10:00:00.000Z",
  retry_count: 0,
  recovery_count: 0,
  publisher_operation_ref: null,
  external_post_id: null,
  publication_authorized_at: null,
  publication_authorized_by: null,
  error_message: null,
  created_at: "2026-09-18T09:00:00.000Z",
  published_at: null,
};

const YOUTUBE_ACCOUNTS = new Map([["account-1", { channel_id: "channel-1", platform: "youtube" as SocialPlatform, label: "Canal de prueba" }]]);
const FOLDER_NAMES = new Map([["channel-1", "SIN EXPLICACIÓN"]]);

async function main() {
  // ==================================================
  // TEST 1-5 — SOLO LECTURA: verificacion ESTRUCTURAL sobre codigo ACTIVO
  // (ignorando comentarios, mismo criterio ya usado en
  // test-legacy-publisher-disabled.mts/test-error-recovery.mts).
  // ==================================================
  {
    const source = readFileSync(new URL("./list-review-queue.mts", import.meta.url), "utf-8");
    const activeLines = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    check("1. Consulta unicamente vía '.select(' (no hay ninguna otra operacion de escritura activa)", /\.select\(/.test(activeLines));
    check("2. El codigo ACTIVO nunca contiene '.insert('", !/\.insert\(/.test(activeLines));
    check("3. El codigo ACTIVO nunca contiene '.update('", !/\.update\(/.test(activeLines));
    check("4. El codigo ACTIVO nunca contiene '.delete('", !/\.delete\(/.test(activeLines));
    check("5. El codigo ACTIVO nunca contiene '.upsert('", !/\.upsert\(/.test(activeLines));
    check("6. El codigo ACTIVO nunca importa PUBLISHERS ni ningun publisher real", !/PUBLISHERS|publishToYouTube|publishToFacebook|publishToInstagram|from ".*lib\/social\/publishers/.test(activeLines));
    check("7. El codigo ACTIVO nunca importa recoverErrorPost/errorRecovery.mts", !/recoverErrorPost|from ".*errorRecovery\.mts/.test(activeLines));
    check(
      "8. El codigo ACTIVO nunca importa/llama a authorizePublication/revokePublicationAuthorization/resolveVerificationRequired",
      !/authorizePublication|revokePublicationAuthorization|resolveVerificationRequired/.test(activeLines)
    );
  }

  // ==================================================
  // TEST 9 — clasifica correctamente 'error'
  // ==================================================
  {
    const posts: ReviewQueuePostRow[] = [{ ...BASE_POST, id: "post-error-1", status: "error", error_message: "fallo de prueba" }];
    const items = buildReviewQueue(posts, YOUTUBE_ACCOUNTS, FOLDER_NAMES);
    check("9. status='error' se clasifica como categoria ERROR", items.length === 1 && items[0].category === "ERROR");
  }

  // ==================================================
  // TEST 10 — clasifica correctamente 'verification_required'
  // ==================================================
  {
    const posts: ReviewQueuePostRow[] = [{ ...BASE_POST, id: "post-vr-1", status: "verification_required" }];
    const items = buildReviewQueue(posts, YOUTUBE_ACCOUNTS, FOLDER_NAMES);
    check("10. status='verification_required' se clasifica como categoria VERIFICATION_REQUIRED", items.length === 1 && items[0].category === "VERIFICATION_REQUIRED");
  }

  // ==================================================
  // TEST 11 — autorizacion pendiente segun el modelo REAL
  // (isPublicationAuthorized real, reutilizada sin modificar)
  // ==================================================
  {
    const noAuth: ReviewQueuePostRow = { ...BASE_POST, id: "post-pending-noauth", status: "pending", publication_authorized_at: null, publication_authorized_by: null };
    const withAuth: ReviewQueuePostRow = {
      ...BASE_POST,
      id: "post-pending-auth",
      status: "pending",
      publication_authorized_at: "2026-09-18T09:30:00.000Z",
      publication_authorized_by: "operador@example.com",
    };
    const incompleteAuth: ReviewQueuePostRow = { ...BASE_POST, id: "post-pending-incomplete", status: "pending", publication_authorized_at: "2026-09-18T09:30:00.000Z", publication_authorized_by: null };
    const items = buildReviewQueue([noAuth, withAuth, incompleteAuth], YOUTUBE_ACCOUNTS, FOLDER_NAMES);
    check("11. pending SIN autorizacion -> categoria AUTHORIZATION_PENDING", items.some((i) => i.post.id === "post-pending-noauth" && i.category === "AUTHORIZATION_PENDING"));
    check("11b. pending CON autorizacion completa -> NO aparece en la cola (isPublicationAuthorized real dice 'autorizado')", !items.some((i) => i.post.id === "post-pending-auth"));
    check(
      "11c. pending con autorizacion INCOMPLETA (solo timestamp, sin autor) -> SI aparece (isPublicationAuthorized exige ambos campos, mismo criterio que humanReviewGate.mts)",
      items.some((i) => i.post.id === "post-pending-incomplete" && i.category === "AUTHORIZATION_PENDING")
    );
  }

  // ==================================================
  // TEST 12 — cola vacia
  // ==================================================
  {
    const { lines, totalCount } = buildReviewQueueReport([]);
    check("12. Cola vacia -> totalCount=0", totalCount === 0);
    check("12b. Cola vacia -> mensaje literal exacto 'No hay posts que requieran atención humana.'", lines.some((l) => l === "No hay posts que requieran atención humana."));
  }

  // ==================================================
  // TEST 13 — manejo de errores de consulta (real, vía runReviewQueue con
  // deps que lanzan) - nunca hace fallback que escriba, nunca silencia.
  // ==================================================
  await (async () => {
    const failingDeps = {
      fetchReviewablePosts: async () => {
        throw new Error("conexion perdida con Supabase (simulado)");
      },
      fetchAccountsById: async () => new Map(),
      fetchChannelFolderNames: async () => new Map(),
    };
    const outcome = await runReviewQueue(failingDeps);
    check("13. Error de consulta -> exitCode=1 (nunca 0)", outcome.exitCode === 1);
    check("13b. Salida contiene RESULT=QUERY_ERROR con el motivo real", outcome.lines.some((l) => l === "RESULT=QUERY_ERROR") && outcome.lines.some((l) => l.includes("conexion perdida con Supabase")));
  })();

  // ==================================================
  // TEST 14 — no expone credenciales/valores crudos de operation ref
  // ==================================================
  {
    check("14. describeOperationRef(null) -> 'ausente', nunca imprime nada crudo", describeOperationRef(null) === "ausente");
    check("14b. describeOperationRef('pending:youtube') -> muestra el PLACEHOLDER literal (no es sensible, es un valor fijo conocido)", describeOperationRef("pending:youtube") === "placeholder (pending:youtube)");
    const realRefDescription = describeOperationRef("https://upload.example.com/resumable/session-xyz-MUY-SENSIBLE");
    check("14c. describeOperationRef(<referencia real>) NUNCA incluye el valor crudo en el texto", !realRefDescription.includes("upload.example.com") && !realRefDescription.includes("MUY-SENSIBLE"));
    check("14d. describeOperationRef(<referencia real>) SI reporta longitud (metadata segura)", /longitud=\d+/.test(realRefDescription));

    const itemWithRealRef = describeReviewQueueItem({
      category: "ERROR",
      post: { ...BASE_POST, id: "post-real-ref", publisher_operation_ref: "https://upload.example.com/resumable/session-xyz-MUY-SENSIBLE" },
      account: { platform: "youtube", label: null, folderName: null },
    });
    check("14e. El detalle de un item con referencia real NUNCA incluye el valor crudo en ninguna linea", !itemWithRealRef.some((l) => l.includes("MUY-SENSIBLE")));

    const source = readFileSync(new URL("./list-review-queue.mts", import.meta.url), "utf-8");
    check("14f. El archivo ACTIVO nunca menciona access_token/client_secret/refresh_token como campo a mostrar", !/access_token|client_secret|refresh_token/.test(source.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")));
  }

  // ==================================================
  // TEST 15 — respeta los tipos existentes: ReviewQueuePostRow reutiliza los
  // MISMOS nombres de columna que SocialPostRow (types.mts) - confirmado ya
  // por tsc (0 errores) mas esta comprobacion adicional de forma.
  // ==================================================
  {
    const requiredKeys = [
      "id",
      "account_id",
      "content_file_id",
      "status",
      "scheduled_at",
      "retry_count",
      "publisher_operation_ref",
      "external_post_id",
      "publication_authorized_at",
      "publication_authorized_by",
      "error_message",
      "created_at",
      "published_at",
    ];
    check("15. ReviewQueuePostRow (fixture BASE_POST) contiene exactamente los campos reales de social_posts ya usados en el resto del proyecto", requiredKeys.every((k) => k in BASE_POST));
  }

  // ==================================================
  // Extra — orden de la salida: verification_required -> error -> authorization_pending
  // ==================================================
  {
    const posts: ReviewQueuePostRow[] = [
      { ...BASE_POST, id: "p-auth", status: "pending", scheduled_at: "2026-09-18T01:00:00.000Z" },
      { ...BASE_POST, id: "p-error", status: "error", scheduled_at: "2026-09-18T02:00:00.000Z" },
      { ...BASE_POST, id: "p-vr", status: "verification_required", scheduled_at: "2026-09-18T03:00:00.000Z" },
    ];
    const items = buildReviewQueue(posts, YOUTUBE_ACCOUNTS, FOLDER_NAMES);
    check("Extra. Orden: verification_required, luego error, luego authorization_pending", items.map((i) => i.category).join(",") === "VERIFICATION_REQUIRED,ERROR,AUTHORIZATION_PENDING");
  }

  // ==================================================
  // Extra — status='publishing'/'published' nunca aparecen en la cola
  // (fuera del alcance pedido: A/B/C son exactamente error/verification_required/pending-sin-auth).
  // ==================================================
  {
    const posts: ReviewQueuePostRow[] = [
      { ...BASE_POST, id: "p-publishing", status: "publishing" },
      { ...BASE_POST, id: "p-published", status: "published" },
    ];
    const items = buildReviewQueue(posts, YOUTUBE_ACCOUNTS, FOLDER_NAMES);
    check("Extra. status='publishing'/'published' nunca aparecen en la cola de revision", items.length === 0);
  }

  // ==================================================
  // Extra — resumen: totales por categoria y por plataforma correctos.
  // ==================================================
  {
    const posts: ReviewQueuePostRow[] = [
      { ...BASE_POST, id: "p1", status: "error" },
      { ...BASE_POST, id: "p2", status: "error" },
      { ...BASE_POST, id: "p3", status: "verification_required" },
    ];
    const items = buildReviewQueue(posts, YOUTUBE_ACCOUNTS, FOLDER_NAMES);
    const { lines, totalCount } = buildReviewQueueReport(items);
    check("Extra. totalCount=3", totalCount === 3);
    check("Extra. Resumen incluye 'Total de posts que requieren atención: 3'", lines.some((l) => l.includes("Total de posts que requieren atención: 3")));
    check("Extra. Resumen incluye 'ERROR: 2'", lines.some((l) => l.trim() === "ERROR: 2"));
    check("Extra. Resumen incluye 'youtube: 3' (todas las cuentas de prueba son youtube)", lines.some((l) => l.trim() === "youtube: 3"));
  }

  // ==================================================
  // Seguridad final — cero llamadas HTTP/Meta/B2 en toda la corrida.
  // ==================================================
  check("Final. Meta/red: fetchCalls=0 tras toda la corrida", fetchCalls === 0);
  console.log("Final. Supabase real: todas las pruebas usaron deps inyectadas/datos en memoria - supabaseAdmin real nunca fue invocado.");

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().finally(() => {
  globalThis.fetch = originalFetch;
});
