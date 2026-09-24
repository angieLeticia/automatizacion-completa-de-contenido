// FASE 5.10-J — UNICO UPDATE autorizado: recuperacion puntual del reclamo
// huerfano de content_metadata.id=4aafd3a7-1131-439c-8913-f1e5c32cebcc,
// replicando EXACTAMENTE la transicion que usa recoverStaleClaims()
// (agent/analyze/claimWork.mts) para una fila individual. Mismo CAS
// (id + status='transcribing'), mismas columnas (status, retry_count,
// error_message), updated_at deja actuar solo al trigger real.
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const TARGET_METADATA_ID = "4aafd3a7-1131-439c-8913-f1e5c32cebcc";
const EXPECTED_CONTENT_FILE_ID = "51025427-c2e2-4a4f-a8b3-81bcadedc9e0";
const SIN_EXPLICACION_ID = "d875e649-d554-4a36-897b-bb3161244b6d";

async function main() {
  console.log("=== UPDATE (CAS: id exacto + status='transcribing' exacto) ===");
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

  console.log("\n=== content_file sigue siendo SIN EXPLICACIÓN ===");
  const { data: file, error: fileError } = await supabaseAdmin
    .from("content_files")
    .select("id, content_account_id")
    .eq("id", EXPECTED_CONTENT_FILE_ID)
    .maybeSingle();
  if (fileError) throw new Error(fileError.message);
  console.log(JSON.stringify({ ...file, pertenece_a_sin_explicacion: file?.content_account_id === SIN_EXPLICACION_ID }));

  console.log("\n=== social_posts del content_file (debe seguir en 0) ===");
  const { data: posts, error: postsError } = await supabaseAdmin.from("social_posts").select("id").eq("content_file_id", EXPECTED_CONTENT_FILE_ID);
  if (postsError) throw new Error(postsError.message);
  console.log(`Total: ${posts?.length ?? 0}`);

  console.log("\n=== Ningun otro content_metadata de SIN EXPLICACIÓN fue tocado en este mismo instante ===");
  const cutoff = new Date(Date.now() - 60_000).toISOString(); // ultimo minuto
  const { data: recentlyTouched, error: recentError } = await supabaseAdmin
    .from("content_metadata")
    .select("id, content_file_id, status, updated_at")
    .gte("updated_at", cutoff)
    .neq("id", TARGET_METADATA_ID);
  if (recentError) throw new Error(recentError.message);
  console.log(`Otras filas de content_metadata actualizadas en el ultimo minuto (deberia ser 0): ${recentlyTouched?.length ?? 0}`);
  for (const r of recentlyTouched ?? []) console.log(JSON.stringify(r));
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
