import type { PublishResult, SocialPost } from "./types";

const GRAPH_VERSION = "v19.0";

export interface FacebookCredentials {
  page_id: string;
  access_token: string;
}

export async function publishToFacebook(post: SocialPost, creds: FacebookCredentials): Promise<PublishResult> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${creds.page_id}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_url: post.video_url,
      description: post.caption || post.title || "",
      access_token: creds.access_token,
    }),
  });
  if (!res.ok) {
    throw new Error(`Falló la publicación en Facebook: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { id: string };
  return { externalPostId: data.id };
}
