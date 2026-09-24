import "./env.mts";
import { supabaseAdmin } from "../../agent/supabaseClient.mts";

const { data, error } = await supabaseAdmin
  .from("posting_schedule_rules")
  .select("id, content_account_id, platform, day_of_week, window_start, window_end, max_posts_per_day, is_active");
console.log(error ? error.message : JSON.stringify(data, null, 2));
