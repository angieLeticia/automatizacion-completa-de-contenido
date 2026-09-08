// Recuperación al arrancar: retoma cualquier content_files que se haya quedado a
// medias (el proceso se interrumpió entre registrar el archivo y terminar de
// validarlo) ANTES de empezar a vigilar. El re-escaneo de chokidar al arrancar no
// alcanza a arreglar esto por sí solo: si el archivo ya está registrado, registerFile()
// lo trata como duplicado y nunca vuelve a intentar la validación.
import { existsSync } from "node:fs";
import { supabaseAdmin } from "./supabaseClient.mts";
import { validateFile } from "./validateFile.mts";
import { log } from "./logger.mts";

export async function recoverPending(): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("content_files")
    .select("id, file_path")
    .in("status", ["detected", "validating"]);

  if (error) {
    log.error("No se pudo consultar content_files pendientes al arrancar", { error: error.message });
    return;
  }
  if (!data || data.length === 0) {
    log.info("Sin archivos pendientes de una corrida anterior.");
    return;
  }

  log.info(`Recuperando ${data.length} archivo(s) pendiente(s) de una corrida anterior...`);
  for (const row of data) {
    if (!existsSync(row.file_path)) {
      log.warn("Archivo pendiente ya no existe en disco — se marca inválido", { filePath: row.file_path });
      await supabaseAdmin
        .from("content_files")
        .update({ status: "invalid", error_message: "Archivo no encontrado en disco al recuperar" })
        .eq("id", row.id);
      continue;
    }

    await supabaseAdmin.from("content_files").update({ status: "validating" }).eq("id", row.id);
    const validation = validateFile(row.file_path);
    if (!validation.ok) {
      log.warn("Recuperación: validación FALLÓ", { filePath: row.file_path, reason: validation.reason });
      await supabaseAdmin
        .from("content_files")
        .update({ status: "invalid", error_message: validation.reason })
        .eq("id", row.id);
    } else {
      log.info("Recuperación: archivo validado correctamente", { filePath: row.file_path });
      await supabaseAdmin.from("content_files").update({ status: "analyzing" }).eq("id", row.id);
    }
  }
}
