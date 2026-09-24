// Punto de entrada del agente de PRODUCCIÓN (independiente de agent/, que es
// el de publicación). Uso: npx tsx scripts/pipeline/agent.mts
import "./env.mts"; // SIEMPRE primero — ver env.mts para por qué el orden importa
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import chokidar, { type FSWatcher } from "chokidar";
import { MATERIAL_ROOT, EPISODE_FOLDER_RE, OUTPUT_FOLDER_NAMES, FILE_STABILITY_SECONDS, EPISODE_FILTER, MAX_WORKERS, resolveAgentTwoScope } from "./config.mts";
import { scanEpisode, listEpisodeFolders, allMaterialFiles } from "./materialScanner.mts";
import type { EpisodeFiles, Completeness } from "./types.mts";
import { checkCompleteness } from "./completenessChecker.mts";
import { loadProject, saveProject, hashSetsEqual, type ProjectManifest } from "./projectManifest.mts";
import { registerFile, recordUsage, hashAll, type MaterialType } from "./fileRegistry.mts";
import {
  enqueue,
  claimNextQueued,
  markCompleted,
  markError,
  requeueStuckProcessing,
  attachWorker,
  type Job,
} from "./queue.mts";
import { acquireLock, releaseLock } from "./agentLock.mts";
import { log } from "./logger.mts";
import { canProduceEpisode } from "./seriesDependency.mts";
import { findSeriesForEpisode } from "./seriesRegistry.mts";

const RECONCILE_INTERVAL_MS = Number(process.env.RECONCILE_INTERVAL_MS ?? 10 * 60 * 1000);
const DEBOUNCE_MS = 3000;

// Fase 5.10-B — resuelto UNA SOLA VEZ en main() (Decision K.4), ANTES de
// startWatcher()/reconcileOnce(). Arranca vacío a propósito: si por algún
// motivo resolveProject()/ignored()/reconcileOnce() se alcanzaran antes de
// que main() lo asigne (no debería ocurrir - ver guard isMainModule), el
// resultado es "ninguna cuenta reconocida" (fail-closed), nunca undefined ni
// un error de referencia.
let scopedAccounts: readonly string[] = [];

const materialTypeFor = (ep: EpisodeFiles, filePath: string): MaterialType => {
  if (filePath === ep.scriptFile) return "script";
  if (filePath === ep.narrationFile) return "narration";
  if (ep.videoFiles.includes(filePath)) return "video";
  if (ep.imageFiles.includes(filePath)) return "image";
  return "sound";
};

// Fase 4.5 — GATE DE AUTORIZACIÓN. Única función que decide si un proyecto
// puede pasar a QUEUED. Deliberadamente pura (sin leer/escribir disco, sin
// llamar enqueue()) para poder probarla de forma aislada y 100% segura (sin
// riesgo de disparar producción real) — ver scripts/pipeline/authorization.mts
// y las pruebas de Fase 4.5.
//
// Regla central: "material completo" (READY) YA NO implica "autorizado". Solo
// AUTHORIZED con un snapshot de hashes que coincide con el material actual
// puede encolarse. COMPLETED nunca se re-encola solo (requiere pasar de nuevo
// por authorizeProject) y ERROR tampoco reintenta solo (requiere acción
// explícita futura, ver nota en workerLoop).
export type EnqueueDecision = { shouldEnqueue: true } | { shouldEnqueue: false; reason: string };

export function decideEnqueue(
  manifest: ProjectManifest,
  completeness: Completeness,
  currentHashes: string[]
): EnqueueDecision {
  if (completeness.status === "WAITING_FOR_MATERIAL") {
    return { shouldEnqueue: false, reason: "WAITING_FOR_MATERIAL" };
  }
  if (manifest.status === "QUEUED" || manifest.status === "PROCESSING") {
    return { shouldEnqueue: false, reason: `ya está ${manifest.status}` };
  }
  if (manifest.status === "HELD") {
    return { shouldEnqueue: false, reason: "HELD — retenido a mano, requiere releaseProject()" };
  }
  if (manifest.status === "COMPLETED") {
    // Nunca se auto-encola, aunque el material haya cambiado — eso solo se
    // nota (ver evaluateProject) y requiere una NUEVA autorización explícita.
    return { shouldEnqueue: false, reason: "COMPLETED — requiere nueva autorización si el material cambió" };
  }
  if (manifest.status === "ERROR") {
    // Sin reintentos automáticos: un ERROR requiere intervención/retry
    // explícito (no implementado en esta fase, ver informe de Fase 4.5).
    return { shouldEnqueue: false, reason: "ERROR — requiere intervención explícita, sin reintento automático" };
  }
  if (manifest.status === "AUTHORIZED") {
    if (!manifest.authorizedMaterialHashes || !hashSetsEqual(manifest.authorizedMaterialHashes, currentHashes)) {
      return { shouldEnqueue: false, reason: "autorización obsoleta — el material cambió después de autorizar" };
    }
    return { shouldEnqueue: true };
  }
  // manifest.status === "WAITING_FOR_MATERIAL" (default) pero completeness ya
  // es READY: material técnicamente listo, pero nunca se autorizó.
  return { shouldEnqueue: false, reason: "READY pero no autorizado (usar pipeline:authorize)" };
}

// Evita repetir el mismo aviso de "READY sin autorizar"/"autorización
// obsoleta" en cada tick de reconciliación (cada 10 min) — se loguea una vez
// por motivo mientras el proceso siga vivo, no en cada evaluación.
const loggedReasons = new Set<string>();
const logReasonOnce = (account: string, episodeId: string, reason: string) => {
  const key = `${account}::${episodeId}::${reason}`;
  if (loggedReasons.has(key)) return;
  loggedReasons.add(key);
  log.agent(`${account}/${episodeId}: sin encolar — ${reason}`);
};

// Evalúa un proyecto (cuenta+episodio): registra/hashea su material,
// determina completitud, y decide si corresponde encolarlo. La misma función
// la usan tanto el watcher (por archivo) como la reconciliación periódica —
// una sola lógica de decisión, no dos.
export async function evaluateProject(account: string, episodeId: string): Promise<void> {
  if (EPISODE_FILTER && !EPISODE_FILTER.includes(episodeId)) return;

  const ep = scanEpisode(account, episodeId);
  const files = allMaterialFiles(ep);

  // Registrar/hashear material es detección pura (fileRegistry), sin costo
  // real ni efecto sobre producción — se hace siempre, autorizado o no.
  for (const f of files) {
    try {
      await registerFile(f, materialTypeFor(ep, f));
    } catch (err) {
      log.error(`no se pudo hashear ${f}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const completeness = checkCompleteness(ep);
  const manifest = loadProject(account, episodeId);

  if (completeness.status === "WAITING_FOR_MATERIAL") {
    if (manifest.status !== "WAITING_FOR_MATERIAL") {
      manifest.status = "WAITING_FOR_MATERIAL";
      saveProject(manifest);
      log.agent(`${account}/${episodeId}: WAITING_FOR_MATERIAL — ${completeness.reason}`);
    }
    return;
  }

  const currentHashes = await hashAll(files);
  const decision = decideEnqueue(manifest, completeness, currentHashes);

  if (!decision.shouldEnqueue) {
    logReasonOnce(account, episodeId, decision.reason);
    return;
  }

  // Fase 2 acelerada — gate de dependencia de serie, ANTES de encolar.
  // decideEnqueue() (pura, Fase 4.5) queda intacta — este chequeo es
  // adicional, insertado acá en la parte impura (evaluateProject), igual que
  // logReasonOnce ya se usaba para no repetir el mismo aviso en cada tick.
  // Un episodio sin serie asociada nunca es afectado (canProduceEpisode
  // devuelve true de inmediato) — comportamiento 100% igual al actual.
  const gate = canProduceEpisode(account, episodeId);
  if (!gate.canProduce) {
    logReasonOnce(account, episodeId, gate.reason);
    return;
  }

  const seriesId = findSeriesForEpisode(account, episodeId)?.seriesId;
  const { added } = enqueue(account, episodeId, seriesId);
  if (added) {
    manifest.status = "QUEUED";
    saveProject(manifest);
    log.queue(`${account}/${episodeId} encolado (autorizado ${manifest.authorizedAt ?? "?"}, hash coincide)`);
    void workerLoop(); // dispara el worker ya, no esperar al tick periódico
  }
}

// ---- Debounce: varios eventos del mismo proyecto en una ráfaga colapsan en
// una sola evaluación, en vez de encolar/evaluar N veces. ----
const pendingEvaluations = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleEvaluate(account: string, episodeId: string): void {
  const key = `${account}::${episodeId}`;
  const existing = pendingEvaluations.get(key);
  if (existing) clearTimeout(existing);
  pendingEvaluations.set(
    key,
    setTimeout(() => {
      pendingEvaluations.delete(key);
      evaluateProject(account, episodeId).catch((err) =>
        log.error(`evaluando ${key}: ${err instanceof Error ? err.message : err}`)
      );
    }, DEBOUNCE_MS)
  );
}

function resolveProject(filePath: string): { account: string; episodeId: string } | null {
  const rel = path.relative(MATERIAL_ROOT, filePath);
  const parts = rel.split(path.sep);
  const [account, episodeId] = parts;
  if (!account || !episodeId) return null;
  if (!scopedAccounts.includes(account)) return null;
  if (!EPISODE_FOLDER_RE.test(episodeId)) return null;
  return { account, episodeId };
}

// true = ignorar. Cuentas no habilitadas, carpetas de salida, y cualquier
// carpeta de cuenta que no sea puramente numérica (00_Intro, 00_Logos, etc.).
function ignored(filePath: string): boolean {
  const rel = path.relative(MATERIAL_ROOT, filePath);
  if (!rel || rel === ".") return false;
  const parts = rel.split(path.sep);
  const account = parts[0];
  if (!account) return false;
  if (!scopedAccounts.includes(account)) return true;
  if (parts.length === 1) return false;
  const second = parts[1];
  if (OUTPUT_FOLDER_NAMES.includes(second)) return true;
  if (!EPISODE_FOLDER_RE.test(second)) return true;
  return false;
}

let watcher: FSWatcher | null = null;

function startWatcher(): void {
  watcher = chokidar.watch(MATERIAL_ROOT, {
    depth: 4, // Cuenta/Episodio/Subcarpeta/archivo (o Cuenta/Episodio/Guion.md)
    ignoreInitial: false, // el escaneo inicial de chokidar cubre el "escaneo al arrancar"
    ignored,
    awaitWriteFinish: { stabilityThreshold: FILE_STABILITY_SECONDS * 1000, pollInterval: 1000 },
    ignorePermissionErrors: true,
  });

  const onFile = (filePath: string) => {
    const proj = resolveProject(filePath);
    if (!proj) return;
    log.watcher(`archivo estable: ${filePath}`);
    scheduleEvaluate(proj.account, proj.episodeId);
  };

  watcher.on("add", onFile);
  watcher.on("change", onFile);
  watcher.on("error", (err) => log.error(`watcher: ${err instanceof Error ? err.message : err}`));
  watcher.on("ready", () => log.watcher("escaneo inicial completo — vigilancia continua activa"));
}

async function reconcileOnce(): Promise<void> {
  log.agent("reconciliación periódica...");
  for (const account of scopedAccounts) {
    for (const episodeId of listEpisodeFolders(account)) {
      await evaluateProject(account, episodeId);
    }
  }
}

// ============================================================================
// Fase 1.4 (Agente 2 multiproceso) — cada job encolado se procesa en un
// PROCESO NODE INDEPENDIENTE (worker), no como una promesa dentro de este
// mismo proceso: así Whisper/ffmpeg/Remotion (todos bloqueantes vía
// execFileSync/spawnSync dentro de processProject(), ver auditoría Fase 1.2)
// pueden correr en paralelo real a nivel de sistema operativo, sin tocar
// ninguno de esos módulos. El coordinador sigue siendo el ÚNICO que decide
// qué se procesa (claim, vía claimNextQueued() — sin cambios de Día 1),
// cuánto en paralelo (MAX_WORKERS) y el ÚNICO que escribe queue.json — el
// worker (processOne.mts) nunca importa queue.mts.
// ============================================================================

export type SpawnWorkerFn = (account: string, episodeId: string) => ChildProcess;

const PROCESS_ONE_ENTRY = path.join(import.meta.dirname, "processOne.mts");
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

// "node --import tsx/esm" en vez de "npx tsx": evita por completo la capa
// .cmd/shell:true que Windows exige para "npx" (ver el comentario de
// scripts/pipeline/renderer.mts sobre exactamente este mismo problema) — acá
// no hace falta ningún quoteArg manual porque spawn() SIN shell:true pasa
// cada elemento del array como argv literal, sin que ningún shell lo
// reinterprete (account puede tener espacios, ej. "SIN EXPLICACIÓN").
const spawnRealWorker: SpawnWorkerFn = (account, episodeId) =>
  spawn("node", ["--import", "tsx/esm", PROCESS_ONE_ENTRY, account, episodeId], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });

// Registro EN MEMORIA de workers activos de ESTA instancia del coordinador —
// NO sustituye lo persistido en queue.json (workerPid/workerToken/
// workerStartedAt, ver queue.mts): es un complemento para poder escuchar
// exit/error sin releer disco, y (shutdown) saber a qué ChildProcess reales
// pedirles que terminen. queue.json sigue siendo la fuente persistente.
type ActiveWorker = { child: ChildProcess; account: string; episodeId: string; token: string; startedAt: string };
const activeWorkers = new Map<string, ActiveWorker>();
const workerKey = (account: string, episodeId: string): string => `${account}::${episodeId}`;

export function getActiveWorkerCount(): number {
  return activeWorkers.size;
}
export function listActiveWorkers(): ActiveWorker[] {
  return [...activeWorkers.values()];
}

// Clasificación PURA del resultado de un worker — nunca parsea stdout/stderr,
// solo el exit code (y la señal, si el proceso terminó por una) que Node ya
// entrega en el evento "exit". Contrato exacto acordado con
// processOne.mts::resultToExitCode(): 0=COMPLETED, 3=WAITING_FOR_MATERIAL,
// cualquier otro código = ERROR. Un worker terminado por señal (matado) NUNCA
// se interpreta como éxito, sin importar qué código hubiera devuelto.
export type WorkerOutcome = "COMPLETED" | "WAITING_FOR_MATERIAL" | "ERROR";

export function classifyExitCode(code: number | null, signal: NodeJS.Signals | null): WorkerOutcome {
  if (signal) return "ERROR";
  if (code === 0) return "COMPLETED";
  if (code === 3) return "WAITING_FOR_MATERIAL";
  return "ERROR";
}

// Post-proceso tras COMPLETED — misma lógica exacta que runJob() tenía
// in-process antes de esta fase (materialHashes/registerFile/recordUsage/
// stages/markCompleted). Único cambio real: `stages.main`/`stages.clips` ya
// no llevan `outputPath`/`count` (campos opcionales en ProjectManifest, sin
// ningún control de flujo que dependa de ellos) — el worker es ahora un
// proceso separado que solo comunica su resultado por exit code (regla
// explícita de esta fase: sin archivo de resultado, sin parseo de stdout), así
// que esos dos campos informativos ya no cruzan la frontera del proceso.
// Pérdida de información puramente cosmética, documentada en el informe final.
async function handleWorkerCompleted(account: string, episodeId: string): Promise<void> {
  const after = loadProject(account, episodeId);
  const ep = scanEpisode(account, episodeId);
  const files = allMaterialFiles(ep);
  after.materialHashes = await hashAll(files);
  for (const f of files) {
    const { record } = await registerFile(f, materialTypeFor(ep, f));
    recordUsage(record.hash, account, episodeId);
  }
  const now = new Date().toISOString();
  after.status = "COMPLETED";
  after.stages.main = { status: "COMPLETED", renderedAt: now };
  after.stages.clips = { status: "COMPLETED", renderedAt: now };
  saveProject(after);
  markCompleted(account, episodeId);
  log.worker(`${account}/${episodeId} COMPLETED (worker exit 0)`);
}

// Mismo comportamiento que la rama "else" del runJob() anterior a esta fase
// para WAITING_FOR_MATERIAL (ya se documentaba como "no debería ocurrir en
// flujo normal" — evaluateProject() ya filtra esto antes de encolar; esta
// sigue siendo la segunda capa de defensa): el manifest vuelve a
// WAITING_FOR_MATERIAL y la cola se marca ERROR (nunca se reintenta sola). El
// texto exacto del motivo (antes `result.reason`) ya no está disponible — el
// worker solo comunica el exit code — se documenta como pérdida de
// información aceptada, no un bug.
async function handleWorkerWaitingForMaterial(account: string, episodeId: string): Promise<void> {
  const after = loadProject(account, episodeId);
  after.status = "WAITING_FOR_MATERIAL";
  saveProject(after);
  markError(account, episodeId, "estado inesperado al procesar: WAITING_FOR_MATERIAL (worker exit 3)");
  log.error(`${account}/${episodeId}: inesperadamente WAITING_FOR_MATERIAL durante el proceso (worker exit 3)`);
}

async function handleWorkerError(account: string, episodeId: string, detail: string): Promise<void> {
  const after = loadProject(account, episodeId);
  after.status = "ERROR";
  after.lastError = detail;
  saveProject(after);
  markError(account, episodeId, detail);
  log.error(`${account}/${episodeId} falló: ${detail}`);
}

async function onWorkerSettled(job: Job, outcome: WorkerOutcome, detail: string): Promise<void> {
  if (outcome === "COMPLETED") await handleWorkerCompleted(job.account, job.episodeId);
  else if (outcome === "WAITING_FOR_MATERIAL") await handleWorkerWaitingForMaterial(job.account, job.episodeId);
  else await handleWorkerError(job.account, job.episodeId, detail);
}

// Lanza un worker-proceso para un job YA reclamado (claimNextQueued() ya lo
// puso en PROCESSING). Ventana claim->spawn->persistencia de PID (Fase 1.4):
// si spawn() lanza sincrónicamente (ej. el binario "node" no existe), se
// captura acá mismo y el job pasa a ERROR de inmediato — nunca queda
// PROCESSING sin dueño dentro de esta misma corrida. Si el coordinador
// muriera ENTRE claimNextQueued() y attachWorker(), el job queda PROCESSING
// SIN workerPid — requeueStuckProcessing() (queue.mts) ya trata ese caso como
// "needsReview" (fail-closed), nunca como "seguro reencolar".
function launchWorker(job: Job, spawnFn: SpawnWorkerFn, maxWorkers: number): void {
  const key = workerKey(job.account, job.episodeId);
  let child: ChildProcess;
  try {
    child = spawnFn(job.account, job.episodeId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`no se pudo lanzar worker para ${key}: ${message}`);
    void handleWorkerError(job.account, job.episodeId, `spawn falló: ${message}`);
    return;
  }

  if (!child.pid) {
    // spawn() no lanzó pero tampoco entregó PID — Node lo documenta como
    // posible en fallos silenciosos de spawn. Nunca se inventa un worker vivo
    // sin PID real: se trata igual que un spawn fallido.
    log.error(`worker para ${key}: spawn no devolvió PID`);
    void handleWorkerError(job.account, job.episodeId, "spawn no devolvió PID");
    return;
  }

  const token = randomUUID();
  const startedAt = new Date().toISOString();
  attachWorker(job.account, job.episodeId, { pid: child.pid, token, startedAt });
  activeWorkers.set(key, { child, account: job.account, episodeId: job.episodeId, token, startedAt });
  log.worker(`worker lanzado ${key} (pid ${child.pid}, intento ${job.attempts})`);

  // "exit" y "error" pueden dispararse ambos para el mismo child en algunos
  // escenarios (Node no garantiza mutua exclusión) — el guard `settled` evita
  // procesar el mismo desenlace dos veces (doble post-proceso/doble dispatch).
  let settled = false;
  const finish = (outcome: WorkerOutcome, detail: string) => {
    if (settled) return;
    settled = true;
    activeWorkers.delete(key);
    onWorkerSettled(job, outcome, detail)
      .catch((err) => log.error(`post-proceso de ${key} falló: ${err instanceof Error ? err.message : err}`))
      // `maxWorkers` es el que ESTA cadena de dispatch venía usando (capturado
      // por closure), nunca el default global MAX_WORKERS — si se llamara acá
      // dispatchWorkers(undefined, spawnFn), el parámetro por defecto de
      // dispatchWorkers() lo reemplazaría silenciosamente por MAX_WORKERS
      // (bug real detectado por test-concurrent-workers.mts::testMaxWorkersOneCompatibility:
      // con maxWorkers=1 explícito, un re-dispatch sin este fix subía a 2).
      .finally(() => dispatchWorkers(maxWorkers, spawnFn));
  };

  child.once("exit", (code, signal) => {
    finish(classifyExitCode(code, signal), signal ? `worker terminado por señal ${signal}` : `worker exit ${code}`);
  });
  child.once("error", (err) => {
    finish("ERROR", `worker error: ${err.message}`);
  });
}

// Lanza tantos workers-proceso nuevos como haga falta para llegar a
// `maxWorkers` (sin pasarse) — mismo principio que la Fase Día 1: dentro de
// una misma vuelta de este bucle no hay ningún `await`, así que dos
// invocaciones jamás pueden sobre-lanzar (Node es single-threaded). Exportada
// con parámetros inyectables para que los tests puedan usar una `spawnFn`
// falsa (nunca un proceso real de whisper/render).
export function dispatchWorkers(maxWorkers: number = MAX_WORKERS, spawnFn: SpawnWorkerFn = spawnRealWorker): void {
  while (activeWorkers.size < maxWorkers) {
    const job = claimNextQueued();
    if (!job) break;
    launchWorker(job, spawnFn, maxWorkers);
  }
}

async function workerLoop(): Promise<void> {
  dispatchWorkers();
}

// Ya no es "una vez al arrancar y listo": además de la llamada inicial (ver
// main()), se re-invoca periódicamente (workerTimer) para reconciliar workers
// HUÉRFANOS de una instancia anterior de este mismo coordinador (Fase 1.3 §5
// casos C/D/E — un worker puede sobrevivir a un coordinador que muere y
// reinicia; cuando ese worker huérfano finalmente termina, nadie más que este
// chequeo periódico puede enterarse, porque el coordinador nuevo nunca tuvo
// su ChildProcess en memoria). Los jobs que YA están en `activeWorkers`
// (workers de ESTA instancia, genuinamente en curso) se excluyen del log de
// "huérfano" — su PID está vivo porque los gestionamos nosotros mismos, no
// porque pertenezcan a otra instancia.
async function recoverStuckJobs(): Promise<void> {
  const { requeued, stillAlive, needsReview } = requeueStuckProcessing();

  for (const job of requeued) {
    log.recovery(
      `${job.account}/${job.episodeId} había quedado PROCESSING con worker (pid ${job.workerPid}) ya no vivo — reencolado. ` +
        `processProject() reusa voz/whisper cacheados, así que no repite esas llamadas.`
    );
  }
  for (const job of stillAlive) {
    if (activeWorkers.has(workerKey(job.account, job.episodeId))) continue; // nuestro, en curso normal — no es huérfano
    log.recovery(
      `${job.account}/${job.episodeId}: worker (pid ${job.workerPid}) de una instancia anterior del coordinador SIGUE VIVO — ` +
        `sin tocar, se espera a que termine por su cuenta (no se reencola, no se lanza un segundo worker).`
    );
  }
  for (const job of needsReview) {
    log.recovery(
      `${job.account}/${job.episodeId}: PROCESSING sin workerPid registrado — fail-closed, NO se reencola automáticamente ` +
        `(puede ser un job legacy de antes de esta migración, o la ventana claim->spawn interrumpida por un crash exacto ` +
        `en ese instante). Requiere revisión manual.`
    );
  }
}

// ---- Shutdown (Fase 1.4) ----------------------------------------------------

// Timeout de apagado. Documentado explícitamente (se buscó primero si existía
// algún valor de referencia ya configurado en el proyecto para esto — no se
// encontró ninguno; NO es el mismo concepto que RUN_LOCK_STALE_MINUTES de
// agent/publish/runLock.mts, que detecta un LOCK huérfano de un proceso que
// ya no existe, con un umbral de 10 minutos). Acá el timeout NO es una espera
// de cierre ordenado — en Windows, child.kill() de un proceso Node no entrega
// una señal cooperativa real que el worker pueda "tardar en procesar" (ver
// auditoría Fase 1.3 §4/§8) — es solo una ventana breve de confirmación antes
// de forzar la limpieza del árbol completo de procesos (taskkill /T /F),
// necesaria porque un whisper/ffmpeg/remotion lanzado como nieto
// (execFileSync/spawnSync dentro del worker) puede sobrevivir a la
// terminación del proceso worker directo. Se elige un valor corto (5s) acorde
// a ese propósito de confirmación, no de espera de trabajo real.
export const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 5_000);

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

export type KillWorkerFn = (pid: number) => void;

// taskkill /T (árbol completo) /F (forzado) — comando NATIVO de Windows, sin
// ninguna dependencia npm nueva. Necesario porque child.kill() de Node NO
// garantiza matar a los procesos NIETO (whisper/ffmpeg/remotion) que el
// worker lanzó de forma síncrona — ver Fase 1.3 §4/§8. Nunca se invoca WMIC
// ni PowerShell, ni se inspecciona la línea de comandos de ningún proceso.
const killWorkerTree: KillWorkerFn = (pid) => {
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    // best-effort — si el proceso ya había terminado entre medio, taskkill
    // falla con un código de error que no hace falta propagar acá.
  }
};

// Identidad verificada por construcción: `workers` viene EXCLUSIVAMENTE de
// `activeWorkers`, respaldado por el ChildProcess real que ESTE mismo proceso
// creó vía spawnFn() — nunca se actúa sobre un PID ajeno ni sobre un worker
// huérfano de una instancia anterior (esos, por diseño, jamás entran a
// `activeWorkers` de la instancia nueva — ver recoverStuckJobs()). Tras el
// timeout de confirmación, SIEMPRE se escala a taskkill /T /F (no solo si el
// proceso directo "sigue vivo"): child.kill() puede terminar el proceso
// directo sin matar a sus nietos (whisper/ffmpeg/remotion), así que el chequeo
// de "¿sigue vivo el PID directo?" no alcanza para saber si hace falta la
// limpieza del árbol — decisión explícita, más estricta que la lectura
// literal mínima, justificada por la evidencia ya reunida en Fase 1.3.
export async function shutdownWorkers(
  timeoutMs: number = SHUTDOWN_TIMEOUT_MS,
  killTree: KillWorkerFn = killWorkerTree
): Promise<void> {
  const workers = listActiveWorkers();
  if (workers.length === 0) return;

  for (const w of workers) {
    log.agent(`shutdown: solicitando terminación a worker ${w.account}/${w.episodeId} (pid ${w.child.pid})`);
    w.child.kill();
  }

  await Promise.all(
    workers.map(async (w) => {
      const exitedInTime = await waitForExit(w.child, timeoutMs);
      if (!w.child.pid) return;
      log.agent(
        `shutdown: forzando limpieza del árbol de procesos de ${w.account}/${w.episodeId} (pid ${w.child.pid}) — ` +
          `${exitedInTime ? "el proceso directo ya había terminado (puede haber dejado nietos vivos)" : "seguía vivo tras el timeout"}`
      );
      killTree(w.child.pid);
    })
  );
}

// ============================================================================

async function main(): Promise<void> {
  log.agent(`iniciando agente de producción (PID ${process.pid})...`);

  // Fase 5.10-B — RUN_SCOPE obligatorio, resuelto UNA SOLA VEZ aquí, ANTES
  // de tomar el lock/arrancar el watcher (Decision K.4). Un RUN_SCOPE
  // ausente/inválido, o un TEST con MATERIAL_ROOT peligroso, detiene el
  // proceso aquí, nunca llega a leer D:\MATERIAL VIDEOS.
  const scope = resolveAgentTwoScope();
  scopedAccounts = scope.accounts;
  log.agent(`[RUN_SCOPE] ${scope.runScope} — ${scope.accounts.length} cuenta(s) permitida(s): ${scope.accounts.join(", ") || "(ninguna)"}`);

  // Mismo invariante defensivo que agent/run.mts::main(): scope.materialRoot
  // y el MATERIAL_ROOT importado de config.mts derivan del MISMO
  // process.env.MATERIAL_ROOT (inmutable durante la vida del proceso) -
  // deben coincidir siempre que resolveAgentTwoScope() no haya lanzado.
  if (scope.materialRoot !== MATERIAL_ROOT) {
    throw new Error(
      `Inconsistencia interna: MATERIAL_ROOT resuelto por RUN_SCOPE ('${scope.materialRoot}') no coincide con el de config.mts ('${MATERIAL_ROOT}'). Proceso detenido.`
    );
  }

  const lock = acquireLock();
  if (!lock.acquired) {
    log.agent(`ya hay una instancia activa (PID ${lock.heldBy.pid}, desde ${lock.heldBy.startedAt}) — saliendo.`);
    process.exit(1);
  }
  log.agent("lock adquirido.");

  await recoverStuckJobs();

  startWatcher();
  await reconcileOnce();
  await workerLoop(); // por si ya había trabajos en cola de una corrida anterior

  const reconcileTimer = setInterval(() => {
    reconcileOnce().catch((err) => log.error(`reconciliación: ${err instanceof Error ? err.message : err}`));
  }, RECONCILE_INTERVAL_MS);

  const workerTimer = setInterval(() => {
    recoverStuckJobs()
      .then(() => workerLoop())
      .catch((err) => log.error(`worker: ${err instanceof Error ? err.message : err}`));
  }, 5000);

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return; // segunda señal mientras ya estamos cerrando: ignorar, no repetir el proceso
    shuttingDown = true;
    log.agent(`señal ${signal} recibida, cerrando...`);
    clearInterval(reconcileTimer);
    clearInterval(workerTimer);
    const closePromise = watcher ? watcher.close() : Promise.resolve();
    closePromise
      .then(() => shutdownWorkers())
      .catch((err) => log.error(`shutdown de workers: ${err instanceof Error ? err.message : err}`))
      .finally(() => {
        releaseLock();
        log.agent("lock liberado. Adiós.");
        process.exit(0);
      });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  log.agent(`agente en línea (reconciliación cada ${RECONCILE_INTERVAL_MS / 60000} min) — esperando material nuevo...`);
}

// Guard igual al de processOne.mts/authorization.mts: permite importar
// decideEnqueue/evaluateProject desde un script de pruebas sin disparar
// main() (que intentaría tomar el lock real y podría matar el proceso que
// está corriendo las pruebas).
const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    log.error(`fallo fatal del agente: ${err instanceof Error ? (err.stack ?? err.message) : err}`);
    releaseLock();
    process.exit(1);
  });
}
