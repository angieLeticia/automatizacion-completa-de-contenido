// "Día 1" / Fase 1.4 (workers multiproceso) — pruebas reales de la cola de
// producción concurrente (claim por episodio + MAX_WORKERS), reescritas para
// la arquitectura de workers-proceso (Fase 1.4): en vez de inyectar una
// función `process` falsa que se `await`ea in-process (diseño anterior a esta
// fase), ahora se inyecta una `SpawnWorkerFn` falsa que devuelve un
// ChildProcess FALSO (un EventEmitter con `.pid`/`.kill()`/eventos "exit") —
// nunca se lanza ningún proceso Node real, y mucho menos ElevenLabs/whisper/
// render reales. Mismo patrón ad-hoc sin framework ya usado en
// test-authorization-gate.mts.
//
// SEGURIDAD: usa MATERIAL_ROOT apuntando a una carpeta temporal (nunca la
// real D:\MATERIAL VIDEOS) y una cuenta ficticia "TEST_CONCURRENCIA_DIA1" con
// episodios "901".."905" que no existen en producción. state/queue.json Y
// state/projects/ SÍ son las carpetas reales (no hay forma de aislarlas, ver
// test-authorization-gate.mts) - por eso se limpia explícitamente al final
// (modo "cleanup") y nunca se usa un episodeId que pudiera colisionar con uno
// real. Requiere MATERIAL_ROOT seteado en el entorno ANTES de invocar tsx.
import "./env.mts";
import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { MATERIAL_ROOT } from "./config.mts";
import { enqueue, claimNextQueued, attachWorker, requeueStuckProcessing, listJobs, type Job } from "./queue.mts";
import { dispatchWorkers, getActiveWorkerCount, type SpawnWorkerFn } from "./agent.mts";
import { loadProject, saveProject } from "./projectManifest.mts";
import { stateFilePath, readJson, writeJsonAtomic } from "./stateStore.mts";

const ACCOUNT = "TEST_CONCURRENCIA_DIA1";
const EPISODES = ["901", "902", "903", "904", "905"];

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate: () => boolean, timeoutMs: number, pollMs = 15): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(pollMs);
  }
  return predicate();
}

function setupMaterial() {
  if (!/test/i.test(MATERIAL_ROOT) || MATERIAL_ROOT.toLowerCase() === "d:\\material videos") {
    throw new Error(
      `MATERIAL_ROOT no parece una carpeta de prueba ("${MATERIAL_ROOT}") — abortando por seguridad. ` +
        `Seteá MATERIAL_ROOT a una carpeta temporal ANTES de invocar tsx.`
    );
  }
  console.log(`MATERIAL_ROOT de prueba: ${MATERIAL_ROOT}`);
  for (const ep of EPISODES) {
    mkdirSync(path.join(MATERIAL_ROOT, ACCOUNT, ep), { recursive: true });
  }
}

function cleanQueueAndProjects(): void {
  // Se queda SOLO con jobs que no sean de esta cuenta de prueba — nunca toca
  // ningún job real de producción.
  const jobs = readJson<Job[]>(stateFilePath("queue.json"), []);
  writeJsonAtomic(
    stateFilePath("queue.json"),
    jobs.filter((j) => j.account !== ACCOUNT)
  );
  for (const ep of EPISODES) {
    const p = path.join(process.cwd(), "scripts", "pipeline", "state", "projects", `TEST_CONCURRENCIA_DIA1__${ep}.json`);
    if (existsSync(p)) rmSync(p);
  }
}

function enqueueAll(): void {
  for (const ep of EPISODES) enqueue(ACCOUNT, ep);
}

// --- Fake ChildProcess — NUNCA un proceso real. Un EventEmitter con la forma
// mínima que agent.mts::launchWorker()/shutdownWorkers() necesitan: .pid,
// .exitCode/.signalCode, .kill(), y el evento "exit". Simula: terminación
// espontánea tras `delayMs` con `exitCode` (comportamiento normal), o
// terminación inmediata por señal si alguien llama a .kill() antes (shutdown/
// crash simulado). Si `delayMs` es null, el fake NUNCA termina solo — solo
// .kill() lo hace terminar (para simular un worker "colgado").
let fakePidCounter = 900_000;
type FakeChild = ChildProcess & { pid: number; exitCode: number | null; signalCode: NodeJS.Signals | null };

function makeFakeChild(behavior: { delayMs: number | null; exitCode: number }): FakeChild {
  const emitter = new EventEmitter() as unknown as FakeChild;
  emitter.pid = fakePidCounter++;
  emitter.exitCode = null;
  emitter.signalCode = null;

  let timer: ReturnType<typeof setTimeout> | null = null;
  if (behavior.delayMs !== null) {
    timer = setTimeout(() => {
      timer = null;
      emitter.exitCode = behavior.exitCode;
      emitter.emit("exit", behavior.exitCode, null);
    }, behavior.delayMs);
  }

  (emitter as unknown as { kill: () => boolean }).kill = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (emitter.exitCode === null && emitter.signalCode === null) {
      emitter.signalCode = "SIGTERM";
      setTimeout(() => emitter.emit("exit", null, "SIGTERM"), 0);
    }
    return true;
  };

  return emitter;
}

// Fake `spawn` — NUNCA llama a spawn() real ni a processOne.mts real. Registra
// en `inFlight` qué (account,episodeId) está activo en cada instante, para
// poder verificar aislamiento/concurrencia real sin whisper/render.
function makeFakeSpawn(delayMs: number, inFlight: Set<string>, exitCode = 0): SpawnWorkerFn {
  return (account: string, episodeId: string): ChildProcess => {
    const key = `${account}/${episodeId}`;
    inFlight.add(key);
    const child = makeFakeChild({ delayMs, exitCode });
    child.once("exit", () => inFlight.delete(key));
    return child;
  };
}

async function drainAndReset(maxWaitMs = 5000): Promise<void> {
  const drained = await waitUntil(() => getActiveWorkerCount() === 0, maxWaitMs);
  check("(setup) todos los workers de la ronda anterior drenaron", drained);
}

async function testLimit() {
  console.log("\n--- TEST 1: límite de workers (MAX_WORKERS=2, 5 episodios encolados) ---");
  cleanQueueAndProjects();
  enqueueAll();
  const inFlight = new Set<string>();
  const fake = makeFakeSpawn(250, inFlight);

  dispatchWorkers(2, fake);
  await waitUntil(() => getActiveWorkerCount() > 0, 500);
  check("con MAX_WORKERS=2 nunca hay más de 2 workers activos a la vez", getActiveWorkerCount() <= 2, `activos=${getActiveWorkerCount()}`);
  // Muestreo repetido mientras drena: en ningún instante debe superar 2.
  let sawMoreThanTwo = false;
  for (let i = 0; i < 30; i++) {
    if (getActiveWorkerCount() > 2) sawMoreThanTwo = true;
    if (getActiveWorkerCount() === 0 && listJobs().filter((j) => j.account === ACCOUNT && j.status === "QUEUED").length === 0) break;
    await sleep(50);
  }
  check("en NINGÚN muestreo se observaron 3+ workers activos", !sawMoreThanTwo);
  await drainAndReset();

  const jobs = listJobs().filter((j) => j.account === ACCOUNT);
  check("los 5 episodios terminaron COMPLETED", jobs.every((j) => j.status === "COMPLETED"), JSON.stringify(jobs.map((j) => j.status)));
  check("ningún job COMPLETED conserva workerPid/workerToken (se limpian al terminar)", jobs.every((j) => j.workerPid === undefined && j.workerToken === undefined));
}

async function testDifferentEpisodesConcurrently() {
  console.log("\n--- TEST 2: EP001-equivalente y EP002-equivalente procesándose a la vez ---");
  cleanQueueAndProjects();
  enqueueAll();
  const inFlight = new Set<string>();
  const fake = makeFakeSpawn(250, inFlight);

  dispatchWorkers(2, fake);
  const sawTwoDistinct = await waitUntil(() => inFlight.size >= 2, 500);
  check("dos episodios DISTINTOS están 'inFlight' simultáneamente", sawTwoDistinct, `inFlight=${JSON.stringify([...inFlight])}`);
  const distinctEpisodeIds = new Set([...inFlight].map((k) => k.split("/")[1]));
  check("los dos episodios simultáneos tienen episodeId distinto entre sí", distinctEpisodeIds.size === inFlight.size || inFlight.size < 2);

  await drainAndReset();
}

async function testSameEpisodeRace() {
  console.log("\n--- TEST 3: dos 'workers' reclamando el MISMO episodio ---");
  cleanQueueAndProjects();
  enqueue(ACCOUNT, "901");

  const firstClaim = claimNextQueued();
  const secondClaim = claimNextQueued(); // simula un segundo worker llegando justo después

  check("el primer claim SÍ obtiene el job", firstClaim !== null && firstClaim.episodeId === "901");
  check("el segundo claim para el MISMO episodio devuelve null (ya no está QUEUED)", secondClaim === null);

  const jobs = listJobs().filter((j) => j.account === ACCOUNT && j.episodeId === "901");
  check("solo existe UNA fila para ese episodio (sin duplicados)", jobs.length === 1);
  check("esa única fila quedó en PROCESSING (reclamada una sola vez)", jobs[0]?.status === "PROCESSING");

  // Este job queda deliberadamente en PROCESSING sin terminar - la siguiente
  // prueba que llame cleanQueueAndProjects() lo limpia antes de empezar, así
  // que no hace falta liberarlo a mano aquí.
}

async function testReleaseOnCompletion() {
  console.log("\n--- TEST 4: liberación del worker al completar (exit 0) ---");
  cleanQueueAndProjects();
  enqueue(ACCOUNT, "902");
  const inFlight = new Set<string>();
  const fake = makeFakeSpawn(100, inFlight, 0);

  dispatchWorkers(1, fake);
  await waitUntil(() => getActiveWorkerCount() > 0, 300);
  check("worker activo mientras procesa", getActiveWorkerCount() === 1);
  const job = listJobs().find((j) => j.account === ACCOUNT && j.episodeId === "902");
  check("PID/token quedaron persistidos en queue.json tras el spawn", typeof job?.workerPid === "number" && typeof job?.workerToken === "string");

  await drainAndReset();
  check("activeWorkerCount vuelve a 0 tras COMPLETED (exit 0)", getActiveWorkerCount() === 0);

  const after = listJobs().find((j) => j.account === ACCOUNT && j.episodeId === "902");
  check("el job quedó COMPLETED (no PROCESSING colgado)", after?.status === "COMPLETED");
  check("workerPid/workerToken se limpiaron al completar", after?.workerPid === undefined && after?.workerToken === undefined);
}

async function testReleaseOnError() {
  console.log("\n--- TEST 5: liberación del worker cuando termina con exit 1 (ERROR) ---");
  cleanQueueAndProjects();
  enqueue(ACCOUNT, "903");
  const inFlight = new Set<string>();
  const fake = makeFakeSpawn(100, inFlight, 1); // exit 1 = ERROR

  dispatchWorkers(1, fake);
  await waitUntil(() => getActiveWorkerCount() > 0, 300);
  await drainAndReset();
  check("activeWorkerCount vuelve a 0 aunque el episodio haya fallado (exit 1)", getActiveWorkerCount() === 0);

  const job = listJobs().find((j) => j.account === ACCOUNT && j.episodeId === "903");
  check("el job quedó ERROR (nunca retiene el worker permanentemente)", job?.status === "ERROR", job?.lastError);

  const manifest = loadProject(ACCOUNT, "903");
  check("el manifest del proyecto también quedó ERROR", manifest.status === "ERROR");
}

async function testExitCodeThreeIsWaitingForMaterial() {
  console.log("\n--- TEST 6: worker exit 3 -> WAITING_FOR_MATERIAL (nunca se trata como éxito) ---");
  cleanQueueAndProjects();
  enqueue(ACCOUNT, "904");
  const inFlight = new Set<string>();
  const fake = makeFakeSpawn(50, inFlight, 3); // exit 3 = WAITING_FOR_MATERIAL

  dispatchWorkers(1, fake);
  await drainAndReset();

  const job = listJobs().find((j) => j.account === ACCOUNT && j.episodeId === "904");
  check("exit 3 NUNCA se marca COMPLETED en la cola", job?.status !== "COMPLETED", job?.status);
  check("exit 3 se registra como ERROR en la cola (misma política que antes de esta fase)", job?.status === "ERROR");

  const manifest = loadProject(ACCOUNT, "904");
  check("el manifest vuelve a WAITING_FOR_MATERIAL (no queda como si hubiera producido nada)", manifest.status === "WAITING_FOR_MATERIAL");
}

async function testStuckProcessingWithoutWorkerPidIsFailClosed() {
  console.log("\n--- TEST 7: PROCESSING legacy SIN workerPid -> fail-closed (NO se reencola solo, NO se relanza un worker) ---");
  cleanQueueAndProjects();
  enqueue(ACCOUNT, "901");
  const claimed = claimNextQueued(); // reclamado pero NUNCA se le asocia un worker (simula un job legacy/ventana claim->spawn interrumpida)
  check("(precondición) el job quedó PROCESSING sin workerPid", claimed !== null && claimed.workerPid === undefined);

  const outcome = requeueStuckProcessing();
  check("NO aparece en 'requeued' (nunca se asume seguro reencolar sin PID)", !outcome.requeued.some((j) => j.episodeId === "901"));
  check("SÍ aparece en 'needsReview' (fail-closed explícito, visible)", outcome.needsReview.some((j) => j.episodeId === "901"));

  const after = listJobs().find((j) => j.account === ACCOUNT && j.episodeId === "901");
  check("el job sigue PROCESSING tras el intento de recuperación (no se tocó)", after?.status === "PROCESSING");

  // Fase 1.4.1 — comprobación explícita de "no doble procesamiento": mientras
  // el job siga PROCESSING (nunca vuelve a QUEUED sin PID), claimNextQueued()
  // estructuralmente no puede volver a tomarlo (solo mira status==="QUEUED"),
  // así que dispatchWorkers() nunca debería intentar lanzar un segundo worker
  // para este episodio.
  let spawnedAgain = false;
  const guardSpawn: SpawnWorkerFn = (account, episodeId) => {
    if (account === ACCOUNT && episodeId === "901") spawnedAgain = true;
    return makeFakeChild({ delayMs: 10, exitCode: 0 });
  };
  dispatchWorkers(2, guardSpawn);
  await sleep(50);
  check("dispatchWorkers() nunca intentó lanzar un worker para el 901 sin PID (sin doble procesamiento)", !spawnedAgain);

  cleanQueueAndProjects();
}

// Fase 1.4.1 — misma política que TEST 8, pero con un PID REALMENTE muerto
// (proceso Node genuino spawneado y esperado hasta su exit real) y la función
// isProcessAlive() REAL (default de requeueStuckProcessing(), sin inyectar
// ningún isAlive falso) — cierra la brecha de que TEST 8 solo probaba la
// LÓGICA con un isAlive inyectado, nunca contra un PID real del sistema
// operativo.
async function testRealDeadPidIsRequeuedWithRealIsAlive() {
  console.log("\n--- TEST 7.1: PROCESSING con un PID REAL ya muerto (isProcessAlive real, sin inyectar) -> se reencola ---");
  cleanQueueAndProjects();
  enqueue(ACCOUNT, "905");
  const claimed = claimNextQueued();
  check("(precondición) el job 905 quedó PROCESSING", claimed !== null);

  const shortLived = spawn("node", ["-e", "process.exit(0);"], { stdio: "ignore" });
  const exitedPid = shortLived.pid!;
  await new Promise((resolve) => shortLived.once("exit", resolve));
  await sleep(50); // margen para que el SO libere el PID de sus propias tablas internas

  attachWorker(ACCOUNT, "905", { pid: exitedPid, token: "token-905-real", startedAt: new Date().toISOString() });

  const outcome = requeueStuckProcessing(); // SIN isAlive inyectado — usa isProcessAlive real
  check("con la función isProcessAlive REAL, el PID ya muerto SÍ se detecta como muerto", outcome.requeued.some((j) => j.episodeId === "905"));

  const after = listJobs().find((j) => j.account === ACCOUNT && j.episodeId === "905");
  check("el job 905 volvió a QUEUED", after?.status === "QUEUED");

  cleanQueueAndProjects();
}

async function testStuckProcessingWithDeadWorkerPidIsRequeued() {
  console.log("\n--- TEST 8: PROCESSING con workerPid MUERTO -> SÍ se reencola de forma segura ---");
  cleanQueueAndProjects();
  enqueue(ACCOUNT, "902");
  const claimed = claimNextQueued();
  check("(precondición) el job 902 quedó PROCESSING", claimed !== null);
  // PID casi seguramente inexistente en esta máquina — isAlive() inyectado
  // abajo lo confirma explícitamente como "muerto" sin depender de la suerte.
  attachWorker(ACCOUNT, "902", { pid: 999_999, token: "fake-token-902", startedAt: new Date().toISOString() });

  const outcome = requeueStuckProcessing((pid) => pid !== 999_999); // isAlive falso solo para este PID de prueba
  check("SÍ aparece en 'requeued' (worker confirmado muerto)", outcome.requeued.some((j) => j.episodeId === "902"));
  check("NO aparece en 'needsReview' ni en 'stillAlive'", !outcome.needsReview.some((j) => j.episodeId === "902") && !outcome.stillAlive.some((j) => j.episodeId === "902"));

  const after = listJobs().find((j) => j.account === ACCOUNT && j.episodeId === "902");
  check("tras la recuperación, el job vuelve a QUEUED", after?.status === "QUEUED");
  check("workerPid/workerToken se limpiaron al reencolar", after?.workerPid === undefined && after?.workerToken === undefined);

  // Lo drenamos para dejar todo limpio para las pruebas siguientes.
  const inFlight = new Set<string>();
  dispatchWorkers(1, makeFakeSpawn(50, inFlight, 0));
  await drainAndReset();
}

async function testStuckProcessingWithAliveWorkerPidIsNeverTouched() {
  console.log("\n--- TEST 9: PROCESSING con workerPid VIVO -> nunca se reencola ni se relanza otro worker ---");
  cleanQueueAndProjects();
  enqueue(ACCOUNT, "903");
  const claimed = claimNextQueued();
  check("(precondición) el job 903 quedó PROCESSING", claimed !== null);
  attachWorker(ACCOUNT, "903", { pid: process.pid, token: "fake-token-903", startedAt: new Date().toISOString() });

  const outcome = requeueStuckProcessing((pid) => pid === process.pid); // isAlive verdadero solo para nuestro propio PID real
  check("aparece en 'stillAlive' (worker vivo)", outcome.stillAlive.some((j) => j.episodeId === "903"));
  check("NO aparece en 'requeued' ni en 'needsReview'", !outcome.requeued.some((j) => j.episodeId === "903") && !outcome.needsReview.some((j) => j.episodeId === "903"));

  const after = listJobs().find((j) => j.account === ACCOUNT && j.episodeId === "903");
  check("el job sigue PROCESSING (nunca se tocó mientras el worker está vivo)", after?.status === "PROCESSING");

  // dispatchWorkers() NUNCA debería lanzar un segundo worker para este
  // episodio mientras siga PROCESSING (claimNextQueued() solo mira QUEUED).
  let spawnedAgain = false;
  const guardSpawn: SpawnWorkerFn = (account, episodeId) => {
    if (account === ACCOUNT && episodeId === "903") spawnedAgain = true;
    return makeFakeChild({ delayMs: 10, exitCode: 0 });
  };
  dispatchWorkers(2, guardSpawn);
  await sleep(50);
  check("dispatchWorkers() nunca intentó lanzar un segundo worker para el episodio 903", !spawnedAgain);

  cleanQueueAndProjects(); // limpia el 903 dejado a propósito en PROCESSING
}

async function testIsolation() {
  console.log("\n--- TEST 10: aislamiento entre episodios concurrentes ---");
  cleanQueueAndProjects();
  enqueueAll();
  const inFlight = new Set<string>();
  const seenArgs: Array<{ account: string; episodeId: string }> = [];
  const fake: SpawnWorkerFn = (account, episodeId) => {
    seenArgs.push({ account, episodeId });
    const key = `${account}/${episodeId}`;
    inFlight.add(key);
    const child = makeFakeChild({ delayMs: 150, exitCode: 0 });
    child.once("exit", () => inFlight.delete(key));
    return child;
  };

  dispatchWorkers(2, fake);
  await drainAndReset();

  check("se llamó spawn() una vez por cada uno de los 5 episodios, nunca repetido", seenArgs.length === 5);
  const uniqueEpisodeIds = new Set(seenArgs.map((a) => a.episodeId));
  check("los 5 episodeId vistos son todos distintos entre sí (sin mezclar)", uniqueEpisodeIds.size === 5);
  check("todos los argumentos recibidos tienen el account correcto (nunca cruzado)", seenArgs.every((a) => a.account === ACCOUNT));

  for (const ep of EPISODES) {
    const manifest = loadProject(ACCOUNT, ep);
    // Fase 1.4: stages.main.outputPath/stages.clips.count YA NO se rellenan
    // desde el worker-proceso (el exit code es la única señal que cruza la
    // frontera del proceso, sin archivo de resultado ni parseo de stdout) —
    // solo se verifica el status, no esos campos informativos (ver
    // handleWorkerCompleted() en agent.mts).
    check(`manifest de ${ep} quedó COMPLETED`, manifest.stages.main.status === "COMPLETED" && manifest.stages.clips.status === "COMPLETED");
  }
}

async function testMaxWorkersOneCompatibility() {
  console.log("\n--- TEST 11: MAX_WORKERS=1 preserva el comportamiento secuencial ---");
  cleanQueueAndProjects();
  enqueueAll();
  const inFlight = new Set<string>();
  let maxConcurrentObserved = 0;
  const fake: SpawnWorkerFn = (account, episodeId) => {
    const key = `${account}/${episodeId}`;
    inFlight.add(key);
    maxConcurrentObserved = Math.max(maxConcurrentObserved, inFlight.size);
    const child = makeFakeChild({ delayMs: 100, exitCode: 0 });
    child.once("exit", () => inFlight.delete(key));
    return child;
  };

  dispatchWorkers(1, fake);
  await waitUntil(() => getActiveWorkerCount() > 0, 300);
  check("con MAX_WORKERS=1 nunca hay más de 1 worker activo", getActiveWorkerCount() <= 1);
  await drainAndReset(6000);

  check("nunca se observó más de 1 episodio 'inFlight' simultáneo (secuencial real)", maxConcurrentObserved === 1, `max observado=${maxConcurrentObserved}`);
  const jobs = listJobs().filter((j) => j.account === ACCOUNT);
  check("los 5 episodios igual terminan todos COMPLETED con MAX_WORKERS=1", jobs.every((j) => j.status === "COMPLETED"));
}

async function testSpawnFailureLeavesQueueConsistent() {
  console.log("\n--- TEST 12: fallo de spawn() deja la cola en un estado coherente (ERROR, no PROCESSING colgado) ---");
  cleanQueueAndProjects();
  enqueue(ACCOUNT, "905");
  const throwingSpawn: SpawnWorkerFn = () => {
    throw new Error("ENOENT simulado — binario inexistente");
  };

  dispatchWorkers(1, throwingSpawn);
  await waitUntil(() => listJobs().some((j) => j.account === ACCOUNT && j.episodeId === "905" && j.status !== "PROCESSING"), 500);

  const job = listJobs().find((j) => j.account === ACCOUNT && j.episodeId === "905");
  check("el job pasó a ERROR de inmediato (nunca queda PROCESSING sin dueño)", job?.status === "ERROR", job?.lastError);
  check("nunca se le asoció un workerPid (spawn nunca devolvió un proceso real)", job?.workerPid === undefined);
  check("activeWorkerCount nunca contó este worker fallido", getActiveWorkerCount() === 0);
}

async function main() {
  const mode = process.argv[2] ?? "run";

  if (mode === "cleanup") {
    cleanQueueAndProjects();
    rmSync(MATERIAL_ROOT, { recursive: true, force: true });
    console.log("Limpieza de queue.json/manifests/carpeta temporal completada. (no se ejecutó ninguna prueba)");
    process.exit(0);
  }

  if (mode !== "run") {
    console.error(`Modo desconocido: "${mode}". Usar: run | cleanup`);
    process.exit(1);
  }

  setupMaterial();
  await testLimit();
  await testDifferentEpisodesConcurrently();
  await testSameEpisodeRace();
  await testReleaseOnCompletion();
  await testReleaseOnError();
  await testExitCodeThreeIsWaitingForMaterial();
  await testStuckProcessingWithoutWorkerPidIsFailClosed();
  await testRealDeadPidIsRequeuedWithRealIsAlive();
  await testStuckProcessingWithDeadWorkerPidIsRequeued();
  await testStuckProcessingWithAliveWorkerPidIsNeverTouched();
  await testIsolation();
  await testMaxWorkersOneCompatibility();
  await testSpawnFailureLeavesQueueConsistent();

  cleanQueueAndProjects();
  rmSync(MATERIAL_ROOT, { recursive: true, force: true });
  console.log("\n(limpieza final automática: queue.json/manifests de prueba y carpeta temporal eliminados)");

  console.log(`\n=== ${failures === 0 ? "TODO PASS" : `${failures} FALLO(S)`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Error ejecutando las pruebas:", err);
  process.exit(1);
});
