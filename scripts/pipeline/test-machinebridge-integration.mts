// Pruebas de integración de la Fase 4.6 — mismo patrón ad-hoc que el resto
// del proyecto (archivos/temp reales, sin mocks). Objetivo: demostrar, con
// evidencia real, que sustituir las llamadas directas de processOne.mts por
// MachineBridge produce EXACTAMENTE el mismo resultado que las funciones
// originales de scripts/pipeline/*.mts (que siguen existiendo sin cambios).
// No prueba processProject() de punta a punta (necesitaría material real de
// producción que no existe en esta máquina — ver docs/machine-access.md).
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { probeAudioDurationSeconds } from "./mediaCatalog.mts";
import { detectSilences } from "./silenceDetector.mts";
import { acquireLock, releaseLock, readLock } from "./agentLock.mts";
import { machineBridge, PathViolationError } from "../../agent/machine/machineBridge.mts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const TEST_DIR = path.join(REPO_ROOT, "public", "assets", "__fase46-integration-test__");

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

async function main() {
  mkdirSync(TEST_DIR, { recursive: true });
  const audioPath = path.join(TEST_DIR, "narracion-sintetica.wav");
  spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "2.37", audioPath]);
  const haveAudio = existsSync(audioPath);
  check("Fixture — audio sintético real generado con ffmpeg", haveAudio);

  if (haveAudio) {
    // ---- Equivalencia probeAudioDurationSeconds (función original) vs
    // MachineBridge.media.probe() (lo que pasaría a usar processOne.mts) ----
    const oldDuration = probeAudioDurationSeconds(audioPath);
    const bridgeInfo = await machineBridge.media!.probe(audioPath);
    check(
      "Equivalencia — probeAudioDurationSeconds() vs MachineBridge.media.probe().durationSeconds",
      Math.abs(oldDuration - bridgeInfo.durationSeconds) < 0.05,
      `original=${oldDuration}s, bridge=${bridgeInfo.durationSeconds}s`
    );

    // ---- Equivalencia detectSilences (función original) vs
    // MachineBridge.media.detectSilences() ----
    const oldSilences = detectSilences(audioPath);
    const bridgeSilences = await machineBridge.media!.detectSilences(audioPath);
    check(
      "Equivalencia — detectSilences() original vs MachineBridge.media.detectSilences()",
      JSON.stringify(oldSilences) === JSON.stringify(bridgeSilences),
      `original=${JSON.stringify(oldSilences)}, bridge=${JSON.stringify(bridgeSilences)}`
    );

    // ---- Recuperación real: archivo inexistente ----
    let probeMissingThrew = false;
    try {
      await machineBridge.media!.probe(path.join(TEST_DIR, "no-existe.wav"));
    } catch {
      probeMissingThrew = true;
    }
    check("Recuperación — probe(archivo inexistente) lanza error real (ffprobe_failed)", probeMissingThrew);

    // ---- Recuperación real: ruta insegura (fuera de toda raíz permitida) ----
    let probeUnsafeThrew = false;
    try {
      await machineBridge.media!.probe(path.join(tmpdir(), "fuera-de-raiz.wav"));
    } catch (err) {
      probeUnsafeThrew = err instanceof PathViolationError;
    }
    check("Recuperación — probe(ruta insegura) lanza PathViolationError", probeUnsafeThrew);
  } else {
    console.log("NOTA: no se pudo generar el fixture de audio con ffmpeg — se omiten las pruebas de equivalencia probe/detectSilences.");
  }
  rmSync(TEST_DIR, { recursive: true, force: true });

  // ==========================================================================
  // Concurrencia real de agentLock.mts (pendiente de la Fase 4.4) — sin
  // infraestructura nueva: se reutiliza el lock real de Agent 2, se lanza un
  // segundo proceso Node REAL que lo mantiene tomado durante unos segundos, y
  // se comprueba que el proceso actual lo detecta correctamente como ocupado.
  // ==========================================================================
  const existingLockInfo = readLock();
  if (existingLockInfo) {
    console.log(
      `NOTA: se omite la prueba de concurrencia — ya existe un agent.lock real activo (pid=${existingLockInfo.pid}), ` +
        "probablemente un agente de producción corriendo en esta máquina. No se toca ese lock."
    );
  } else {
    // Vive junto a agentLock.mts (import relativo trivial "./agentLock.mts",
    // sin depender de profundidad de carpetas) y se borra al final — un solo
    // archivo, nunca se borra ningún directorio real del proyecto.
    const holderScript = path.join(import.meta.dirname, ".tmp-fase46-lock-holder.mts");
    writeFileSync(
      holderScript,
      [
        'import { acquireLock, releaseLock } from "./agentLock.mts";',
        "const result = acquireLock();",
        "if (!result.acquired) { console.log('HOLDER_FAILED_TO_ACQUIRE'); process.exit(1); }",
        "console.log('HOLDER_ACQUIRED');",
        "setTimeout(() => { releaseLock(); console.log('HOLDER_RELEASED'); }, 3000);",
      ].join("\n")
    );
    const holder = spawn("npx", ["tsx", holderScript], { cwd: REPO_ROOT, shell: true });
    let holderAcquired = false;
    await new Promise<void>((resolve) => {
      holder.stdout?.on("data", (d) => {
        if (d.toString().includes("HOLDER_ACQUIRED")) {
          holderAcquired = true;
          resolve();
        }
      });
      setTimeout(resolve, 5000); // seguro por si el proceso hijo tarda en arrancar
    });
    check("Concurrencia — proceso B (real, PID distinto) toma el lock real", holderAcquired);

    if (holderAcquired) {
      const attemptWhileHeld = acquireLock();
      check(
        "Concurrencia — proceso A detecta el lock ocupado por el PID real del proceso B (no lo pisa)",
        attemptWhileHeld.acquired === false,
        JSON.stringify(attemptWhileHeld)
      );
    }

    await new Promise<void>((resolve) => holder.on("exit", () => resolve()));
    const afterRelease = acquireLock();
    check("Concurrencia — tras liberar el proceso B, el proceso A SÍ puede adquirir el lock", afterRelease.acquired === true);
    if (afterRelease.acquired) releaseLock();
    rmSync(holderScript, { force: true });
  }

  console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Fallo fatal en pruebas de integración de Fase 4.6:", err);
  process.exit(1);
});
