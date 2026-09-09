// Configuración de la Ingesta (Fase 4.3). Módulo nuevo, aislado — no depende
// de Supabase, no depende de Remotion, no depende de ningún proveedor de
// investigación.
import path from "node:path";

try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", ".env.local"));
} catch {
  // .env.local no existe o ya está cargado por el shell — seguimos sin frenar.
}

// Reutiliza la MISMA variable que scripts/pipeline y agent/ — un solo
// MATERIAL_ROOT para todo el sistema, no uno nuevo por módulo.
export const MATERIAL_ROOT = process.env.MATERIAL_ROOT || "D:\\MATERIAL VIDEOS";

// Carpeta observada del Inbox — deliberadamente FUERA de MATERIAL_ROOT por
// defecto (sibling, no subcarpeta) para que nunca se confunda con una cuenta
// de contenido, aunque el filtro por ACCOUNTS del watcher de Agente 2 ya lo
// ignoraría de todos modos si estuviera adentro.
export const INBOX_ROOT = process.env.INBOX_ROOT || path.join(path.dirname(MATERIAL_ROOT), "INBOX");

export const MANIFEST_FILENAME = "manifest.json";

export const STATE_DIR = path.join(import.meta.dirname, "state");

export const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".jfif", ".gif"]);
export const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a"]);
export const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv"]);
