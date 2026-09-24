// H3 (hardening, auditoria final H1+H2+H5) — CLI real del comando operativo
// de reconciliacion de YouTube. Uso: npm run social:reconcile-youtube -- <post-id>
//
// Mismo diseno exacto que reconcile-instagram.mts (Fase 20): este archivo es
// el UNICO lugar de todo el comando que toca Supabase/YouTube/filesystem de
// verdad - toda la logica de decision vive en youtubeReconciliation.mts
// (pura, inyectable, testeada sin red/Supabase real). Aqui solo se
// construyen las `deps` reales y se imprime el resultado de forma segura
// (nunca un token, nunca la uploadUrl completa).
//
// READ -> VERIFY -> REPORT. Este comando NUNCA escribe en social_posts,
// NUNCA llama a publishToYouTube, NUNCA inicia una segunda sesion de
// subida, NUNCA cambia channel_status ni Human Review, NUNCA llama a
// resolveVerificationRequired().
import "./config.mts";
import { statSync } from "node:fs";
import { supabaseAdmin } from "../supabaseClient.mts";
import { reconcileYouTube } from "./reconciliation.mts";
import {
  runYoutubeReconciliation,
  describeYoutubeReconciliationResult,
  type YouTubeReconciliationDeps,
  type ReconciliationPostRow,
  type ReconciliationAccountRow,
  type ReconciliationContentFileRow,
} from "./youtubeReconciliation.mts";

async function fetchPost(postId: string): Promise<ReconciliationPostRow | null> {
  const { data, error } = await supabaseAdmin
    .from("social_posts")
    .select("id, status, account_id, content_file_id, publisher_operation_ref")
    .eq("id", postId)
    .maybeSingle();
  if (error) throw new Error(`Error al leer social_posts id=${postId}: ${error.message}`);
  return (data as ReconciliationPostRow | null) ?? null;
}

async function fetchAccount(accountId: string): Promise<ReconciliationAccountRow | null> {
  const { data, error } = await supabaseAdmin.from("social_accounts").select("platform").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`Error al leer social_accounts id=${accountId}: ${error.message}`);
  return (data as ReconciliationAccountRow | null) ?? null;
}

async function fetchContentFile(contentFileId: string): Promise<ReconciliationContentFileRow | null> {
  const { data, error } = await supabaseAdmin.from("content_files").select("file_path").eq("id", contentFileId).maybeSingle();
  if (error) throw new Error(`Error al leer content_files id=${contentFileId}: ${error.message}`);
  return (data as ReconciliationContentFileRow | null) ?? null;
}

// Solo lectura de metadata del archivo (tamaño) - nunca lee/transmite su
// contenido. null = no accesible/no existe, nunca se asume un tamaño.
async function getFileSize(filePath: string): Promise<number | null> {
  try {
    return statSync(filePath).size;
  } catch {
    return null;
  }
}

const deps: YouTubeReconciliationDeps = {
  fetchPost,
  fetchAccount,
  fetchContentFile,
  getFileSize,
  reconcile: reconcileYouTube,
};

async function main(): Promise<void> {
  const postId = process.argv[2];
  console.log("=== RECONCILIACION SEGURA DE YOUTUBE (READ -> VERIFY -> REPORT) ===");
  if (!postId || postId.trim().length === 0) {
    console.log("ERROR — falta el <post-id>. Uso: npm run social:reconcile-youtube -- <post-id>");
    process.exitCode = 1;
    return;
  }

  console.log(`POST_ID: ${postId}`);
  console.log("PLATFORM: youtube");

  const result = await runYoutubeReconciliation(postId, deps);
  for (const line of describeYoutubeReconciliationResult(result)) console.log(line);

  console.log("\n--- Confirmaciones de seguridad (siempre verdaderas en esta version) ---");
  console.log("NO DATABASE WRITE: este comando nunca ejecuta INSERT/UPDATE/DELETE sobre Supabase.");
  console.log("NO PUBLICATION: nunca se llama a publishToYouTube ni a ningun otro publisher.");
  console.log("NO RETRY: nunca se llama a resolveVerificationRequired ni se cambia status/retry_count.");
  console.log("Real publication: NOT ENABLED");
  console.log("Second upload session: NEVER STARTED");

  console.log(`\n[EVIDENCIA] Consulta de reconciliacion ejecutada en ${new Date().toISOString()} para post_id=${postId}. Este resultado NO fue persistido en base de datos - solo mostrado arriba.`);
}

main().catch((err) => {
  console.error(`ERROR inesperado: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
