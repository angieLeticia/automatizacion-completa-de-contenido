import { createClient } from "@supabase/supabase-js";
import { PUBLISHERS } from "../lib/social/publishers";
import type { SocialAccount, SocialPost } from "../lib/social/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type DuePost = SocialPost & { social_accounts: SocialAccount };

// Borra el vídeo del bucket una vez que TODAS las publicaciones que lo usan
// terminaron en "published" — las redes ya lo alojan ellas mismas, así que no
// hace falta pagar por guardarlo también en Supabase Storage. Si alguna
// quedó en "error", conservamos el vídeo para poder reintentar.
async function cleanupVideoIfDone(videoPath: string) {
  const { count } = await supabase
    .from("social_posts")
    .select("id", { count: "exact", head: true })
    .eq("video_path", videoPath)
    .neq("status", "published");

  if (!count) {
    await supabase.storage.from("social-videos").remove([videoPath]);
    console.log(`  -> vídeo ${videoPath} borrado del storage (todas sus publicaciones ya se completaron)`);
  }
}

async function main() {
  const { data: duePosts, error } = await supabase
    .from("social_posts")
    .select("*, social_accounts(*)")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString());

  if (error) {
    console.error("Error consultando social_posts:", error);
    process.exit(1);
  }

  if (!duePosts || duePosts.length === 0) {
    console.log("No hay publicaciones pendientes por ahora.");
    return;
  }

  for (const post of duePosts as unknown as DuePost[]) {
    const account = post.social_accounts;
    console.log(`Publicando ${account.platform} (${account.label || account.id}) — post ${post.id} (${post.title || "sin título"})`);
    await supabase.from("social_posts").update({ status: "publishing" }).eq("id", post.id);

    const publish = PUBLISHERS[account.platform];
    if (!publish) {
      await supabase
        .from("social_posts")
        .update({ status: "error", error_message: `Plataforma no soportada aún: ${account.platform}` })
        .eq("id", post.id);
      continue;
    }

    try {
      const { externalPostId } = await publish(post, account.credentials);
      await supabase
        .from("social_posts")
        .update({
          status: "published",
          external_post_id: externalPostId,
          published_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", post.id);
      console.log(`  -> publicado (${externalPostId})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  -> error:`, message);
      await supabase.from("social_posts").update({ status: "error", error_message: message }).eq("id", post.id);
    }

    await cleanupVideoIfDone(post.video_path);
  }
}

main();
