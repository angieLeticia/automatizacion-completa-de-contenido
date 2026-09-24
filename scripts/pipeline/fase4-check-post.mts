import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const id = process.argv[2];
const { data, error } = await supabaseAdmin
  .from("social_posts")
  .select("id, content_file_id, account_id, title, status, scheduled_at, publication_authorized_at, publication_authorized_by, external_post_id, retry_count, recovery_count, created_at")
  .eq("id", id)
  .single();
console.log(error ? error.message : JSON.stringify(data, null, 2));
