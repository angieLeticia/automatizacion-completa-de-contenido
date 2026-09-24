import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const SIN_EXPLICACION_ID = "d875e649-d554-4a36-897b-bb3161244b6d";
const CANDIDATE_FILE_ID = "9a69c9d5-22c7-4c28-80d9-b5aa6ec331cf";
const CANDIDATE_METADATA_ID = "225aadf3-a15f-4342-a6b0-ffc8ab746b88";

async function main() {
  const { data: meta, error: metaError } = await supabaseAdmin
    .from("content_metadata")
    .select("id, content_file_id, status, platform_metadata")
    .eq("id", CANDIDATE_METADATA_ID)
    .maybeSingle();
  if (metaError) throw new Error(metaError.message);
  console.log("=== content_metadata ===");
  console.log(
    JSON.stringify({
      id: meta?.id,
      content_file_id: meta?.content_file_id,
      status: meta?.status,
      content_file_id_coincide: meta?.content_file_id === CANDIDATE_FILE_ID,
      platform_metadata_keys: meta?.platform_metadata ? Object.keys(meta.platform_metadata as object) : null,
    })
  );

  const { data: file, error: fileError } = await supabaseAdmin
    .from("content_files")
    .select("id, content_account_id, folder_type")
    .eq("id", CANDIDATE_FILE_ID)
    .maybeSingle();
  if (fileError) throw new Error(fileError.message);
  console.log("\n=== content_file ===");
  console.log(JSON.stringify({ ...file, pertenece_a_sin_explicacion: file?.content_account_id === SIN_EXPLICACION_ID }));

  const { data: account, error: accError } = await supabaseAdmin
    .from("content_accounts")
    .select("id, folder_name, channel_status")
    .eq("id", SIN_EXPLICACION_ID)
    .maybeSingle();
  if (accError) throw new Error(accError.message);
  console.log("\n=== content_account ===");
  console.log(JSON.stringify(account));

  const { data: posts, error: postsError } = await supabaseAdmin.from("social_posts").select("id").eq("content_file_id", CANDIDATE_FILE_ID);
  if (postsError) throw new Error(postsError.message);
  console.log("\n=== social_posts existentes ===");
  console.log(`Total: ${posts?.length ?? 0}`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
