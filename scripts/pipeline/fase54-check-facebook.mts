import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

async function main() {
  const { data } = await supabaseAdmin.from("social_accounts").select("id, channel_id, label, credentials").eq("platform", "facebook");
  const { data: channels } = await supabaseAdmin.from("social_channels").select("id, name");
  for (const a of data ?? []) {
    const channelName = (channels ?? []).find((c) => c.id === a.channel_id)?.name ?? a.channel_id;
    const pageId = a.credentials?.page_id ?? "(ausente)";
    const hasToken = typeof a.credentials?.access_token === "string" && a.credentials.access_token.trim().length > 0;
    console.log(`${channelName}: page_id=${pageId} access_token=${hasToken ? "configured=true" : "configured=false"}`);
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
