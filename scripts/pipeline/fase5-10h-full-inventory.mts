import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const SIN_EXPLICACION_ID = "d875e649-d554-4a36-897b-bb3161244b6d";

async function main() {
  const { data: files, error } = await supabaseAdmin
    .from("content_files")
    .select("id, folder_type, file_path, status, file_size, episode_id, detected_at")
    .eq("content_account_id", SIN_EXPLICACION_ID)
    .order("detected_at", { ascending: false });
  if (error) throw new Error(error.message);
  console.log(`Total content_files de SIN EXPLICACION: ${files?.length ?? 0}`);
  const byStatus = new Map<string, number>();
  for (const f of files ?? []) byStatus.set(f.status as string, (byStatus.get(f.status as string) ?? 0) + 1);
  console.log("Por status:", JSON.stringify(Object.fromEntries(byStatus)));
  console.log("\nPrimeros 20 (mas recientes):");
  for (const f of (files ?? []).slice(0, 20)) console.log(JSON.stringify(f));
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
