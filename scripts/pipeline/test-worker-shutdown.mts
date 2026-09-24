// Fase 1.4 (workers multiproceso) — pruebas de shutdown/identidad usando
// PROCESOS NODE REALES (nunca fakes en memoria): se lanzan workers de verdad
// vía dispatchWorkers()+spawn() real contra un script "durmiente" trivial
// (node -e "setInterval(...)"), nunca processOne.mts real ni whisper/render.
// Objetivo: probar shutdownWorkers() (kill + taskkill /T /F) contra PIDs
// reales de Windows, y confirmar que NUNCA actúa sobre un PID que no esté en
// nuestro propio registro (identidad verificada, no solo "está vivo").
//
// SEGURIDAD: usa queue.json/state/projects reales (no hay forma de aislarlos)
// con una cuenta ficticia "TEST_SHUTDOWN_FASE14" que no existe en producción
// — se limpia explícitamente al final. Nunca toca D:\MATERIAL VIDEOS.
import "./env.mts";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { enqueue, attachWorker, isProcessAlive, listJobs, type Job } from "./queue.mts";
import { dispatchWorkers, getActiveWorkerCount, listActiveWorkers, shutdownWorkers, type SpawnWorkerFn } from "./agent.mts";
import { stateFilePath, readJson, writeJsonAtomic } from "./stateStore.mts";

const ACCOUNT = "TEST_SHUTDOWN_FASE14";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate: () => boolean, timeoutMs: number, pollMs = 20): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(pollMs);
  }
  return predicate();
}

function cleanQueueAndProjects(): void {
  const jobs = readJson<Job[]>(stateFilePath("queue.json"), []);
  writeJsonAtomic(
    stateFilePath("queue.json"),
    jobs.filter((j) => j.account !== ACCOUNT)
  );
  const p = path.join(process.cwd(), "scripts", "pipeline", "state", "projects", `${ACCOUNT}__999.json`);
  if (existsSync(p)) rmSync(p);
}

// Worker REAL (proceso Node genuino) que se queda corriendo indefinidamente
// hasta que lo maten — simula un worker "colgado" en medio de whisper/render
// para poder probar shutdown de verdad. Nunca ejecuta processOne.mts.
const sleeperSpawn: SpawnWorkerFn = (): ChildProcess =>
  spawn("node", ["-e", "setInterval(() => {}, 1000);"], { stdio: "ignore" });

async function testShutdownKillsRealRegisteredWorker() {
  console.log("\n--- TEST 1: shutdownWorkers() termina de verdad un worker REGISTRADO (proceso real) ---");
  cleanQueueAndProjects();
  enqueue(ACCOUNT, "999");

  dispatchWorkers(1, sleeperSpawn);
  await waitUntil(() => getActiveWorkerCount() === 1, 500);
  const [worker] = listActiveWorkers();
  check("el worker quedó registrado con un PID real", worker !== undefined && typeof worker.child.pid === "number");
  const pid = worker!.child.pid!;
  check("el PID está vivo antes del shutdown", isProcessAlive(pid));

  await shutdownWorkers(500);
  const stillAliveAfterShutdown = await waitUntil(() => !isProcessAlive(pid), 3000).then((exited) => !exited);
  check("el proceso real quedó terminado tras shutdownWorkers() (taskkill /T /F funcionó)", !stillAliveAfterShutdown);

  cleanQueueAndProjects();
}

async function testShutdownNeverTouchesUnregisteredPid() {
  console.log("\n--- TEST 2: shutdownWorkers() NUNCA actúa sobre un PID ajeno, aunque esté vivo ---");
  cleanQueueAndProjects();
  // Proceso real, real y vivo — pero deliberadamente NUNCA registrado como
  // worker (nunca pasó por dispatchWorkers()/launchWorker()/attachWorker()).
  const unrelated = spawn("node", ["-e", "setInterval(() => {}, 1000);"], { stdio: "ignore" });
  await sleep(100);
  check("(precondición) el proceso ajeno está vivo y NO está en el registro de workers", isProcessAlive(unrelated.pid!) && listActiveWorkers().length === 0);

  const killedPids: number[] = [];
  await shutdownWorkers(200, (pid) => {
    killedPids.push(pid);
  });

  check("shutdownWorkers() no intentó matar ningún PID (no había workers registrados)", killedPids.length === 0);
  check("el proceso ajeno SIGUE vivo — nunca se tocó un PID fuera de nuestro registro", isProcessAlive(unrelated.pid!));

  unrelated.kill(); // limpieza del proceso de prueba, no relacionado con la aserción
}

async function testShutdownWithNoActiveWorkersIsNoop() {
  console.log("\n--- TEST 3: shutdownWorkers() sin workers activos no falla ni hace nada ---");
  cleanQueueAndProjects();
  check("(precondición) no hay workers activos", getActiveWorkerCount() === 0);
  let threw = false;
  try {
    await shutdownWorkers(200, () => {
      throw new Error("killTree NUNCA debería llamarse acá");
    });
  } catch {
    threw = true;
  }
  check("no lanza y no invoca killTree cuando no hay nada que apagar", !threw);
}

async function testKillTreeOnlyCalledForRegisteredWorkers() {
  console.log("\n--- TEST 4: killTree() se llama SOLO para el PID del worker registrado, con identidad verificable ---");
  cleanQueueAndProjects();
  enqueue(ACCOUNT, "999");
  dispatchWorkers(1, sleeperSpawn);
  await waitUntil(() => getActiveWorkerCount() === 1, 500);
  const [worker] = listActiveWorkers();
  const expectedPid = worker!.child.pid!;

  const killedPids: number[] = [];
  await shutdownWorkers(300, (pid) => {
    killedPids.push(pid);
  });

  check("killTree() se llamó exactamente una vez", killedPids.length === 1);
  check("killTree() se llamó con el PID exacto del worker que nosotros mismos registramos", killedPids[0] === expectedPid);

  // El proceso real sigue vivo porque inyectamos un killTree falso que no
  // mata nada de verdad — se limpia a mano acá.
  isProcessAlive(expectedPid) && process.kill(expectedPid);
  cleanQueueAndProjects();
}

// Fase 1.4.1 — variante más estricta de TEST 2: acá el registro PERSISTIDO
// (queue.json, campo workerPid) SÍ apunta a un PID real, vivo — pero ese PID
// pertenece a un proceso que este coordinador NUNCA spawneó (simula, por
// ejemplo, un registro corrupto/desincronizado, o el caso "worker antiguo
// vivo de otra instancia" — Fase 1.4.1 §6). shutdownWorkers() nunca consulta
// queue.json directamente: solo actúa sobre `activeWorkers` (respaldado por
// el ChildProcess real que ESTE proceso creó) — así que un PID persistido sin
// una entrada real en memoria NUNCA puede disparar un taskkill, aunque esté
// vivo y aunque "parezca" nuestro por estar en queue.json.
async function testShutdownIgnoresPersistedPidWithoutInMemoryEntry() {
  console.log("\n--- TEST 5: PID real y vivo, presente en queue.json, pero SIN entrada en el registro en memoria -> nunca se toca ---");
  cleanQueueAndProjects();
  enqueue(ACCOUNT, "999");
  const unrelated = spawn("node", ["-e", "setInterval(() => {}, 1000);"], { stdio: "ignore" });
  await sleep(100);
  check("(precondición) el proceso ajeno está vivo", isProcessAlive(unrelated.pid!));

  // Se simula un registro persistido "desincronizado": queue.json dice que
  // este PID es el worker de este job, pero `activeWorkers` (en memoria, de
  // ESTA instancia) nunca lo registró — exactamente como quedaría un worker
  // de una instancia anterior tras un restart (Fase 1.4.1 §6), o un estado
  // corrupto.
  attachWorker(ACCOUNT, "999", { pid: unrelated.pid!, token: "token-de-otra-instancia", startedAt: new Date().toISOString() });
  check("(precondición) el registro en memoria de ESTA instancia sigue vacío", listActiveWorkers().length === 0);

  const killedPids: number[] = [];
  await shutdownWorkers(200, (pid) => killedPids.push(pid));

  check("shutdownWorkers() NUNCA llamó a killTree (no había entrada en el registro EN MEMORIA)", killedPids.length === 0);
  check("el proceso ajeno SIGUE vivo — un PID persistido sin respaldo real en memoria nunca autoriza una terminación", isProcessAlive(unrelated.pid!));

  unrelated.kill(); // limpieza del proceso de prueba
  cleanQueueAndProjects();
}

async function main() {
  await testShutdownKillsRealRegisteredWorker();
  await testShutdownNeverTouchesUnregisteredPid();
  await testShutdownWithNoActiveWorkersIsNoop();
  await testKillTreeOnlyCalledForRegisteredWorkers();
  await testShutdownIgnoresPersistedPidWithoutInMemoryEntry();

  cleanQueueAndProjects();
  console.log(`\n=== ${failures === 0 ? "TODO PASS" : `${failures} FALLO(S)`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Error ejecutando las pruebas:", err);
  process.exit(1);
});
