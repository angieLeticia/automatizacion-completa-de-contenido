// Orquestador de la Fase 2: comprobaciones de entorno -> recuperación de pendientes
// -> escaneo inicial -> vigilancia continua. Sin scheduler, sin Claude, sin
// publishers, sin panel — solo detección y registro en content_files.
import { mkdirSync } from "node:fs";
import path from "node:path";
import chokidar from "chokidar";
import { MATERIAL_ROOT, OUTPUT_FOLDERS, FILE_STABILITY_MS, STABILITY_POLL_MS, assertMaterialRootExists } from "./config.mts";
import { assertFfprobeAvailable } from "./validateFile.mts";
import { getActiveContentAccounts } from "./discoverAccounts.mts";
import { recoverPending } from "./recoverPending.mts";
import { processFile } from "./processFile.mts";
import { log } from "./logger.mts";

// Crea las carpetas de salida de cada cuenta activa si todavía no existen — pura
// gestión de estructura de carpetas, no genera ni toca ningún contenido.
async function ensureAccountFolders(): Promise<void> {
  const accounts = await getActiveContentAccounts(true);
  for (const { folder_name } of accounts.values()) {
    for (const outputFolder of Object.values(OUTPUT_FOLDERS)) {
      mkdirSync(path.join(MATERIAL_ROOT, folder_name, outputFolder), { recursive: true });
    }
  }
}

async function main(): Promise<void> {
  log.info("Arrancando agente de publicación — Fase 2 (solo detección y registro, sin publicar nada).");

  assertMaterialRootExists();
  assertFfprobeAvailable();
  log.info("Comprobaciones de entorno OK (MATERIAL_ROOT, ffprobe).");

  const accounts = await getActiveContentAccounts(true);
  if (accounts.size === 0) {
    log.warn(
      "No hay ninguna content_account activa todavía — el agente no reconocerá ninguna carpeta hasta que exista al menos una en la base de datos."
    );
  } else {
    log.info(`Cuentas de contenido activas: ${[...accounts.keys()].join(", ")}`);
  }

  await ensureAccountFolders();
  await recoverPending();

  log.info(`Iniciando escaneo inicial + vigilancia continua de: ${MATERIAL_ROOT}`);

  const watcher = chokidar.watch(MATERIAL_ROOT, {
    ignoreInitial: false, // el propio escaneo inicial de chokidar cubre el "escaneo inicial" pedido
    depth: 3, // Cuenta/CarpetaSalida/archivo — suficiente, no baja a las subcarpetas de material crudo
    awaitWriteFinish: { stabilityThreshold: FILE_STABILITY_MS, pollInterval: STABILITY_POLL_MS },
    ignorePermissionErrors: true,
  });

  watcher.on("add", (filePath) => {
    processFile(filePath).catch((err) => {
      log.error("Error inesperado procesando archivo", {
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  watcher.on("error", (err) => {
    log.error("Error del watcher", { error: err instanceof Error ? err.message : String(err) });
  });

  watcher.on("ready", () => {
    log.info("Escaneo inicial completo — vigilancia continua activa. Esperando archivos nuevos...");
  });
}

main().catch((err) => {
  log.error("Fallo fatal del agente", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
