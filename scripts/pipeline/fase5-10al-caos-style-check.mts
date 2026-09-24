import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

async function main() {
  const { data } = await supabaseAdmin.from("content_accounts").select("folder_name, style, timezone, is_active").eq("folder_name", "ENCIENDE EL CAOS").maybeSingle();
  console.log(JSON.stringify(data, null, 2));
}
main();
