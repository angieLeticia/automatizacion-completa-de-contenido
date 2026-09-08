// Procesa un archivo ya detectado y ESTABLE (chokidar ya esperó a que terminara de
// copiarse vía awaitWriteFinish antes de llamar aquí): identifica cuenta, calcula
// hash, registra, valida con ffprobe. No publica ni programa nada — eso es de fases
// posteriores.
import path from "node:path";
import { statSync } from "node:fs";
import { MATERIAL_ROOT, OUTPUT_FOLDERS, VIDEO_EXT, type FolderType } from "./config.mts";
import { getActiveContentAccounts } from "./discoverAccounts.mts";
import { hashFile } from "./hashFile.mts";
import { validateFile } from "./validateFile.mts";
import { registerFile } from "./registerFile.mts";
import { supabaseAdmin } from "./supabaseClient.mts";
import { log } from "./logger.mts";

// Exige la forma exacta MATERIAL_ROOT/<Cuenta>/<Videos YouTube Completos|Clips>/archivo —
// cualquier otra estructura (subcarpetas extra, archivos sueltos en la raíz de la
// cuenta, etc.) se ignora en vez de adivinar qué es.
function parseLocation(filePath: string): { folderName: string; folderType: FolderType } | null {
  const rel = path.relative(MATERIAL_ROOT, filePath);
  const parts = rel.split(path.sep);
  if (parts.length !== 3) return null;

  const [folderName, outputFolder, fileName] = parts;
  const folderType = (Object.keys(OUTPUT_FOLDERS) as FolderType[]).find(
    (key) => OUTPUT_FOLDERS[key] === outputFolder
  );
  if (!folderType) return null;
  if (!VIDEO_EXT.has(path.extname(fileName).toLowerCase())) return null;

  return { folderName, folderType };
}

export async function processFile(filePath: string): Promise<void> {
  const location = parseLocation(filePath);
  if (!location) return; // no es un vídeo en Videos YouTube Completos/Clips de ninguna cuenta

  const { folderName, folderType } = location;

  const accounts = await getActiveContentAccounts();
  const account = accounts.get(folderName);
  if (!account) {
    log.warn("Cuenta de contenido no reconocida — archivo ignorado, no se procesa", { filePath, folderName });
    return;
  }

  log.info("Archivo detectado y estable — procesando", { filePath, folderName, folderType });

  let fileSize: number;
  let fileHash: string;
  try {
    fileSize = statSync(filePath).size;
    fileHash = await hashFile(filePath);
  } catch (err) {
    log.error("No se pudo leer/hashear el archivo — se ignora", {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const result = await registerFile({
    contentAccountId: account.id,
    folderType,
    filePath,
    fileHash,
    fileSize,
  });

  if (result.outcome !== "inserted") return; // duplicado o conflicto: ya quedó todo registrado en registerFile()

  await supabaseAdmin.from("content_files").update({ status: "validating" }).eq("id", result.id);

  const validation = validateFile(filePath);
  if (!validation.ok) {
    log.warn("Validación de archivo FALLÓ", { filePath, reason: validation.reason });
    await supabaseAdmin
      .from("content_files")
      .update({ status: "invalid", error_message: validation.reason })
      .eq("id", result.id);
    return;
  }

  log.info("Archivo validado correctamente — listo para análisis (fase futura)", {
    filePath,
    durationSec: validation.durationSec,
    width: validation.width,
    height: validation.height,
  });
  await supabaseAdmin.from("content_files").update({ status: "analyzing" }).eq("id", result.id);
}
