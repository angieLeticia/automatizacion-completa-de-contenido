import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

async function main() {
  const { data } = await supabaseAdmin.from("social_accounts").select("id, label, credentials").eq("platform", "youtube");
  for (const a of data ?? []) {
    const hasChannelId = typeof a.credentials?.channel_id === "string" && a.credentials.channel_id.trim().length > 0;
    console.log(`${a.label}: credentials.channel_id ${hasChannelId ? "configured=true" : "configured=false"}`);
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
