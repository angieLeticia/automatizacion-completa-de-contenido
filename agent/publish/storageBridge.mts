// Puente UNICO y reutilizable: archivo local -> Supabase Storage -> URL publica.
// Ninguna otra parte del codigo debe duplicar esta logica.
//
// La ruta de destino es DETERMINISTICA a partir de content_files.file_hash (el
// SHA-256 que ya calcula el watcher de la Fase 2 - no se inventa un identificador
// paralelo). Eso hace la subida naturalmente idempotente: si ya existe un objeto
// en esa ruta, NUNCA se vuelve a subir - se reutiliza la misma URL. Como
// consecuencia, varios social_posts que comparten el mismo content_file (ej. un
// clip con 3 plataformas) suben el archivo UNA sola vez y comparten la URL.
import { createReadStream } from "node:fs";
import path from "node:path";
import { supabaseAdmin } from "../supabaseClient.mts";
import { SOCIAL_VIDEOS_BUCKET, STORAGE_PREFIX } from "./config.mts";
import type { ContentFileRow } from "./types.mts";

export function storagePathFor(contentFile: ContentFileRow): string {
  const ext = path.extname(contentFile.file_path) || ".mp4";
  return `${STORAGE_PREFIX}/${contentFile.file_hash}${ext}`;
}

export interface StorageBridgeResult {
  videoPath: string;
  videoUrl: string;
  alreadyExisted: boolean;
}

async function objectExists(storagePath: string): Promise<boolean> {
  const dir = path.posix.dirname(storagePath);
  const filename = path.posix.basename(storagePath);
  const { data, error } = await supabaseAdmin.storage.from(SOCIAL_VIDEOS_BUCKET).list(dir, { search: filename, limit: 1 });
  if (error) throw new Error(`Error consultando Storage para verificar existencia de '${storagePath}': ${error.message}`);
  return (data ?? []).some((entry) => entry.name === filename);
}

// Sube el archivo SOLO si no existe ya en Storage; en cualquier caso devuelve la
// URL publica final. No borra ni sobreescribe nada existente.
export async function ensureUploadedToStorage(contentFile: ContentFileRow): Promise<StorageBridgeResult> {
  const videoPath = storagePathFor(contentFile);

  const exists = await objectExists(videoPath);
  if (exists) {
    const { data } = supabaseAdmin.storage.from(SOCIAL_VIDEOS_BUCKET).getPublicUrl(videoPath);
    return { videoPath, videoUrl: data.publicUrl, alreadyExisted: true };
  }

  const stream = createReadStream(contentFile.file_path);
  const { error: uploadError } = await supabaseAdmin.storage.from(SOCIAL_VIDEOS_BUCKET).upload(videoPath, stream, {
    contentType: "video/mp4",
    upsert: false,
  });
  if (uploadError) {
    throw new Error(`Error subiendo '${contentFile.file_path}' a Storage en '${videoPath}': ${uploadError.message}`);
  }

  const { data } = supabaseAdmin.storage.from(SOCIAL_VIDEOS_BUCKET).getPublicUrl(videoPath);
  return { videoPath, videoUrl: data.publicUrl, alreadyExisted: false };
}

export interface UrlReachabilityResult {
  ok: boolean;
  status: number;
  contentType: string | null;
  contentLength: string | null;
}

// Comprueba que video_url realmente responde, SIN descargar el archivo completo -
// un HEAD basta para confirmar status/Content-Type/Content-Length.
export async function verifyPublicUrlReachable(url: string): Promise<UrlReachabilityResult> {
  const res = await fetch(url, { method: "HEAD" });
  return {
    ok: res.ok,
    status: res.status,
    contentType: res.headers.get("content-type"),
    contentLength: res.headers.get("content-length"),
  };
}
