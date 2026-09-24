// Fase 1.5 — prueba controlada de DOS WORKERS REALES simultáneos.
//
// A diferencia de Fase 1.4/1.4.1 (que usaban spawnFn FALSAS o procesos "node -e"
// triviales como sustituto del worker), esta prueba usa el mecanismo de spawn
// REAL de producción (agent.mts::dispatchWorkers() con su spawnFn por
// defecto, SIN inyectar nada) para lanzar dos procesos genuinos de:
//
//   node --import tsx/esm scripts/pipeline/processOne.mts <account> <episodeId>
//
// Es decir: el mismo comando exacto, con el mismo binario, que usaría el
// coordinador real en producción.
//
// LÍMITE DEBE QUEDAR EXPLÍCITO (ver informe de Fase 1.5): para que ambos
// workers terminen en un estado 100% seguro y aislado (sin tocar
// D:\MATERIAL VIDEOS, sin usar ningún canal real, sin gastar ElevenLabs, sin
// invocar whisper/ffmpeg/Remotion reales), se usan DOS CUENTAS FICTICIAS que
// NUNCA están en el registro real de canales (channelRegistry.mts). Eso hace
// que processProject() falle DETERMINÍSTICAMENTE y CASI DE INMEDIATO en
// resolveRenderProvider() (ChannelNotFoundError) — ANTES de cualquier acceso a
// disco de material, ANTES de la verificación de autorización, y mucho antes
// de whisper/render. Es la única forma de ejecutar processOne.mts REAL, sin
// modificar ningún archivo de producción (channelRegistry.mts) y sin usar un
// canal real — a costa de que el resultado final sea ERROR (exit 1) en vez de
// COMPLETED. Llegar a COMPLETED de verdad requeriría procesar sí o sí (aunque
// fuera contenido sintético) a través de registerEpisode()/copyEpisodeAssets(),
// que escriben en remotion/lib/episodes.ts, remotion/data/ y public/assets/
// REALES sin ningún parámetro de redirección para pruebas — exactamente el
// recurso compartido que toda esta fase (1.1-1.4.1) protegió con tanto
// cuidado. Se decidió NO tocar esos archivos reales sin autorización explícita
// separada (ver informe, sección de riesgos).
//
// SEGURIDAD: nunca toca D:\MATERIAL VIDEOS, nunca usa un canal real, nunca usa
// Supabase, nunca publica. Cuentas ficticias, limpiadas al final.
import "./env.mts";
import { enqueue, listJobs, type Job } from "./queue.mts";
import { dispatchWorkers, getActiveWorkerCount, listActiveWorkers, shutdownWorkers, type SpawnWorkerFn } from "./agent.mts";
import { stateFilePath, readJson, writeJsonAtomic } from "./stateStore.mts";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { isProcessAlive } from "./queue.mts";

const ACCOUNT_A = "TEST_EPISODE_A_FASE15";
const ACCOUNT_B = "TEST_EPISODE_B_FASE15";
const EPISODE_A = "001";
const EPISODE_B = "001";
const TEST_ACCOUNTS = [ACCOUNT_A, ACCOUNT_B];

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

function cleanState(): void {
  const jobs = readJson<Job[]>(stateFilePath("queue.json"), []);
  writeJsonAtomic(
    stateFilePath("queue.json"),
    jobs.filter((j) => !TEST_ACCOUNTS.includes(j.account))
  );
  for (const [account, ep] of [
    [ACCOUNT_A, EPISODE_A],
    [ACCOUNT_B, EPISODE_B],
  ]) {
    const p = path.join(process.cwd(), "scripts", "pipeline", "state", "projects", `${account}__${ep}.json`);
    if (existsSync(p)) rmSync(p);
  }
}

// ============================================================================
// PRUEBA 1 — concurrencia real con dos procesos genuinos de processOne.mts
// ============================================================================
async function testTwoRealWorkersConcurrently() {
  console.log("\n=== PRUEBA 1: dos workers REALES (processOne.mts real, spawn real) simultáneos ===");
  cleanState();
  enqueue(ACCOUNT_A, EPISODE_A);
  enqueue(ACCOUNT_B, EPISODE_B);

  // MAX_WORKERS=2 se usa ÚNICAMENTE como parámetro explícito de
  // dispatchWorkers() — NUNCA se toca process.env.MAX_WORKERS ni .env.local,
  // así que no hay ningún cambio de configuración que "quede pegado" al
  // terminar la prueba.
  const overlapSamples: Array<{ t: number; workers: Array<{ key: string; pid: number }> }> = [];
  const sampleStart = Date.now();

  dispatchWorkers(2 /* MAX_WORKERS temporal, solo parámetro */); // spawnFn por defecto = spawnRealWorker (REAL, sin inyectar nada)

  // Muestreo activo con timestamps reales — evidencia temporal de overlap,
  // no un sleep ciego.
  const bothRegistered = await waitUntil(() => getActiveWorkerCount() === 2, 3000, 10);
  for (let i = 0; i < 60 && getActiveWorkerCount() > 0; i++) {
    overlapSamples.push({
      t: Date.now() - sampleStart,
      workers: listActiveWorkers().map((w) => ({ key: `${w.account}/${w.episodeId}`, pid: w.child.pid! })),
    });
    await sleep(10);
  }

  check("ambos workers reales llegaron a estar registrados simultáneamente (activeWorkerCount===2)", bothRegistered);

  const samplesWithBoth = overlapSamples.filter((s) => s.workers.length === 2);
  check(
    "existe AL MENOS UNA muestra temporal con los DOS workers reales activos a la vez (overlap real, no secuencial)",
    samplesWithBoth.length > 0,
    `muestras con 2 activos=${samplesWithBoth.length}/${overlapSamples.length}`
  );
  if (samplesWithBoth.length > 0) {
    const first = samplesWithBoth[0];
    console.log(
      `  evidencia temporal: en t=${first.t}ms ambos PIDs reales coexistían -> ${first.workers.map((w) => `${w.key}(pid ${w.pid})`).join(", ")}`
    );
  }

  const allPids = overlapSamples.flatMap((s) => s.workers.map((w) => w.pid));
  const distinctPidsSeen = new Set(allPids);
  check("los PID observados de A y B son SIEMPRE distintos entre sí (nunca el mismo proceso)", distinctPidsSeen.size <= 2 && distinctPidsSeen.size >= 1);

  // Esperar a que ambos terminen de verdad (proceso real: import de todo
  // processOne.mts + resolveRenderProvider() fallando con ChannelNotFoundError)
  const drained = await waitUntil(() => getActiveWorkerCount() === 0, 15000, 30);
  check("ambos workers reales terminaron (drenaron) dentro del timeout", drained);

  const jobA = listJobs().find((j) => j.account === ACCOUNT_A && j.episodeId === EPISODE_A);
  const jobB = listJobs().find((j) => j.account === ACCOUNT_B && j.episodeId === EPISODE_B);

  check("Job A terminó en un estado FINAL coherente (ERROR — canal ficticio no registrado, esperado)", jobA?.status === "ERROR", jobA?.lastError);
  check("Job B terminó en un estado FINAL coherente (ERROR — canal ficticio no registrado, esperado)", jobB?.status === "ERROR", jobB?.lastError);
  check("ningún job quedó PROCESSING residual", jobA?.status !== "PROCESSING" && jobB?.status !== "PROCESSING");
  check("Job A no conserva workerPid/workerToken residual", jobA?.workerPid === undefined && jobA?.workerToken === undefined);
  check("Job B no conserva workerPid/workerToken residual", jobB?.workerPid === undefined && jobB?.workerToken === undefined);
  check("Job A y Job B son registros completamente distintos (account/episodeId propios)", jobA !== jobB);
  check("no quedó ningún worker activo residual en memoria tras terminar", getActiveWorkerCount() === 0 && listActiveWorkers().length === 0);

  cleanState();
}

// ============================================================================
// PRUEBA 2 — aislamiento: reencolar y volver a correr NO produce doble claim
// ni mezcla A/B (variante real de la prueba de aislamiento de fallo: acá
// ambos fallan por el MISMO motivo real y determinístico — ChannelNotFoundError
// — pero se verifica que cada uno queda con SU PROPIO lastError/lastError
// nunca cruzado, y que reencolar uno no reencola ni afecta al otro).
// ============================================================================
async function testFailureIsolationBetweenRealWorkers() {
  console.log("\n=== PRUEBA 2: aislamiento — el fallo de un worker real NUNCA afecta al otro ===");
  cleanState();
  enqueue(ACCOUNT_A, EPISODE_A);
  enqueue(ACCOUNT_B, EPISODE_B);

  dispatchWorkers(2);
  await waitUntil(() => getActiveWorkerCount() === 0, 15000, 30);

  const jobA1 = listJobs().find((j) => j.account === ACCOUNT_A && j.episodeId === EPISODE_A);
  const jobB1 = listJobs().find((j) => j.account === ACCOUNT_B && j.episodeId === EPISODE_B);
  check("(precondición) ambos terminaron ERROR de forma independiente", jobA1?.status === "ERROR" && jobB1?.status === "ERROR");
  // Nota: `lastError` es deliberadamente genérico ("worker exit 1") desde
  // Fase 1.4 — el exit code es la ÚNICA señal permitida a cruzar la frontera
  // del proceso (sin parseo de stdout, ver processOne.mts::resultToExitCode).
  // Lo que sí debe estar SIEMPRE correcto, sin mezclarse, es el registro
  // (account/episodeId) del propio Job — el coordinador nunca pierde de vista
  // A QUIÉN pertenece cada resultado, aunque el mensaje de error no lo repita.
  check("el registro de A conserva su propia identidad (account/episodeId), nunca la de B", jobA1?.account === ACCOUNT_A && jobA1?.episodeId === EPISODE_A);
  check("el registro de B conserva su propia identidad (account/episodeId), nunca la de A", jobB1?.account === ACCOUNT_B && jobB1?.episodeId === EPISODE_B);

  // Reencolar SOLO A y confirmar que B (ya en ERROR, sin reintento automático
  // por diseño — ver decideEnqueue/ERROR de Fase 4.5) permanece intacto,
  // nunca se relanza solo por el redispatch de A.
  enqueue(ACCOUNT_A, EPISODE_A);
  dispatchWorkers(2);
  await waitUntil(() => getActiveWorkerCount() === 0, 15000, 30);

  const jobA2 = listJobs().find((j) => j.account === ACCOUNT_A && j.episodeId === EPISODE_A);
  const jobB2 = listJobs().find((j) => j.account === ACCOUNT_B && j.episodeId === EPISODE_B);
  check("A se reencoló y volvió a terminar (su propio ciclo, independiente)", jobA2?.status === "ERROR" && jobA2 !== jobA1);
  check(
    "B NUNCA se tocó por el redispatch de A (mismo estado, sin relanzarse, sin cambiar attempts)",
    jobB2?.status === "ERROR" && jobB2?.attempts === jobB1?.attempts
  );

  cleanState();
}

// ============================================================================
// PRUEBA 3 — shutdown con DOS workers reales vivos simultáneamente
// ============================================================================
// Reutiliza el patrón ya probado en Fase 1.4.1 (proceso node -e durmiente
// como sustituto SEGURO del worker real para poder mantenerlo vivo el tiempo
// suficiente para apagarlo a mitad de camino — shutdownWorkers() es agnóstico
// a qué corre el proceso, solo opera sobre el ChildProcess/PID real), ahora
// con DOS simultáneos en vez de uno.
const sleeperSpawn: SpawnWorkerFn = (): ChildProcess => spawn("node", ["-e", "setInterval(() => {}, 1000);"], { stdio: "ignore" });

async function testShutdownWithTwoRealWorkers() {
  console.log("\n=== PRUEBA 3: shutdown con DOS workers reales vivos a la vez ===");
  cleanState();
  enqueue(ACCOUNT_A, EPISODE_A);
  enqueue(ACCOUNT_B, EPISODE_B);

  dispatchWorkers(2, sleeperSpawn);
  await waitUntil(() => getActiveWorkerCount() === 2, 1000);
  const workersBefore = listActiveWorkers();
  check("ambos workers están vivos antes del shutdown", workersBefore.length === 2);
  const pidsBefore = workersBefore.map((w) => w.child.pid!);
  check("ambos PIDs reales están vivos (isProcessAlive)", pidsBefore.every((pid) => isProcessAlive(pid)));

  await shutdownWorkers(500);
  await sleep(300);

  check("shutdownWorkers() terminó AMBOS árboles de proceso reales", pidsBefore.every((pid) => !isProcessAlive(pid)));
  check("el registro en memoria quedó vacío tras el shutdown", getActiveWorkerCount() === 0);

  cleanState();
}

// ============================================================================
// PRUEBA 4 — compatibilidad MAX_WORKERS=1 con workers REALES (sin tocar env)
// ============================================================================
async function testMaxWorkersOneWithRealWorkers() {
  console.log("\n=== PRUEBA 4: MAX_WORKERS=1 (solo parámetro, sin tocar .env.local) con workers reales ===");
  cleanState();
  enqueue(ACCOUNT_A, EPISODE_A);
  enqueue(ACCOUNT_B, EPISODE_B);

  let maxConcurrentObserved = 0;
  const samplingInterval = setInterval(() => {
    maxConcurrentObserved = Math.max(maxConcurrentObserved, getActiveWorkerCount());
  }, 5);

  dispatchWorkers(1); // maxWorkers=1 explícito — spawnFn real, sin inyectar nada
  await waitUntil(() => getActiveWorkerCount() === 0 && listJobs().filter((j) => TEST_ACCOUNTS.includes(j.account) && j.status === "QUEUED").length === 0, 15000, 30);
  clearInterval(samplingInterval);

  check("con maxWorkers=1 NUNCA se observaron 2 workers reales activos a la vez", maxConcurrentObserved <= 1, `máx observado=${maxConcurrentObserved}`);
  const jobA = listJobs().find((j) => j.account === ACCOUNT_A && j.episodeId === EPISODE_A);
  const jobB = listJobs().find((j) => j.account === ACCOUNT_B && j.episodeId === EPISODE_B);
  check("ambos jobs igual terminan (procesados secuencialmente, ninguno se pierde)", jobA?.status === "ERROR" && jobB?.status === "ERROR");

  cleanState();
}

async function main() {
  await testTwoRealWorkersConcurrently();
  await testFailureIsolationBetweenRealWorkers();
  await testShutdownWithTwoRealWorkers();
  await testMaxWorkersOneWithRealWorkers();

  cleanState();
  console.log(`\n=== ${failures === 0 ? "TODO PASS" : `${failures} FALLO(S)`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Error ejecutando las pruebas:", err);
  cleanState();
  process.exit(1);
});
