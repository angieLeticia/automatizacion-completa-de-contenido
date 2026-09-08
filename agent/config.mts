// Configuración del agente de publicación (Fase 2: solo detección y registro).
// Módulo completamente aislado de remotion/ y scripts/pipeline/ — este agente
// nunca genera, edita ni renderiza video, solo trabaja con archivos YA terminados.
import { existsSync } from "node:fs";
import path from "node:path";

try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", ".env.local"));
} catch {
  // .env.local no existe o ya está cargado por el shell — seguimos sin frenar.
}

export const MATERIAL_ROOT = process.env.MATERIAL_ROOT || "D:\\MATERIAL VIDEOS";

// Carpetas de salida (contenido ya terminado) que vigila el agente, una por cuenta.
export const OUTPUT_FOLDERS = {
  completo: "Videos YouTube Completos",
  clip: "Clips",
} as const;
export type FolderType = keyof typeof OUTPUT_FOLDERS;

export const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv"]);

// Tiempo sin cambios de tamaño que debe pasar antes de considerar un archivo
// "terminado de copiar" — lo aplica chokidar vía awaitWriteFinish (ver watcher).
export const FILE_STABILITY_MS = 10_000;
export const STABILITY_POLL_MS = 1_000;

// Descarta archivos claramente vacíos/truncados antes de intentar analizarlos.
export const MIN_FILE_SIZE_BYTES = 1024 * 1024; // 1 MB

// Cuánto se cachea en memoria la lista de content_accounts activas antes de
// volver a consultarla (para no pegarle a la base de datos por cada archivo).
export const ACCOUNTS_CACHE_TTL_MS = 60_000;

export function assertMaterialRootExists(): void {
  if (!existsSync(MATERIAL_ROOT)) {
    throw new Error(`MATERIAL_ROOT no existe: ${MATERIAL_ROOT}`);
  }
}
