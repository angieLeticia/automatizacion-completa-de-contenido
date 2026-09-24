import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";
import { verifyYoutubeChannelIdentity } from "../../agent/publish/youtubeChannelIdentity.mts";

async function main() {
  const { data: channels } = await supabaseAdmin.from("social_channels").select("id, name");
  const { data: accounts } = await supabaseAdmin.from("social_accounts").select("id, channel_id, label, credentials").eq("platform", "youtube");

  for (const ch of channels ?? []) {
    const acc = (accounts ?? []).find((a) => a.channel_id === ch.id);
    if (!acc) continue;
    const result = await verifyYoutubeChannelIdentity(acc.credentials as never);
    console.log(`${ch.name} / YouTube: ${result.status}`);
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
