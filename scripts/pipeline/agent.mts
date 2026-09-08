// Punto de entrada del agente de PRODUCCIÓN (independiente de agent/, que es
// el de publicación). Uso: npx tsx scripts/pipeline/agent.mts
import "./env.mts"; // SIEMPRE primero — ver env.mts para por qué el orden importa
import path from "node:path";
import { pathToFileURL } from "node:url";
import chokidar, { type FSWatcher } from "chokidar";
import { ACCOUNTS, MATERIAL_ROOT, EPISODE_FOLDER_RE, OUTPUT_FOLDER_NAMES, FILE_STABILITY_SECONDS, EPISODE_FILTER } from "./config.mts";
import { scanEpisode, listEpisodeFolders, allMaterialFiles } from "./materialScanner.mts";
import type { EpisodeFiles, Completeness } from "./types.mts";
import { checkCompleteness } from "./completenessChecker.mts";
import { loadProject, saveProject, hashSetsEqual, type ProjectManifest } from "./projectManifest.mts";
import { registerFile, recordUsage, hashAll, type MaterialType } from "./fileRegistry.mts";
import { enqueue, nextQueued, markProcessing, markCompleted, markError, requeueStuckProcessing } from "./queue.mts";
import { acquireLock, releaseLock } from "./agentLock.mts";
import { processProject } from "./processOne.mts";
import { log } from "./logger.mts";

const RECONCILE_INTERVAL_MS = Number(process.env.RECONCILE_INTERVAL_MS ?? 10 * 60 * 1000);
const DEBOUNCE_MS = 3000;

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

  const { added } = enqueue(account, episodeId);
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
  if (!(ACCOUNTS as readonly string[]).includes(account)) return null;
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
  if (!(ACCOUNTS as readonly string[]).includes(account)) return true;
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
  for (const account of ACCOUNTS) {
    for (const episodeId of listEpisodeFolders(account)) {
      await evaluateProject(account, episodeId);
    }
  }
}

let workerRunning = false;
async function workerLoop(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  try {
    for (;;) {
      const job = nextQueued();
      if (!job) break;

      log.worker(`empezando ${job.account}/${job.episodeId} (intento ${job.attempts + 1})`);
      markProcessing(job.account, job.episodeId);
      const manifest = loadProject(job.account, job.episodeId);
      manifest.status = "PROCESSING";
      manifest.stages.main.status = "PROCESSING";
      saveProject(manifest);

      try {
        const result = await processProject(job.account, job.episodeId);
        const after = loadProject(job.account, job.episodeId);

        if (result.status === "COMPLETED") {
          const ep = scanEpisode(job.account, job.episodeId);
          const files = allMaterialFiles(ep);
          after.materialHashes = await hashAll(files);
          for (const f of files) {
            const { record } = await registerFile(f, materialTypeFor(ep, f));
            recordUsage(record.hash, job.account, job.episodeId);
          }
          after.status = "COMPLETED";
          after.stages.main = { status: "COMPLETED", outputPath: result.mainOutput, renderedAt: new Date().toISOString() };
          after.stages.clips = { status: "COMPLETED", count: result.clipsExported, renderedAt: new Date().toISOString() };
          saveProject(after);
          markCompleted(job.account, job.episodeId);
          log.worker(`${job.account}/${job.episodeId} COMPLETED (${result.clipsExported}/${result.clipsTotal} clips)`);
        } else if (result.status === "MAIN_QA_FAILED") {
          after.status = "ERROR";
          after.stages.main = { status: "ERROR", error: result.reason };
          after.lastError = result.reason;
          saveProject(after);
          markError(job.account, job.episodeId, result.reason);
          log.error(`${job.account}/${job.episodeId}: QA del video largo falló — ${result.reason}`);
        } else if (result.status === "NOT_AUTHORIZED") {
          // No debería ocurrir en flujo normal (evaluateProject ya filtra esto
          // antes de encolar) — es la segunda capa de defensa de processProject()
          // contra invocaciones directas o autorizaciones revocadas/obsoletas
          // entre el encolado y la ejecución real. Se trata como ERROR (requiere
          // mirar qué pasó) pero SIN tocar materialHashes/stages, para no
          // simular una producción que nunca ocurrió.
          after.status = "ERROR";
          after.lastError = `NOT_AUTHORIZED: ${result.reason}`;
          saveProject(after);
          markError(job.account, job.episodeId, result.reason);
          log.error(`${job.account}/${job.episodeId}: rechazado por el gate de autorización — ${result.reason}`);
        } else {
          // WAITING_FOR_MATERIAL acá sería inesperado (ya se filtró antes de
          // encolar) — se trata como si el material hubiera desaparecido.
          after.status = "WAITING_FOR_MATERIAL";
          saveProject(after);
          markError(job.account, job.episodeId, `estado inesperado al procesar: ${result.reason}`);
          log.error(`${job.account}/${job.episodeId}: inesperadamente WAITING_FOR_MATERIAL durante el proceso (${result.reason})`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        markError(job.account, job.episodeId, message);
        const after = loadProject(job.account, job.episodeId);
        after.status = "ERROR";
        after.lastError = message;
        saveProject(after);
        log.error(`${job.account}/${job.episodeId} falló: ${message}`);
      }
    }
  } finally {
    workerRunning = false;
  }
}

async function recoverStuckJobs(): Promise<void> {
  const stuck = requeueStuckProcessing();
  for (const job of stuck) {
    log.recovery(
      `${job.account}/${job.episodeId} había quedado PROCESSING (corrida anterior murió a mitad de camino) — reencolado. ` +
        `processProject() reusa voz/whisper cacheados, así que no repite esas llamadas.`
    );
  }
}

async function main(): Promise<void> {
  log.agent(`iniciando agente de producción (PID ${process.pid})...`);
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
    workerLoop().catch((err) => log.error(`worker: ${err instanceof Error ? err.message : err}`));
  }, 5000);

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return; // segunda señal mientras ya estamos cerrando: ignorar, no repetir el proceso
    shuttingDown = true;
    log.agent(`señal ${signal} recibida, cerrando...`);
    clearInterval(reconcileTimer);
    clearInterval(workerTimer);
    const closePromise = watcher ? watcher.close() : Promise.resolve();
    closePromise.finally(() => {
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
