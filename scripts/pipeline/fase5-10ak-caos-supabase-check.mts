// FASE 5.10-AK — verificacion READ-ONLY de que existe (o no) contenido real
// de ENCIENDE EL CAOS ya registrado en Supabase (content_files/content_metadata).
import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

async function main() {
  const { data: account } = await supabaseAdmin.from("content_accounts").select("id, channel_id").eq("folder_name", "ENCIENDE EL CAOS").maybeSingle();
  const { data: files, error } = await supabaseAdmin
    .from("content_files")
    .select("id, folder_type, file_path, status, episode_id, detected_at")
    .eq("content_account_id", account?.id);
  if (error) throw new Error(error.message);
  console.log(`content_files para ENCIENDE EL CAOS: ${files?.length ?? 0}`);
  for (const f of files ?? []) {
    console.log(JSON.stringify(f));
    const { data: meta } = await supabaseAdmin.from("content_metadata").select("status, topic_summary").eq("content_file_id", f.id).maybeSingle();
    console.log(`  metadata: ${JSON.stringify(meta)}`);
  }

  const { data: socialAccounts } = await supabaseAdmin.from("social_accounts").select("platform, is_active").eq("channel_id", account?.channel_id);
  console.log(`\nsocial_accounts: ${JSON.stringify(socialAccounts)}`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
