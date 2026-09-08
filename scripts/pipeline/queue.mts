import { readJson, stateFilePath, writeJsonAtomic } from "./stateStore.mts";

export type JobStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "ERROR";

export type Job = {
  account: string;
  episodeId: string;
  projectId: string; // = episodeId, se guarda aparte por claridad (pedido explícito)
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  lastError?: string;
};

const QUEUE_PATH = stateFilePath("queue.json");
const load = (): Job[] => readJson<Job[]>(QUEUE_PATH, []);
const save = (jobs: Job[]) => writeJsonAtomic(QUEUE_PATH, jobs);
const findIn = (jobs: Job[], account: string, episodeId: string) =>
  jobs.find((j) => j.account === account && j.episodeId === episodeId);

// Dedup por (account, episodeId): si ya hay un trabajo QUEUED o PROCESSING
// para este proyecto, no se agrega uno nuevo — un solo trabajo lógico por
// proyecto, sin importar cuántos archivos dispararon la evaluación.
export const enqueue = (account: string, episodeId: string): { added: boolean; job: Job } => {
  const jobs = load();
  const existingActive = jobs.find(
    (j) => j.account === account && j.episodeId === episodeId && (j.status === "QUEUED" || j.status === "PROCESSING")
  );
  if (existingActive) return { added: false, job: existingActive };

  const now = new Date().toISOString();
  const existing = findIn(jobs, account, episodeId);
  let job: Job;
  if (existing) {
    // ya existía (ej. COMPLETED/ERROR de antes) — se reactiva el mismo registro
    existing.status = "QUEUED";
    existing.updatedAt = now;
    existing.lastError = undefined;
    job = existing;
  } else {
    job = { account, episodeId, projectId: episodeId, status: "QUEUED", createdAt: now, updatedAt: now, attempts: 0 };
    jobs.push(job);
  }
  save(jobs);
  return { added: true, job };
};

export const nextQueued = (): Job | null => load().find((j) => j.status === "QUEUED") ?? null;

export const isActive = (account: string, episodeId: string): boolean => {
  const j = findIn(load(), account, episodeId);
  return j?.status === "QUEUED" || j?.status === "PROCESSING";
};

export const markProcessing = (account: string, episodeId: string): void => {
  const jobs = load();
  const j = findIn(jobs, account, episodeId);
  if (!j) return;
  j.status = "PROCESSING";
  j.attempts += 1;
  j.updatedAt = new Date().toISOString();
  save(jobs);
};

export const markCompleted = (account: string, episodeId: string): void => {
  const jobs = load();
  const j = findIn(jobs, account, episodeId);
  if (!j) return;
  j.status = "COMPLETED";
  j.lastError = undefined;
  j.updatedAt = new Date().toISOString();
  save(jobs);
};

export const markError = (account: string, episodeId: string, error: string): void => {
  const jobs = load();
  const j = findIn(jobs, account, episodeId);
  if (!j) return;
  j.status = "ERROR";
  j.lastError = error;
  j.updatedAt = new Date().toISOString();
  save(jobs);
};

// Al arrancar, cualquier trabajo que haya quedado PROCESSING es de una
// corrida anterior que murió a mitad de camino — se reencola (QUEUED) para
// que el worker lo retome. No se marca automáticamente como completado ni
// como error: el worker/processProject ya reusa las cachés de voz/whisper,
// así que reencolar no repite trabajo caro innecesariamente.
export const requeueStuckProcessing = (): Job[] => {
  const jobs = load();
  const stuck = jobs.filter((j) => j.status === "PROCESSING");
  for (const j of stuck) {
    j.status = "QUEUED";
    j.updatedAt = new Date().toISOString();
  }
  if (stuck.length > 0) save(jobs);
  return stuck;
};

// Fase 4.5 — usado por revokeAuthorization()/holdProject(): si el proyecto
// todavía no arrancó a procesarse (sigue QUEUED), lo saca de la cola por
// completo para que el worker nunca lo tome. Si ya está PROCESSING, no hace
// nada (una ejecución en curso no se interrumpe — ver authorization.mts).
export const cancelQueued = (account: string, episodeId: string): boolean => {
  const jobs = load();
  const j = findIn(jobs, account, episodeId);
  if (!j || j.status !== "QUEUED") return false;
  save(jobs.filter((job) => job !== j));
  return true;
};

export const listJobs = (): Job[] => load();
