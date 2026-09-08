// Resuelve el content_file real de un social_post y verifica que el archivo local
// exista, sea de un formato valido, este estable (no a medio copiar), y que su
// SHA-256 REAL coincida con content_files.file_hash - ANTES de intentar subirlo
// a Storage. NUNCA inventa una ruta - siempre lee content_files.file_path/file_hash.
import path from "node:path";
import { statSync, existsSync } from "node:fs";
import { supabaseAdmin } from "../supabaseClient.mts";
import { FILE_STABILITY_CHECK_DELAY_MS } from "./config.mts";
import { VIDEO_EXT } from "../config.mts";
import { verifyFileHash } from "./verifyFileHash.mts";
import type { ContentFileRow } from "./types.mts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ResolveFileOutcome =
  | { ok: true; contentFile: ContentFileRow }
  | { ok: false; retryable: boolean; reason: string };

export async function resolveAndVerifyContentFile(contentFileId: string | null): Promise<ResolveFileOutcome> {
  if (!contentFileId) {
    return { ok: false, retryable: false, reason: "El social_post no tiene content_file_id (no proviene del pipeline automatico)." };
  }

  const { data: file, error } = await supabaseAdmin
    .from("content_files")
    .select("id, content_account_id, file_path, file_hash")
    .eq("id", contentFileId)
    .single();

  if (error || !file) {
    return { ok: false, retryable: false, reason: `No se pudo cargar content_files id=${contentFileId}: ${error?.message ?? "no encontrado"}` };
  }

  const ext = path.extname(file.file_path).toLowerCase();
  if (!VIDEO_EXT.has(ext)) {
    return { ok: false, retryable: false, reason: `Extension '${ext}' no es un formato de video valido (esperado uno de: ${[...VIDEO_EXT].join(", ")}).` };
  }

  if (!existsSync(file.file_path)) {
    return { ok: false, retryable: true, reason: `Archivo local no encontrado en '${file.file_path}' (puede ser transitorio - otro proceso podria estar moviendolo).` };
  }

  let firstStat;
  try {
    firstStat = statSync(file.file_path);
  } catch (err) {
    return { ok: false, retryable: true, reason: `No se pudo leer metadata de '${file.file_path}': ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!firstStat.isFile()) {
    return { ok: false, retryable: false, reason: `La ruta '${file.file_path}' no es un archivo regular.` };
  }

  await sleep(FILE_STABILITY_CHECK_DELAY_MS);

  let secondStat;
  try {
    secondStat = statSync(file.file_path);
  } catch (err) {
    return { ok: false, retryable: true, reason: `El archivo desaparecio durante la verificacion de estabilidad: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (firstStat.size !== secondStat.size || firstStat.mtimeMs !== secondStat.mtimeMs) {
    return { ok: false, retryable: true, reason: `El archivo '${file.file_path}' parece estar siendo modificado/copiado ahora mismo (tamano o fecha cambiaron) - no es seguro subirlo todavia.` };
  }

  // Verificacion de integridad: recalcula el SHA-256 REAL del archivo y lo compara
  // contra el que el watcher de la Fase 2 guardo al detectarlo. Un mismatch es
  // PERMANENTE (nunca reintentable) y jamas debe llegar a subirse ni a modificar
  // content_files - solo se reporta.
  const hashCheck = await verifyFileHash(file.file_path, file.file_hash);
  if (!hashCheck.ok) {
    return {
      ok: false,
      retryable: false,
      reason: `INCONSISTENCIA DE HASH: content_files.file_hash='${file.file_hash}' pero el SHA-256 real del archivo es '${hashCheck.actualHash}' - el archivo pudo haber sido reemplazado/corrompido. NO se sube, NO se modifica content_files.`,
    };
  }

  return { ok: true, contentFile: file as ContentFileRow };
}
