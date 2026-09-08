import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import type { PublishResult, SocialPost } from "./types";

export interface YouTubeCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

async function getAccessToken(creds: YouTubeCredentials): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`No se pudo refrescar el token de YouTube: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// La API de subida resumible de YouTube NUNCA exigió una URL pública - acepta
// cualquier stream de bytes. Si el post trae local_file_path (entrega directa,
// Fase 4B.5), se lee el archivo del disco sin pasar por Supabase Storage. Si no,
// se mantiene el comportamiento original (descargar desde video_url) para no
// romper ningún flujo existente. Ninguno de los dos casos carga el archivo
// completo en RAM - ambos son streams.
async function resolveVideoSource(post: SocialPost): Promise<{ stream: ReadableStream; contentLength: string }> {
  if (post.local_file_path) {
    const stat = statSync(post.local_file_path);
    const stream = Readable.toWeb(createReadStream(post.local_file_path)) as unknown as ReadableStream;
    return { stream, contentLength: String(stat.size) };
  }

  const videoRes = await fetch(post.video_url);
  if (!videoRes.ok || !videoRes.body) {
    throw new Error(`No se pudo descargar el vídeo desde ${post.video_url}`);
  }
  const contentLength = videoRes.headers.get("content-length");
  if (!contentLength) {
    throw new Error("La respuesta del vídeo no trae Content-Length; no se puede iniciar la subida resumible.");
  }
  return { stream: videoRes.body, contentLength };
}

export async function publishToYouTube(post: SocialPost, creds: YouTubeCredentials): Promise<PublishResult> {
  const accessToken = await getAccessToken(creds);
  const { stream, contentLength } = await resolveVideoSource(post);

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": contentLength,
      },
      body: JSON.stringify({
        snippet: {
          title: post.title || "Visteapy",
          description: post.caption || "",
        },
        status: {
          privacyStatus: "public",
          selfDeclaredMadeForKids: false,
        },
      }),
    }
  );
  if (!initRes.ok) {
    throw new Error(`No se pudo iniciar la subida a YouTube: ${initRes.status} ${await initRes.text()}`);
  }
  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) {
    throw new Error("YouTube no devolvió la URL de subida resumible (header Location).");
  }

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": contentLength },
    // @ts-expect-error -- duplex es requerido por undici para body en streaming y aún no está en los tipos de fetch
    duplex: "half",
    body: stream,
  });
  if (!uploadRes.ok) {
    throw new Error(`Falló la subida del vídeo a YouTube: ${uploadRes.status} ${await uploadRes.text()}`);
  }
  const uploaded = (await uploadRes.json()) as { id: string };
  return { externalPostId: uploaded.id };
}
