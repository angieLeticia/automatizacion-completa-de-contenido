// FASE 5.10-U, PASO B — UNICO UPDATE autorizado: recuperacion puntual del
// clip "014 - Parte 5.mp4", replicando EXACTAMENTE la transicion de
// recoverStaleClaims() (agent/analyze/claimWork.mts) para una sola fila.
// CAS: id exacto + status='transcribing' exacto.
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const TARGET_METADATA_ID = "225aadf3-a15f-4342-a6b0-ffc8ab746b88";
const EXPECTED_CONTENT_FILE_ID = "9a69c9d5-22c7-4c28-80d9-b5aa6ec331cf";

async function main() {
  console.log("=== UPDATE (CAS: id + status='transcribing' exactos) ===");
  const { data: updated, error } = await supabaseAdmin
    .from("content_metadata")
    .update({
      status: "error",
      retry_count: 2,
      error_message: "Proceso interrumpido (reclamo expirado, posible caída a mitad de proceso). Cuenta como intento.",
    })
    .eq("id", TARGET_METADATA_ID)
    .eq("status", "transcribing")
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

  console.log("\n=== social_posts (debe seguir en 0) ===");
  const { data: posts, error: postsError } = await supabaseAdmin.from("social_posts").select("id").eq("content_file_id", EXPECTED_CONTENT_FILE_ID);
  if (postsError) throw new Error(postsError.message);
  console.log(`Total: ${posts?.length ?? 0}`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
