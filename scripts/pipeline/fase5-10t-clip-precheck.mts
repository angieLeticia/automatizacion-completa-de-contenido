import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const SIN_EXPLICACION_ID = "d875e649-d554-4a36-897b-bb3161244b6d";
const CANDIDATE_FILE_ID = "9a69c9d5-22c7-4c28-80d9-b5aa6ec331cf";
const CANDIDATE_METADATA_ID = "225aadf3-a15f-4342-a6b0-ffc8ab746b88";
const IG_ACCOUNT_ID = "06ba45aa-59ae-4d8e-aae5-14c36a94fa8d";
const FB_ACCOUNT_ID = "fac4bb1c-dec2-4232-940c-b8c0aa5e1608";

async function main() {
  const { data: file, error: fileError } = await supabaseAdmin
    .from("content_files")
    .select("id, content_account_id, folder_type, file_path, status")
    .eq("id", CANDIDATE_FILE_ID)
    .maybeSingle();
  if (fileError) throw new Error(fileError.message);
  console.log("=== content_file ===");
  console.log(JSON.stringify({ ...file, pertenece_a_sin_explicacion: file?.content_account_id === SIN_EXPLICACION_ID }));

  const { data: meta, error: metaError } = await supabaseAdmin
    .from("content_metadata")
    .select("id, content_file_id, status, retry_count, updated_at")
    .eq("id", CANDIDATE_METADATA_ID)
    .maybeSingle();
  if (metaError) throw new Error(metaError.message);
  console.log("\n=== content_metadata ===");
  console.log(JSON.stringify(meta));
  if (meta?.updated_at) {
    const ageMin = (Date.now() - new Date(meta.updated_at as string).getTime()) / 60000;
    console.log(`Antiguedad de updated_at: ${ageMin.toFixed(1)} minutos (umbral STALE_CLAIM_MINUTES=30)`);
    console.log(`¿Supera el umbral de stale?: ${ageMin > 30}`);
    console.log(`Hora actual (UTC): ${new Date().toISOString()}`);
  }
  console.log(`content_file_id coincide: ${meta?.content_file_id === CANDIDATE_FILE_ID}`);

  const { data: posts, error: postsError } = await supabaseAdmin
    .from("social_posts")
    .select("id, account_id, status")
    .eq("content_file_id", CANDIDATE_FILE_ID);
  if (postsError) throw new Error(postsError.message);
  console.log("\n=== social_posts asociados ===");
  console.log(`Total: ${posts?.length ?? 0}`);
  const hasIg = (posts ?? []).some((p) => p.account_id === IG_ACCOUNT_ID);
  const hasFb = (posts ?? []).some((p) => p.account_id === FB_ACCOUNT_ID);
  console.log(`Instagram existente: ${hasIg} | Facebook existente: ${hasFb}`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
