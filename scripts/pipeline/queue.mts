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
  // Fase 1.4 (workers multiproceso) — identidad del worker-proceso que tiene
  // este job en PROCESSING ahora mismo. Se escriben los tres juntos (ver
  // attachWorker) recién DESPUÉS de que spawn() devolvió un PID real, y se
  // limpian los tres juntos en markCompleted()/markError() (nunca quedan a
  // medias). Jobs QUEUED/COMPLETED/ERROR nunca deberían tenerlos, pero el tipo
  // no lo prohíbe — quien lee debe mirar `status`, no la mera presencia de
  // estos campos.
  workerPid?: number;
  workerToken?: string; // uuid — el PID solo NO alcanza para probar propiedad (puede reciclarse), ver requeueStuckProcessing()
  workerStartedAt?: string;
  // Fase 2 acelerada — puramente informativo (trazabilidad de qué serie
  // originó este job, si alguna). Reusa queue.json, no crea una cola nueva.
  // No participa en dedup/claim/requeue — esos siguen siendo por
  // (account, episodeId) exclusivamente, sin cambios.
  seriesId?: string;
};

const QUEUE_PATH = stateFilePath("queue.json");
const load = (): Job[] => readJson<Job[]>(QUEUE_PATH, []);
const save = (jobs: Job[]) => writeJsonAtomic(QUEUE_PATH, jobs);
const findIn = (jobs: Job[], account: string, episodeId: string) =>
  jobs.find((j) => j.account === account && j.episodeId === episodeId);

// Dedup por (account, episodeId): si ya hay un trabajo QUEUED o PROCESSING
// para este proyecto, no se agrega uno nuevo — un solo trabajo lógico por
// proyecto, sin importar cuántos archivos dispararon la evaluación.
export const enqueue = (account: string, episodeId: string, seriesId?: string): { added: boolean; job: Job } => {
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
    if (seriesId) existing.seriesId = seriesId;
    job = existing;
  } else {
    job = { account, episodeId, projectId: episodeId, status: "QUEUED", createdAt: now, updatedAt: now, attempts: 0, ...(seriesId ? { seriesId } : {}) };
    jobs.push(job);
  }
  save(jobs);
  return { added: true, job };
};

export const nextQueued = (): Job | null => load().find((j) => j.status === "QUEUED") ?? null;

// "Día 1" (cola de producción concurrente) — combina nextQueued()+markProcessing()
// en UNA sola operación síncrona (sin ningún `await` entre leer y escribir el
// archivo), para que dos "slots" de worker del MISMO proceso jamás puedan
// reclamar el mismo episodio: Node.js es single-threaded, así que dos
// llamadas a esta función nunca se intercalan entre sí — mismo principio ya
// usado por el booleano `workerRunning` que existía en agent.mts. No
// reemplaza a nextQueued()/markProcessing() (se conservan sin cambios, por si
// algo más los usa) - es una función nueva y aditiva.
export const claimNextQueued = (): Job | null => {
  const jobs = load();
  const job = jobs.find((j) => j.status === "QUEUED");
  if (!job) return null;
  job.status = "PROCESSING";
  job.attempts += 1;
  job.updatedAt = new Date().toISOString();
  save(jobs);
  return job;
};

export const isActive = (account: string, episodeId: string): boolean => {
  const j = findIn(load(), account, episodeId);
  return j?.status === "QUEUED" || j?.status === "PROCESSING";
};

// Fase 1.4 — asocia el job ya reclamado (PROCESSING) con el worker-proceso
// real que se acaba de spawnear. Se llama DESPUÉS de que spawn() devolvió un
// PID (nunca antes) — si el coordinador muere entre claimNextQueued() y esta
// llamada, el job queda PROCESSING SIN estos campos, lo cual
// requeueStuckProcessing() trata explícitamente como "no reencolar
// automáticamente" (ver más abajo) en vez de asumir que es seguro.
export type WorkerInfo = { pid: number; token: string; startedAt: string };

export const attachWorker = (account: string, episodeId: string, info: WorkerInfo): void => {
  const jobs = load();
  const j = findIn(jobs, account, episodeId);
  if (!j) return;
  j.workerPid = info.pid;
  j.workerToken = info.token;
  j.workerStartedAt = info.startedAt;
  j.updatedAt = new Date().toISOString();
  save(jobs);
};

// Copiado (no importado) de scripts/pipeline/agentLock.mts::isAlive — misma
// convención ya usada en este repo para funciones puras pequeñas cuando el
// archivo origen no las exporta y está fuera de alcance modificar (ver
// agent/machine/isExecutableOnPath.mts, agent/machine/hashFile.mts). No manda
// ninguna señal real — process.kill(pid, 0) solo prueba si el proceso existe.
export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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
  // Fase 1.4 — el worker que tenía este job ya terminó: limpiar su identidad
  // junto con el resto del estado, en la misma escritura (nunca queda a medias).
  j.workerPid = undefined;
  j.workerToken = undefined;
  j.workerStartedAt = undefined;
  j.updatedAt = new Date().toISOString();
  save(jobs);
};

export const markError = (account: string, episodeId: string, error: string): void => {
  const jobs = load();
  const j = findIn(jobs, account, episodeId);
  if (!j) return;
  j.status = "ERROR";
  j.lastError = error;
  j.workerPid = undefined;
  j.workerToken = undefined;
  j.workerStartedAt = undefined;
  j.updatedAt = new Date().toISOString();
  save(jobs);
};

// Fase 1.4 — REDISEÑADA. Antes de los workers-proceso, "PROCESSING al
// arrancar" implicaba necesariamente "la corrida anterior murió a mitad de
// camino" (los workers vivían DENTRO del mismo proceso que se estaba
// reiniciando — si el coordinador no estaba vivo, ningún worker podía estarlo
// tampoco). Esa premisa deja de ser válida: un worker-proceso real puede
// sobrevivir a un coordinador que muere y reinicia (Fase 1.3 §5, casos C/D).
// Reencolar incondicionalmente hoy causaría doble procesamiento real: se
// relanzaría un episodio cuyo worker anterior sigue vivo escribiendo los
// mismos archivos.
//
// Política explícita (fail-closed donde la evidencia no alcanza):
//   - PROCESSING + workerPid VIVO    -> NO reencolar (sigue corriendo)
//   - PROCESSING + workerPid MUERTO  -> reencolar (seguro, ya no hay nadie corriendo)
//   - PROCESSING + workerPid AUSENTE -> NO reencolar. Fail-closed deliberado:
//     sin PID no hay forma de verificar si algo sigue vivo (puede ser un job
//     legacy de antes de esta migración, o la ventana claim->spawn->
//     persistencia de PID interrumpida por un crash exacto en ese instante).
//     Asumir "seguro reencolar" arriesgaría una doble ejecución silenciosa;
//     se prefiere dejarlo visible y exigir revisión explícita.
// El worker/processProject ya reusa las cachés de voz/whisper, así que
// reencolar (cuando SÍ es seguro) no repite trabajo caro innecesariamente.
export type RequeueOutcome = {
  requeued: Job[]; // PROCESSING -> QUEUED (worker confirmado muerto)
  stillAlive: Job[]; // sin tocar — el worker sigue vivo
  needsReview: Job[]; // sin tocar — sin workerPid, fail-closed, requiere revisión manual
};

export const requeueStuckProcessing = (isAlive: (pid: number) => boolean = isProcessAlive): RequeueOutcome => {
  const jobs = load();
  const stuck = jobs.filter((j) => j.status === "PROCESSING");
  const requeued: Job[] = [];
  const stillAlive: Job[] = [];
  const needsReview: Job[] = [];
  let changed = false;

  for (const j of stuck) {
    if (j.workerPid === undefined) {
      needsReview.push(j);
      continue;
    }
    if (isAlive(j.workerPid)) {
      stillAlive.push(j);
      continue;
    }
    j.status = "QUEUED";
    j.workerPid = undefined;
    j.workerToken = undefined;
    j.workerStartedAt = undefined;
    j.updatedAt = new Date().toISOString();
    requeued.push(j);
    changed = true;
  }

  if (changed) save(jobs);
  return { requeued, stillAlive, needsReview };
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
