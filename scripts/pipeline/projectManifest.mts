import { readdirSync } from "node:fs";
import path from "node:path";
import { PROJECTS_DIR, readJson, projectFilePath, writeJsonAtomic } from "./stateStore.mts";

export type ProjectStatus =
  | "WAITING_FOR_MATERIAL"
  | "AUTHORIZED"
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "ERROR"
  // El material existe (podría estar READY, ver checkCompleteness) pero el
  // proyecto fue retenido deliberadamente — nunca se encola solo, ni por
  // watcher ni por reconciliación, hasta que alguien lo libere (releaseProject,
  // ver authorization.mts).
  | "HELD";

export type StageStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "ERROR";

export type ProjectManifest = {
  projectId: string; // el número de carpeta del episodio, ej. "008"
  account: string;
  status: ProjectStatus;
  // Hashes de TODO el material (guion+narración+videos+imágenes) tal como
  // estaba la última vez que este proyecto llegó a COMPLETED — si al
  // reescanear el set de hashes cambió, hay material nuevo real (no solo un
  // rename) y el proyecto necesita pasar de nuevo por autorización antes de
  // volver a producirse (Fase 4.5 — nunca se re-encola solo).
  materialHashes: string[];
  // Fase 4.5 — trazabilidad de la autorización humana explícita (gate entre
  // READY y QUEUED). authorizedMaterialHashes es el snapshot exacto de
  // material que un humano aprobó: si el material real cambia después,
  // el hash deja de coincidir y el proyecto NO se encola (ver
  // agent.mts::decideEnqueue) hasta una nueva autorización.
  authorizedAt?: string;
  authorizedBy?: string;
  authorizedMaterialHashes?: string[];
  stages: {
    main: { status: StageStatus; outputPath?: string; renderedAt?: string; error?: string };
    clips: { status: StageStatus; count?: number; renderedAt?: string; error?: string };
  };
  productionId: string | null;
  attempt: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

const emptyManifest = (account: string, projectId: string): ProjectManifest => ({
  projectId,
  account,
  status: "WAITING_FOR_MATERIAL",
  materialHashes: [],
  stages: {
    main: { status: "PENDING" },
    clips: { status: "PENDING" },
  },
  productionId: null,
  attempt: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export const loadProject = (account: string, projectId: string): ProjectManifest =>
  readJson<ProjectManifest>(projectFilePath(account, projectId), emptyManifest(account, projectId));

export const saveProject = (manifest: ProjectManifest): void => {
  manifest.updatedAt = new Date().toISOString();
  writeJsonAtomic(projectFilePath(manifest.account, manifest.projectId), manifest);
};

// Compara dos sets de hashes por contenido (sin importar orden) — único punto
// de comparación, reusado tanto para "¿cambió el material desde COMPLETED?"
// como para "¿el material sigue siendo el que se autorizó?" (authorization.mts).
export const hashSetsEqual = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((h) => setB.has(h));
};

// true si el set de hashes actual difiere del guardado la última vez que se
// completó — cubre tanto "hay archivos nuevos" como "un archivo cambió de
// contenido" (versión nueva), pero NO un simple rename (mismo hash).
export const hasNewMaterialSince = (manifest: ProjectManifest, currentHashes: string[]): boolean =>
  !hashSetsEqual(manifest.materialHashes, currentHashes);

export const listAllProjectFiles = (): string[] => {
  try {
    return readdirSync(PROJECTS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(PROJECTS_DIR, f));
  } catch {
    return [];
  }
};
