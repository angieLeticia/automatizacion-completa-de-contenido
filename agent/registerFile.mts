// Registro anti-duplicados + detección explícita de conflictos de cuenta.
// file_hash es UNIQUE global en content_files: si el INSERT choca, puede ser (a) el
// mismo archivo re-detectado para la MISMA cuenta (duplicado normal, se ignora), o
// (b) el mismo archivo detectado bajo una cuenta DISTINTA (conflicto real) — en ese
// caso se registra en content_file_conflicts y se bloquea, nunca se lanza una
// excepción sin controlar ni se sigue procesando como si nada.
import { supabaseAdmin } from "./supabaseClient.mts";
import { log } from "./logger.mts";
import type { FolderType } from "./config.mts";

export type RegisterResult =
  | { outcome: "inserted"; id: string }
  | { outcome: "duplicate" }
  | { outcome: "conflict" };

export async function registerFile(params: {
  contentAccountId: string;
  folderType: FolderType;
  filePath: string;
  fileHash: string;
  fileSize: number;
  // Fase 4.3: agrupa este content_file con los demás del mismo episodio
  // (content_files.episode_id, ver docs/system-contracts.md §1 — decisión de
  // Fase 2.1 de NO crear una tabla `episodes` separada). Opcional: si no se
  // pudo determinar de forma confiable, queda NULL, nunca se inventa.
  episodeId?: string | null;
}): Promise<RegisterResult> {
  const { contentAccountId, folderType, filePath, fileHash, fileSize, episodeId } = params;

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("content_files")
    .insert({
      content_account_id: contentAccountId,
      folder_type: folderType,
      file_path: filePath,
      file_hash: fileHash,
      file_size: fileSize,
      status: "detected",
      episode_id: episodeId ?? null,
    })
    .select("id")
    .maybeSingle();

  if (!insertError && inserted) {
    log.info("Archivo nuevo registrado en content_files", { filePath, fileHash, id: inserted.id });
    return { outcome: "inserted", id: inserted.id };
  }

  const isUniqueViolation = insertError?.code === "23505"; // unique_violation de Postgres
  if (!isUniqueViolation) {
    log.error("Error insertando en content_files", { filePath, error: insertError?.message });
    throw new Error(insertError?.message ?? "Error desconocido insertando content_files");
  }

  const { data: existing, error: selectError } = await supabaseAdmin
    .from("content_files")
    .select("id, content_account_id, file_path")
    .eq("file_hash", fileHash)
    .maybeSingle();

  if (selectError || !existing) {
    log.error("No se pudo leer el registro existente tras el conflicto de hash", {
      filePath,
      error: selectError?.message,
    });
    throw new Error(selectError?.message ?? "content_files no encontrado tras conflicto de hash");
  }

  if (existing.content_account_id === contentAccountId) {
    log.info("Archivo ya registrado (mismo hash, misma cuenta) — se ignora", { filePath, fileHash });
    return { outcome: "duplicate" };
  }

  log.warn("CONFLICTO DE CUENTA: mismo archivo (hash) detectado bajo una cuenta distinta — bloqueado, no se publica", {
    fileHash,
    rutaOriginal: existing.file_path,
    cuentaOriginalId: existing.content_account_id,
    rutaConflicto: filePath,
    cuentaConflictoId: contentAccountId,
  });

  const { error: conflictError } = await supabaseAdmin.from("content_file_conflicts").insert({
    file_hash: fileHash,
    original_content_file_id: existing.id,
    conflicting_account_id: contentAccountId,
    conflicting_file_path: filePath,
  });
  if (conflictError) {
    log.error("No se pudo registrar el conflicto en content_file_conflicts", { error: conflictError.message });
  }

  await supabaseAdmin
    .from("content_files")
    .update({ status: "account_conflict", error_message: `Conflicto de hash con: ${filePath}` })
    .eq("id", existing.id);

  return { outcome: "conflict" };
}
