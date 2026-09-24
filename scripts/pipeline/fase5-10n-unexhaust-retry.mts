// FASE 5.10-N — UNICO UPDATE autorizado: recuperacion puntual del
// content_metadata que agoto sus reintentos, para dejarlo elegible para
// exactamente UN retry mas (con OLLAMA_MAX_OUTPUT_TOKENS=2500 ya aplicado).
// Cambia UNICAMENTE retry_count (3 -> 2); status ya esta en 'error' (sin
// cambio necesario ahi). CAS: id exacto + status='error' + retry_count=3
// exactos - estructuralmente imposible afectar otra fila o repetirse.
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const TARGET_METADATA_ID = "4aafd3a7-1131-439c-8913-f1e5c32cebcc";
const EXPECTED_CONTENT_FILE_ID = "51025427-c2e2-4a4f-a8b3-81bcadedc9e0";

async function main() {
  console.log("=== UPDATE (CAS: id + status='error' + retry_count=3 exactos) ===");
  const { data: updated, error } = await supabaseAdmin
    .from("content_metadata")
    .update({ retry_count: 2 })
    .eq("id", TARGET_METADATA_ID)
    .eq("status", "error")
    .eq("retry_count", 3)
    .select("id, content_file_id, status, retry_count, updated_at");

  if (error) throw new Error(error.message);
  console.log(`Filas afectadas: ${updated?.length ?? 0}`);
  for (const row of updated ?? []) console.log(JSON.stringify(row));

  if ((updated?.length ?? 0) !== 1) {
    console.error("ADVERTENCIA: se esperaba exactamente 1 fila afectada. Deteniendose sin asumir nada mas.");
    process.exit(1);
  }

  console.log("\n=== SELECT de verificacion (fresco, post-UPDATE) ===");
  const { data: verify, error: verifyError } = await supabaseAdmin
    .from("content_metadata")
    .select("id, content_file_id, status, retry_count, updated_at")
    .eq("id", TARGET_METADATA_ID)
    .maybeSingle();
  if (verifyError) throw new Error(verifyError.message);
  console.log(JSON.stringify(verify));
  console.log(`content_file_id coincide: ${verify?.content_file_id === EXPECTED_CONTENT_FILE_ID}`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
