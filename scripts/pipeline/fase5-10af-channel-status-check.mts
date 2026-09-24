import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

async function main() {
  const { data, error } = await supabaseAdmin.from("content_accounts").select("folder_name, channel_status, is_active");
  if (error) throw error;
  console.log(JSON.stringify(data, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
