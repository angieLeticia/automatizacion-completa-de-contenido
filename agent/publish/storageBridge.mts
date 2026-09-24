// Puente UNICO y reutilizable: archivo local -> Backblaze B2 -> object key.
// Ninguna otra parte del codigo debe duplicar esta logica.
//
// Fase 13 — reemplaza Supabase Storage por Backblaze B2 (S3-compatible) como
// backend real para Instagram/Facebook. Motivo (ver STORAGE_META_AUDIT/
// STORAGE_ALTERNATIVES_AUDIT/FINAL_STORAGE_DECISION_AUDIT, fases previas):
// Supabase Storage Free tiene un limite duro de 50MiB por objeto, que
// bloqueo el piloto real de Facebook con un clip de 147MB; B2 no tiene ese
// limite (probado con el mismo archivo real en el experimento previo a esta
// fase, BACKBLAZE_B2_EXPERIMENT) y su free tier (10GB, sin tarjeta en la
// cuenta usada) lo cubre sin costo mientras el volumen se mantenga bajo ese
// umbral.
//
// La ruta (object key) sigue siendo DETERMINISTICA a partir de
// content_files.file_hash (el SHA-256 que ya calcula el watcher de la Fase 2
// - no se inventa un identificador paralelo). Eso hace la subida
// naturalmente idempotente: si ya existe un objeto con ese key, NUNCA se
// vuelve a subir. Como consecuencia, varios social_posts que comparten el
// mismo content_file (ej. un clip con 2 plataformas) suben el archivo UNA
// sola vez y comparten el mismo object key.
//
// DECISION DE DISEÑO (auditoria previa a implementar, FASE_12_B2_INTEGRATION_AUDIT):
// sin abstraccion StorageProvider formal - se cambia el backend AQUI DENTRO,
// preservando exactamente las mismas 2 funciones exportadas que run.mts ya
// consume por nombre (ensureUploadedToStorage, cleanupVideoIfDone), mas UNA
// funcion nueva (getPresignedUrlFor) para la URL temporal que Meta necesita.
import { createReadStream } from "node:fs";
import path from "node:path";
import { S3Client, HeadObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { supabaseAdmin } from "../supabaseClient.mts";
import { B2_BUCKET_NAME, B2_ENDPOINT, B2_REGION, STORAGE_PREFIX, B2_PRESIGNED_URL_EXPIRY_SECONDS } from "./config.mts";
import type { ContentFileRow } from "./types.mts";

export function storagePathFor(contentFile: ContentFileRow): string {
  const ext = path.extname(contentFile.file_path) || ".mp4";
  return `${STORAGE_PREFIX}/${contentFile.file_hash}${ext}`;
}

export interface StorageBridgeResult {
  videoPath: string; // object key real de B2 - NUNCA una URL (ver Regla 5, Fase 13)
  alreadyExisted: boolean;
}

// Credenciales SOLO via variables de entorno (config.mts las carga desde
// B2_CREDENTIALS_FILE, fuera del repositorio) - nunca hardcodeadas, nunca
// impresas. Si faltan, se lanza un error explicito (PRESENT/MISSING como
// concepto, nunca el valor) en vez de dejar que el SDK falle con un mensaje
// menos claro mas adelante.
// Exportada (solo para test-storage-bridge-b2.mts) - permite confirmar el
// comportamiento PRESENT/MISSING sin exponer nunca los valores reales.
export function getB2Credentials(): { accessKeyId: string; secretAccessKey: string } {
  const accessKeyId = process.env.B2_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Credenciales de Backblaze B2 ausentes (B2_KEY_ID/B2_APPLICATION_KEY) - configurar B2_CREDENTIALS_FILE en .env.local.");
  }
  if (!B2_BUCKET_NAME) {
    throw new Error("B2_BUCKET_NAME ausente - configurar en el archivo apuntado por B2_CREDENTIALS_FILE.");
  }
  return { accessKeyId, secretAccessKey };
}

let cachedClient: S3Client | null = null;
function getS3Client(): S3Client {
  if (cachedClient) return cachedClient;
  const { accessKeyId, secretAccessKey } = getB2Credentials();
  cachedClient = new S3Client({
    region: B2_REGION,
    endpoint: B2_ENDPOINT,
    forcePathStyle: false,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cachedClient;
}

// Usa unicamente la capability "readFiles" (HeadObject) - nunca listBuckets/
// readBuckets ni ninguna otra capability de administracion (Regla explicita
// de esta fase: solo listar/leer/escribir/eliminar ARCHIVOS).
async function objectExists(objectKey: string): Promise<boolean> {
  const s3 = getS3Client();
  try {
    await s3.send(new HeadObjectCommand({ Bucket: B2_BUCKET_NAME, Key: objectKey }));
    return true;
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number }; name?: string })?.$metadata?.httpStatusCode;
    const name = (err as { name?: string })?.name;
    if (status === 404 || name === "NotFound" || name === "404") return false;
    throw new Error(`Error consultando B2 para verificar existencia de '${objectKey}': ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Sube el archivo SOLO si no existe ya en B2 (capability "writeFiles"); en
// cualquier caso devuelve el object key final. No borra ni sobreescribe nada
// existente. Usa Upload (multipart automatico) en vez de un PutObject crudo
// para soportar de forma robusta archivos que superen los limites de una
// subida simple (probado con un archivo real de 147MB en el experimento
// previo a esta fase) sin bufferizar el archivo completo en memoria.
export async function ensureUploadedToStorage(contentFile: ContentFileRow): Promise<StorageBridgeResult> {
  const objectKey = storagePathFor(contentFile);

  const exists = await objectExists(objectKey);
  if (exists) {
    return { videoPath: objectKey, alreadyExisted: true };
  }

  const s3 = getS3Client();
  try {
    const upload = new Upload({
      client: s3,
      params: {
        Bucket: B2_BUCKET_NAME,
        Key: objectKey,
        Body: createReadStream(contentFile.file_path),
        ContentType: "video/mp4",
      },
    });
    await upload.done();
  } catch (err) {
    throw new Error(`Error subiendo '${contentFile.file_path}' a Backblaze B2 en '${objectKey}': ${err instanceof Error ? err.message : String(err)}`);
  }

  return { videoPath: objectKey, alreadyExisted: false };
}

// NUEVO (Fase 13) — genera una URL HTTPS firmada de corta duracion,
// EXCLUSIVAMENTE en memoria (usa la capability "readFiles"). Quien llama a
// esta funcion es responsable de NO persistirla (ni en social_posts.video_url
// ni en logs completos) y de generar una nueva en cada intento/reintento -
// esta funcion en si no cachea ni reutiliza URLs entre llamadas.
export async function getPresignedUrlFor(objectKey: string): Promise<string> {
  const s3 = getS3Client();
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: B2_BUCKET_NAME, Key: objectKey }), {
    expiresIn: B2_PRESIGNED_URL_EXPIRY_SECONDS,
  });
}

// Regla de seguridad explicita (Fase 13): NUNCA eliminar el objeto si existe
// otro social_post que todavia pueda necesitarlo - "pending" (incluye
// reintentos), "publishing", "verification_required" (resultado incierto
// pendiente de reconciliacion), o "error" (fallo permanente no reintentable,
// se conserva igual por prudencia - mismo comportamiento ya auditado que
// tenia esta consulta con Supabase Storage, sin cambios). Solo se borra
// (capability "deleteFiles") si CERO filas de social_posts referencian este
// mismo object key en un estado distinto de "published".
export async function cleanupVideoIfDone(videoPath: string): Promise<void> {
  const { count, error } = await supabaseAdmin
    .from("social_posts")
    .select("id", { count: "exact", head: true })
    .eq("video_path", videoPath)
    .neq("status", "published");

  if (error) {
    throw new Error(`Error consultando social_posts para decidir limpieza de '${videoPath}': ${error.message}`);
  }
  if (!count) {
    const s3 = getS3Client();
    await s3.send(new DeleteObjectCommand({ Bucket: B2_BUCKET_NAME, Key: videoPath }));
  }
}

// Regla pura de decision de cleanup, extraida para poder testearla de forma
// aislada sin tocar Supabase real (ver test-storage-bridge-b2.mts) - la
// misma regla que ya aplica cleanupVideoIfDone() de forma inline arriba.
export function shouldDeleteObject(siblingCountInNonPublishedState: number): boolean {
  return siblingCountInNonPublishedState === 0;
}

export interface UrlReachabilityResult {
  ok: boolean;
  status: number;
  contentType: string | null;
  contentLength: string | null;
}

// Comprueba que una URL (firmada o publica) realmente responde, SIN
// descargar el archivo completo - un HEAD basta para confirmar
// status/Content-Type/Content-Length. Provider-agnostico (funciona igual con
// una URL de B2 que con cualquier otra).
export async function verifyPublicUrlReachable(url: string): Promise<UrlReachabilityResult> {
  const res = await fetch(url, { method: "HEAD" });
  return {
    ok: res.ok,
    status: res.status,
    contentType: res.headers.get("content-type"),
    contentLength: res.headers.get("content-length"),
  };
}
