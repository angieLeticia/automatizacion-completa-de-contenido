import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

async function main() {
  const { data, error } = await supabaseAdmin
    .from("content_accounts")
    .select("id, folder_name, timezone")
    .eq("id", "d875e649-d554-4a36-897b-bb3161244b6d")
    .maybeSingle();
  if (error) throw new Error(error.message);
  console.log(JSON.stringify(data));
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
