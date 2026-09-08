import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const STATE_DIR = path.join(REPO_ROOT, "scripts", "pipeline", "state");
export const PROJECTS_DIR = path.join(STATE_DIR, "projects");

const ensureDir = (dir: string) => mkdirSync(dir, { recursive: true });

// Escritura atómica: escribe a un archivo temporal en el mismo directorio y
// recién después lo renombra sobre el destino. rename() en el mismo volumen
// es atómico — si el proceso muere a mitad de camino, el archivo final nunca
// queda a medio escribir/corrupto, en el peor caso queda el .tmp huérfano.
export const writeJsonAtomic = (filePath: string, data: unknown): void => {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmpPath, filePath);
};

export const readJson = <T,>(filePath: string, fallback: T): T => {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    // JSON corrupto (ej. proceso murió escribiendo sin pasar por el .tmp de
    // arriba, o el archivo se editó a mano mal) — se trata como si no existiera
    // en vez de tumbar el agente entero por un solo archivo de estado.
    return fallback;
  }
};

export const stateFilePath = (...segments: string[]): string => path.join(STATE_DIR, ...segments);
export const projectFilePath = (account: string, episodeId: string): string =>
  path.join(PROJECTS_DIR, `${sanitizeForFilename(account)}__${episodeId}.json`);

const sanitizeForFilename = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
