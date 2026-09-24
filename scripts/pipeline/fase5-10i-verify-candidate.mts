// FASE 5.10-I, PASO 1 — verificacion READ-ONLY del candidato antes de
// procesarlo. Cero credenciales seleccionadas, cero escritura.
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const CANDIDATE_ID = "51025427-c2e2-4a4f-a8b3-81bcadedc9e0";
const SIN_EXPLICACION_ID = "d875e649-d554-4a36-897b-bb3161244b6d";

async function main() {
  console.log("=== content_files (candidato) ===");
  const { data: file, error } = await supabaseAdmin
    .from("content_files")
    .select("id, content_account_id, status, folder_type, file_path, file_hash, file_size, episode_id, detected_at")
    .eq("id", CANDIDATE_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  console.log(JSON.stringify(file));
  console.log(`Pertenece a SIN EXPLICACIÓN: ${file?.content_account_id === SIN_EXPLICACION_ID}`);

  console.log("\n=== content_metadata asociado ===");
  const { data: meta, error: metaError } = await supabaseAdmin
    .from("content_metadata")
    .select("id, content_file_id, status")
    .eq("content_file_id", CANDIDATE_ID)
    .maybeSingle();
  if (metaError) throw new Error(metaError.message);
  console.log(JSON.stringify(meta) || "null");

  console.log("\n=== social_posts asociados ===");
  const { data: posts, error: postsError } = await supabaseAdmin
    .from("social_posts")
    .select("id, account_id, status")
    .eq("content_file_id", CANDIDATE_ID);
  if (postsError) throw new Error(postsError.message);
  console.log(`Total: ${posts?.length ?? 0}`);
  for (const p of posts ?? []) console.log(JSON.stringify(p));
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
