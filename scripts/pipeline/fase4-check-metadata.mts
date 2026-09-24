import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const contentFileId = process.argv[2];
const { data, error } = await supabaseAdmin
  .from("content_metadata")
  .select("id, content_file_id, status, has_speech, duration_seconds, width, height, retry_count, topic_summary, metadata_version")
  .eq("content_file_id", contentFileId)
  .single();
console.log(error ? error.message : JSON.stringify(data, null, 2));
