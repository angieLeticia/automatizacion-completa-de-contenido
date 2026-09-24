import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

async function main() {
  const { data, error } = await supabaseAdmin
    .from("content_metadata")
    .select("id, content_file_id, status, updated_at, retry_count")
    .eq("content_file_id", "51025427-c2e2-4a4f-a8b3-81bcadedc9e0")
    .maybeSingle();
  if (error) throw new Error(error.message);
  console.log(JSON.stringify(data));
  if (data?.updated_at) {
    const ageMin = (Date.now() - new Date(data.updated_at as string).getTime()) / 60000;
    console.log(`Edad del reclamo: ${ageMin.toFixed(1)} minutos (umbral STALE_CLAIM_MINUTES=30)`);
    console.log(`Hora actual (UTC): ${new Date().toISOString()}`);
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
