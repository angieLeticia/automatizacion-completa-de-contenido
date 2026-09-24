import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const id = process.argv[2];
const { data, error } = await supabaseAdmin
  .from("content_files")
  .select("id, content_account_id, episode_id, folder_type, status, file_size, detected_at, error_message")
  .eq("id", id)
  .single();
console.log(error ? error.message : JSON.stringify(data, null, 2));
