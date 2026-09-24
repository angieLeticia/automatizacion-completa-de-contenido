// Fase 1.4.1 — prueba REAL de árbol de procesos de 3 niveles en Windows:
//
//   test (coordinador de la prueba)
//     └── worker-proceso (lanzado vía dispatchWorkers()/spawnRealWorker-like,
//         real, nunca processOne.mts real, nunca whisper/ffmpeg/remotion)
//           └── proceso NIETO (spawneado por el propio worker, simula
//               exactamente el patrón real de processOne.mts: execFileSync
//               lanzando whisper/ffmpeg/remotion como hijo síncrono)
//
// Objetivo: confirmar que shutdownWorkers() (child.kill() + escalado a
// "taskkill /PID <pid> /T /F") termina el árbol COMPLETO, no solo el proceso
// worker directo — el hallazgo central de la Fase 1.3 que motivó el diseño de
// shutdown de la Fase 1.4. Nunca usa WMIC/PowerShell para descubrir procesos:
// el PID del nieto se obtiene por stdout del propio worker (que lo imprime él
// mismo), nunca por introspección externa del sistema operativo.
import "./env.mts";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { enqueue, isProcessAlive, type Job } from "./queue.mts";
import { dispatchWorkers, getActiveWorkerCount, listActiveWorkers, shutdownWorkers, type SpawnWorkerFn } from "./agent.mts";
import { stateFilePath, readJson, writeJsonAtomic } from "./stateStore.mts";

const ACCOUNT = "TEST_PROCESS_TREE_FASE141";

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

function cleanQueue(): void {
  const jobs = readJson<Job[]>(stateFilePath("queue.json"), []);
  writeJsonAtomic(
    stateFilePath("queue.json"),
    jobs.filter((j) => j.account !== ACCOUNT)
  );
  const p = path.join(process.cwd(), "scripts", "pipeline", "state", "projects", `${ACCOUNT}__999.json`);
  if (existsSync(p)) rmSync(p);
}

// Script del worker: -e inline (NUNCA se crea ningún archivo temporal) — al
// arrancar, spawnea su propio "nieto" (otro proceso node durmiente) y
// mantiene el nieto vivo mientras el worker mismo también vive. Imprime el
// PID del nieto por stdout para que la prueba lo pueda leer — nunca vía WMIC/
// PowerShell/inspección externa del sistema operativo.
const WORKER_SCRIPT =
  "const { spawn } = require('child_process');" +
  "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' });" +
  "console.log('GRANDCHILD_PID=' + child.pid);" +
  "setInterval(() => {}, 1000);";

function makeTreeSpawn(onGrandchildPid: (pid: number) => void): SpawnWorkerFn {
  return (): ChildProcess => {
    const child = spawn(process.execPath, ["-e", WORKER_SCRIPT], { stdio: ["ignore", "pipe", "ignore"] });
    let buffered = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf-8");
      const match = buffered.match(/GRANDCHILD_PID=(\d+)/);
      if (match) onGrandchildPid(Number(match[1]));
    });
    return child;
  };
}

async function testFullProcessTreeShutdown() {
  console.log("\n--- Árbol de procesos de 3 niveles: shutdownWorkers() debe terminar TODO el árbol ---");
  cleanQueue();
  enqueue(ACCOUNT, "999");

  let grandchildPid: number | null = null;
  const spawnFn = makeTreeSpawn((pid) => {
    grandchildPid = pid;
  });

  // 1. crear el árbol
  dispatchWorkers(1, spawnFn);
  await waitUntil(() => getActiveWorkerCount() === 1, 500);
  const [worker] = listActiveWorkers();
  check("el worker (nivel 2) quedó registrado con PID real", worker !== undefined && typeof worker.child.pid === "number");
  const workerPid = worker!.child.pid!;

  const gotGrandchildPid = await waitUntil(() => grandchildPid !== null, 1000);
  check("se obtuvo el PID del nieto (nivel 3) por stdout del propio worker (sin WMIC/PowerShell)", gotGrandchildPid);
  await sleep(150); // margen para que el proceso nieto termine de arrancar de verdad

  // 2. obtener el PID del worker — ya hecho arriba (workerPid)
  // 3. verificar que worker y child están vivos
  check("el worker (nivel 2) está vivo antes del shutdown", isProcessAlive(workerPid));
  check("el nieto (nivel 3) está vivo antes del shutdown", grandchildPid !== null && isProcessAlive(grandchildPid));

  // 4. ejecutar la lógica de shutdown YA IMPLEMENTADA — sin ningún mock, tal
  // cual la usaría el coordinador real (child.kill() + taskkill /T /F).
  await shutdownWorkers(500);
  await sleep(300); // margen para que taskkill (asíncrono a nivel de SO) termine de surtir efecto

  // 5. comprobar que el worker desapareció
  check("el worker (nivel 2) quedó terminado tras shutdownWorkers()", !isProcessAlive(workerPid));
  // 6. comprobar que el nieto TAMBIÉN desapareció (la prueba central de esta fase)
  check(
    "el NIETO (nivel 3) TAMBIÉN quedó terminado — taskkill /T /F mató el árbol completo, no solo el proceso directo",
    grandchildPid !== null && !isProcessAlive(grandchildPid)
  );
  // 7. confirmar que no quedaron procesos de prueba vivos
  check(
    "ningún proceso de esta prueba sigue vivo (ni worker ni nieto)",
    !isProcessAlive(workerPid) && (grandchildPid === null || !isProcessAlive(grandchildPid))
  );

  cleanQueue();
}

async function main() {
  await testFullProcessTreeShutdown();
  console.log(`\n=== ${failures === 0 ? "TODO PASS" : `${failures} FALLO(S)`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Error ejecutando las pruebas:", err);
  process.exit(1);
});
