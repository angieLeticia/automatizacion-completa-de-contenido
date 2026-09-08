import { statSync } from "node:fs";
import { hashFile } from "./fileHash.mts";
import { readJson, stateFilePath, writeJsonAtomic } from "./stateStore.mts";

export type MaterialType = "script" | "narration" | "video" | "image" | "sound";

export type Usage = { account: string; projectId: string; usedAt: string };

// Identidad de CONTENIDO (por hash) separada de USO (qué producciones lo
// usaron). Un mismo archivo de biblioteca (música, SFX, un stock clip
// genérico) puede reutilizarse legítimamente en varios episodios — el hash
// solo evita procesar dos veces el MISMO contenido como si fuera nuevo, pero
// nunca le pertenece a un solo proyecto.
export type FileRecord = {
  hash: string;
  path: string; // última ruta conocida — puede cambiar por rename sin que cambie el hash
  materialType: MaterialType;
  size: number;
  detectedAt: string; // primera vez que se vio este contenido, en cualquier proyecto
  usedIn: Usage[];
};

type Registry = Record<string, FileRecord>; // hash -> record

const REGISTRY_PATH = stateFilePath("files.json");

const load = (): Registry => readJson<Registry>(REGISTRY_PATH, {});
const save = (registry: Registry) => writeJsonAtomic(REGISTRY_PATH, registry);

// Da de alta (o actualiza la ruta de) un archivo por su hash real, no por
// nombre — si se renombra pero el contenido es idéntico, se reconoce como el
// MISMO archivo (misma entrada, solo se actualiza `path`) en vez de tratarse
// como material nuevo. NO asigna dueño — eso es `recordUsage`.
export const registerFile = async (
  filePath: string,
  materialType: MaterialType
): Promise<{ record: FileRecord; isNewContent: boolean }> => {
  const registry = load();
  const hash = await hashFile(filePath);

  const existing = registry[hash];
  if (existing) {
    if (existing.path !== filePath) existing.path = filePath; // mismo contenido, ruta nueva (rename)
    save(registry);
    return { record: existing, isNewContent: false };
  }

  const record: FileRecord = {
    hash,
    path: filePath,
    materialType,
    size: statSync(filePath).size,
    detectedAt: new Date().toISOString(),
    usedIn: [],
  };
  registry[hash] = record;
  save(registry);
  return { record, isNewContent: true };
};

// Registra que este contenido se usó en una producción — no reemplaza usos
// anteriores en otros proyectos, se suma (idempotente: no duplica la misma
// cuenta+proyecto dos veces).
export const recordUsage = (hash: string, account: string, projectId: string): void => {
  const registry = load();
  const record = registry[hash];
  if (!record) return;
  const already = record.usedIn.some((u) => u.account === account && u.projectId === projectId);
  if (!already) record.usedIn.push({ account, projectId, usedAt: new Date().toISOString() });
  save(registry);
};

export const isUsedInProject = (hash: string, account: string, projectId: string): boolean => {
  const registry = load();
  return registry[hash]?.usedIn.some((u) => u.account === account && u.projectId === projectId) ?? false;
};

// Hashes de TODOS los archivos de material de un proyecto ahora mismo (para
// comparar contra el snapshot guardado la última vez que se procesó, ver
// projectManifest.mts::hasNewMaterialSince).
export const hashAll = async (filePaths: string[]): Promise<string[]> => Promise.all(filePaths.map(hashFile));
