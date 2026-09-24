// Fase 1.4 (workers multiproceso) — pruebas del lock CRUZADO-PROCESO de
// episodes.ts (episodesFileLock.mts). Usa un archivo de lock en una carpeta
// temporal (nunca el remotion/lib/episodes.ts real, nunca state/ real) vía el
// parámetro `lockFile` que la API ya expone para pruebas. Incluye una prueba
// de INTEGRACIÓN REAL con dos procesos Node genuinos (spawnSync) compitiendo
// por el mismo lock, para probar la exclusión cruzada-proceso de verdad, no
// solo simulada dentro de un mismo proceso.
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  acquireEpisodesFileLock,
  releaseEpisodesFileLock,
  withEpisodesFileLock,
} from "./episodesFileLock.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function testExclusiveAcquisition() {
  console.log("\n--- TEST 1: adquisición exclusiva — un segundo intento inmediato NO puede tomar el mismo lock ---");
  const dir = mkdtempSync(path.join(tmpdir(), "episodes-file-lock-test-"));
  const lockFile = path.join(dir, "episodes-ts.lock.json");

  const first = await acquireEpisodesFileLock({ lockFile, timeoutMs: 50, pollIntervalMs: 10 });
  check("el primer intento adquiere el lock", first.ok === true);

  const second = await acquireEpisodesFileLock({ lockFile, timeoutMs: 50, pollIntervalMs: 10 });
  check("un segundo intento mientras el primero sigue activo NO lo adquiere (timeout)", second.ok === false);

  if (first.ok) releaseEpisodesFileLock(first.token, lockFile);
  rmSync(dir, { recursive: true, force: true });
}

async function testPollingWaitsForRelease() {
  console.log("\n--- TEST 2: un segundo worker ESPERA (polling) a que el primero libere, no falla de inmediato ---");
  const dir = mkdtempSync(path.join(tmpdir(), "episodes-file-lock-test-"));
  const lockFile = path.join(dir, "episodes-ts.lock.json");

  const first = await acquireEpisodesFileLock({ lockFile, timeoutMs: 50, pollIntervalMs: 10 });
  check("(precondición) primer lock adquirido", first.ok === true);

  setTimeout(() => {
    if (first.ok) releaseEpisodesFileLock(first.token, lockFile);
  }, 150);

  const start = Date.now();
  const second = await acquireEpisodesFileLock({ lockFile, timeoutMs: 2000, pollIntervalMs: 20 });
  const waitedMs = Date.now() - start;
  check("el segundo intento SÍ logra adquirir el lock una vez liberado (no falla de entrada)", second.ok === true);
  check("esperó de verdad (no lo adquirió instantáneamente)", waitedMs >= 100, `esperó ${waitedMs}ms`);

  if (second.ok) releaseEpisodesFileLock(second.token, lockFile);
  rmSync(dir, { recursive: true, force: true });
}

async function testStaleLockIsStolen() {
  console.log("\n--- TEST 3: un lock STALE (mtime viejo) se recupera automáticamente, sin esperar a que su dueño lo libere ---");
  const dir = mkdtempSync(path.join(tmpdir(), "episodes-file-lock-test-"));
  const lockFile = path.join(dir, "episodes-ts.lock.json");

  // Simula un lock dejado por un proceso que murió: se crea con contenido
  // válido pero se le fuerza un mtime viejo (utimesSync) — igual que
  // evaluateRunLock() en runLock.mts, la decisión de "stale" es por mtime
  // real del archivo, nunca por contenido parseado.
  writeFileSync(lockFile, JSON.stringify({ token: "huerfano", pid: 999999, startedAt: new Date().toISOString() }));
  const oldTime = new Date(Date.now() - 60_000);
  utimesSync(lockFile, oldTime, oldTime);

  const start = Date.now();
  const acquired = await acquireEpisodesFileLock({ lockFile, staleMs: 1000, timeoutMs: 2000, pollIntervalMs: 20 });
  const elapsedMs = Date.now() - start;
  check("el lock stale se recupera y se adquiere (no queda bloqueado para siempre)", acquired.ok === true);
  check("se recuperó rápido (detectado como stale, no esperó el timeout completo de 2000ms)", elapsedMs < 500, `tardó ${elapsedMs}ms`);

  if (acquired.ok) {
    const content = JSON.parse(readFileSync(lockFile, "utf-8"));
    check("el lock robado tiene un token NUEVO (no el del proceso huérfano)", content.token === acquired.token && content.token !== "huerfano");
    releaseEpisodesFileLock(acquired.token, lockFile);
  }
  rmSync(dir, { recursive: true, force: true });
}

async function testReleaseWithWrongTokenIsNoop() {
  console.log("\n--- TEST 4: liberar con un token INCORRECTO nunca borra el lock ajeno ---");
  const dir = mkdtempSync(path.join(tmpdir(), "episodes-file-lock-test-"));
  const lockFile = path.join(dir, "episodes-ts.lock.json");

  const acquired = await acquireEpisodesFileLock({ lockFile, timeoutMs: 50, pollIntervalMs: 10 });
  check("(precondición) lock adquirido", acquired.ok === true);

  releaseEpisodesFileLock("token-que-no-es-el-nuestro", lockFile);
  check("el lock SIGUE existiendo tras un release con token equivocado", existsSync(lockFile));

  if (acquired.ok) {
    releaseEpisodesFileLock(acquired.token, lockFile);
    check("con el token CORRECTO sí se libera", !existsSync(lockFile));
  }
  rmSync(dir, { recursive: true, force: true });
}

async function testWithEpisodesFileLockReleasesOnError() {
  console.log("\n--- TEST 5: withEpisodesFileLock libera el lock aunque la función interna lance ---");
  const dir = mkdtempSync(path.join(tmpdir(), "episodes-file-lock-test-"));
  const lockFile = path.join(dir, "episodes-ts.lock.json");

  let threw = false;
  try {
    await withEpisodesFileLock(
      async () => {
        throw new Error("fallo simulado dentro de la sección crítica");
      },
      { lockFile, timeoutMs: 50, pollIntervalMs: 10 }
    );
  } catch {
    threw = true;
  }
  check("la excepción se propaga (no se traga silenciosamente)", threw);
  check("el lock quedó liberado tras el fallo (no bloquea al siguiente para siempre)", !existsSync(lockFile));

  const next = await acquireEpisodesFileLock({ lockFile, timeoutMs: 50, pollIntervalMs: 10 });
  check("un siguiente intento adquiere sin problema", next.ok === true);
  if (next.ok) releaseEpisodesFileLock(next.token, lockFile);
  rmSync(dir, { recursive: true, force: true });
}

// --- Integración REAL con dos procesos Node genuinos (no simulados dentro de
// un mismo proceso) — cada uno adquiere el lock, incrementa un contador en un
// archivo JSON compartido, y lo libera. Si el lock realmente serializa entre
// procesos del SO (no solo dentro de uno), el contador final debe ser
// exactamente la suma de ambos, sin pérdidas por carrera (read-modify-write
// sin protección) ni duplicados.
async function testRealCrossProcessExclusion() {
  console.log("\n--- TEST 6 (integración real, 2 procesos Node): sin capítulos duplicados ni pérdida de entradas ---");
  const dir = mkdtempSync(path.join(tmpdir(), "episodes-file-lock-cross-process-"));
  const lockFile = path.join(dir, "episodes-ts.lock.json");
  const counterFile = path.join(dir, "counter.json");
  writeFileSync(counterFile, JSON.stringify({ entries: [] }));

  const workerScript = path.join(dir, "worker.mts");
  const lockModulePath = path
    .join(import.meta.dirname, "episodesFileLock.mts")
    .replace(/\\/g, "/");
  writeFileSync(
    workerScript,
    `
import { withEpisodesFileLock } from "file:///${lockModulePath}";
import { readFileSync, writeFileSync } from "node:fs";

const [, , lockFile, counterFile, workerId, iterations] = process.argv;

async function main() {
  for (let i = 0; i < Number(iterations); i++) {
    await withEpisodesFileLock(
      async () => {
        const data = JSON.parse(readFileSync(counterFile, "utf-8"));
        // Simula la sección crítica real (leer episodes.ts, calcular el
        // próximo chapterNumber, escribir) con un pequeño delay para
        // aumentar la probabilidad de solapamiento si el lock NO protegiera
        // realmente entre procesos.
        await new Promise((r) => setTimeout(r, 5));
        data.entries.push(\`\${workerId}-\${i}\`);
        writeFileSync(counterFile, JSON.stringify(data));
      },
      { lockFile, timeoutMs: 20000, pollIntervalMs: 20 }
    );
  }
}
main();
`
  );

  const ITER = 10;
  const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
  const runWorkerAsync = (workerId: string): Promise<number | null> =>
    new Promise((resolve, reject) => {
      const child = spawn("node", ["--import", "tsx/esm", workerScript, lockFile, counterFile, workerId, String(ITER)], {
        cwd: REPO_ROOT,
        stdio: "inherit",
      });
      child.once("exit", (code) => resolve(code));
      child.once("error", reject);
    });

  // spawn() (asíncrono) — a diferencia de spawnSync, ambos procesos del SO
  // arrancan y corren REALMENTE en paralelo mientras esta promesa espera a
  // los dos; si el lock NO protegiera de verdad entre procesos, la carrera
  // real (delay de 5ms dentro de la sección crítica de cada worker) haría que
  // se pisen escrituras del counter.json.
  const [code1, code2] = await Promise.all([runWorkerAsync("A"), runWorkerAsync("B")]);
  check("ambos procesos worker terminaron con exit 0", code1 === 0 && code2 === 0, `A=${code1} B=${code2}`);

  const finalData = JSON.parse(readFileSync(counterFile, "utf-8")) as { entries: string[] };
  check(
    `las ${ITER * 2} entradas de ambos procesos están todas presentes (ninguna se perdió por una escritura pisada)`,
    finalData.entries.length === ITER * 2,
    `entradas=${finalData.entries.length}`
  );
  check("todas las entradas son distintas entre sí (sin duplicados)", new Set(finalData.entries).size === finalData.entries.length);
  check("no quedó ningún archivo de lock huérfano al terminar", !existsSync(lockFile));

  rmSync(dir, { recursive: true, force: true });
}

async function main() {
  await testExclusiveAcquisition();
  await testPollingWaitsForRelease();
  await testStaleLockIsStolen();
  await testReleaseWithWrongTokenIsNoop();
  await testWithEpisodesFileLockReleasesOnError();
  await testRealCrossProcessExclusion();

  console.log(`\n=== ${failures === 0 ? "TODO PASS" : `${failures} FALLO(S)`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Error ejecutando las pruebas:", err);
  process.exit(1);
});
