import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

async function main() {
  const { data: channels } = await supabaseAdmin.from("social_channels").select("id, name, is_active");
  console.log("=== social_channels ===");
  for (const c of channels ?? []) console.log(JSON.stringify(c));

  const { data: accounts } = await supabaseAdmin.from("social_accounts").select("id, channel_id, platform, label, is_active");
  console.log("\n=== social_accounts (SIN credentials) ===");
  for (const a of accounts ?? []) console.log(JSON.stringify(a));

  const channelIds = new Set((channels ?? []).map((c) => c.id));
  const orphan = (accounts ?? []).filter((a) => !channelIds.has(a.channel_id));
  console.log(`\nhuérfanos (imposible por FK, solo confirmación): ${orphan.length}`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
