// Fase 20 — CLI real del comando operativo de reconciliacion de Instagram.
// Uso: npm run social:reconcile-instagram -- <post-id>
//
// Este archivo es el UNICO lugar de todo el comando que toca Supabase/Meta de
// verdad - toda la logica de decision vive en instagramReconciliation.mts
// (pura, inyectable, 100% testeada sin red). Aqui solo se construyen las
// `deps` reales y se imprime el resultado de forma segura (nunca un token).
//
// READ -> VERIFY -> REPORT. Este comando NUNCA escribe en social_posts, NUNCA
// llama a media_publish, NUNCA cambia channel_status ni Human Review, NUNCA
// toca el objeto en B2. Ver docs/architecture (Fase 20) para el diseño
// completo de las tres rutas de salida.
import { supabaseAdmin } from "../supabaseClient.mts";
import { verifyInstagramAccountIdentity } from "./instagramAccountIdentity.mts";
import { reconcileInstagram } from "./reconciliation.mts";
import { runInstagramReconciliation, describeReconciliationResult, type ReconciliationDeps, type ReconciliationPostRow, type ReconciliationAccountRow } from "./instagramReconciliation.mts";

async function fetchPost(postId: string): Promise<ReconciliationPostRow | null> {
  const { data, error } = await supabaseAdmin.from("social_posts").select("id, status, account_id, publisher_operation_ref").eq("id", postId).maybeSingle();
  if (error) throw new Error(`Error al leer social_posts id=${postId}: ${error.message}`);
  return (data as ReconciliationPostRow | null) ?? null;
}

async function fetchAccount(accountId: string): Promise<ReconciliationAccountRow | null> {
  const { data, error } = await supabaseAdmin.from("social_accounts").select("platform, credentials").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`Error al leer social_accounts id=${accountId}: ${error.message}`);
  return (data as ReconciliationAccountRow | null) ?? null;
}

const deps: ReconciliationDeps = {
  fetchPost,
  fetchAccount,
  verifyIdentity: verifyInstagramAccountIdentity,
  reconcile: reconcileInstagram,
};

async function main(): Promise<void> {
  const postId = process.argv[2];
  console.log("=== RECONCILIACION SEGURA DE INSTAGRAM (READ -> VERIFY -> REPORT) ===");
  if (!postId || postId.trim().length === 0) {
    console.log("ERROR — falta el <post-id>. Uso: npm run social:reconcile-instagram -- <post-id>");
    process.exitCode = 1;
    return;
  }

  console.log(`post_id=${postId}`);
  const result = await runInstagramReconciliation(postId, deps);
  for (const line of describeReconciliationResult(result)) console.log(line);

  console.log("\n--- Confirmaciones de seguridad (siempre verdaderas en esta version) ---");
  console.log("Real publication: NOT ENABLED");
  console.log("media_publish from reconciliation: NEVER");
  console.log("Automatic verification_required -> published: NOT IMPLEMENTED");
  console.log("Automatic verification_required -> pending: NOT IMPLEMENTED");
  console.log("external_post_id inference: NOT IMPLEMENTED");

  // Evidencia de esta consulta (Objetivo 8): en esta primera version se
  // registra unicamente en stdout, nunca en una tabla/columna nueva. Fase
  // futura: si se decide persistir, reutilizar un mecanismo de evidencia ya
  // existente en el proyecto en vez de crear uno nuevo aqui.
  console.log(`\n[EVIDENCIA] Consulta de reconciliacion ejecutada en ${new Date().toISOString()} para post_id=${postId}. Este resultado NO fue persistido en base de datos - solo mostrado arriba.`);
}

main().catch((err) => {
  console.error(`ERROR inesperado: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
