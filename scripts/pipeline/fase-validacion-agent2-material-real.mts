// Validación de Agent 2 con MATERIAL REAL — prueba de un solo uso, limpiada
// después de usarse. Usa el episodio 011 real de SIN EXPLICACIÓN (guion +
// narración + imágenes REALES, copiados de SOLO LECTURA desde
// D:\MATERIAL VIDEOS — nunca se escribe ahí) dentro de un sandbox 100%
// aislado: MATERIAL_ROOT (variable de entorno, fijada ANTES de invocar tsx —
// ver nota de invocación al final de este archivo), episodesFile, dataRoot,
// publicAssetsRoot y outputRoot redirigidos a una carpeta temporal — el
// proceso real de Agente 2 (processOne.mts, spawn real) nunca toca
// D:\MATERIAL VIDEOS ni remotion/lib/episodes.ts reales.
//
// Mismo patrón ya validado por test-sandbox-e2e-fase155.mts (Fase 1.5.5):
// MATERIAL_ROOT es una constante de módulo (config.mts) evaluada UNA VEZ al
// importar — no se puede fijar dinámicamente dentro de este mismo proceso,
// debe venir seteada en el entorno ANTES de invocar tsx. A diferencia de
// fase155 (material 100% sintético, cuenta ficticia, bypass vía
// context.renderProviderId), esta prueba usa material REAL y la cuenta REAL
// "SIN EXPLICACIÓN" SIN bypass — se ejercita resolveRenderProvider(account)
// real (resolución de canal real), tal como pide la validación de hoy.
//
// Reutiliza remotion/data/captions-011.json (YA calculado por whisper real
// cuando este episodio se procesó de verdad en producción) para no volver a
// correr whisper (30-40 min) — mismo mecanismo de caché que processOne.mts
// YA usa en producción real ("Reusando transcripción existente"), no un
// atajo nuevo.
import "./env.mts";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MATERIAL_ROOT } from "./config.mts";
import { enqueue, listJobs, type Job } from "./queue.mts";
import { dispatchWorkers, getActiveWorkerCount } from "./agent.mts";
import type { SpawnWorkerFn } from "./agent.mts";
import { scanEpisode, allMaterialFiles } from "./materialScanner.mts";
import { checkCompleteness } from "./completenessChecker.mts";
import { hashAll } from "./fileRegistry.mts";
import { loadProject, saveProject } from "./projectManifest.mts";
import { stateFilePath, projectFilePath, readJson, writeJsonAtomic } from "./stateStore.mts";
import type { PipelineExecutionContext } from "./pipelineExecutionContext.mts";
import { resolveChannelConfig, resolveScannableChannels } from "./channelRegistry.mts";
import { resolveRenderProvider } from "./renderProviderRegistry.mts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const ACCOUNT = "SIN EXPLICACIÓN"; // nombre REAL del canal — se prueba la resolución real, no un bypass
const SOURCE_EPISODE = "011"; // episodio real fuente (solo lectura)
const TEST_EPISODE = "900"; // id de prueba numérico, claramente fuera del rango real 001-014
const REAL_SOURCE_DIR = path.join("D:\\MATERIAL VIDEOS", ACCOUNT, SOURCE_EPISODE);

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(predicate: () => boolean, timeoutMs: number, pollMs = 500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(pollMs);
  }
  return predicate();
}

function cleanQueueAndProjects(): void {
  const jobs = readJson<Job[]>(stateFilePath("queue.json"), []);
  writeJsonAtomic(stateFilePath("queue.json"), jobs.filter((j) => !(j.account === ACCOUNT && j.episodeId === TEST_EPISODE)));
  const p = projectFilePath(ACCOUNT, TEST_EPISODE);
  if (existsSync(p)) rmSync(p);
}

async function main() {
  // Mismo guard de seguridad que test-sandbox-e2e-fase155.mts::main() —
  // fail-closed si MATERIAL_ROOT no fue fijado a una carpeta de prueba antes
  // de invocar tsx (nunca corre esta prueba contra D:\MATERIAL VIDEOS real).
  if (!/test|tmp|temp/i.test(MATERIAL_ROOT) || MATERIAL_ROOT.toLowerCase() === "d:\\material videos") {
    throw new Error(`MATERIAL_ROOT no parece una carpeta de prueba ("${MATERIAL_ROOT}") — abortando por seguridad.`);
  }

  console.log("=== ESTADO ANTES (solo lectura, confirmación) ===");
  check('resolveScannableChannels() incluye "SIN EXPLICACIÓN" (sin cambios)', resolveScannableChannels().includes(ACCOUNT));
  check('resolveChannelConfig("SIN EXPLICACIÓN").channelStatus === "ACTIVE" (sin cambios)', resolveChannelConfig(ACCOUNT)?.channelStatus === "ACTIVE");
  const providerBefore = resolveRenderProvider(ACCOUNT);
  check('resolveRenderProvider("SIN EXPLICACIÓN").id === "documentary-remotion" (sin cambios)', providerBefore.id === "documentary-remotion");

  cleanQueueAndProjects();
  rmSync(MATERIAL_ROOT, { recursive: true, force: true });
  mkdirSync(MATERIAL_ROOT, { recursive: true });

  const testRoot = mkdtempSync(path.join(tmpdir(), "agent2-realmat-sinexp-"));
  const libDir = path.join(testRoot, "lib");
  const dataRoot = path.join(testRoot, "data");
  const publicAssetsRoot = path.join(testRoot, "public", "assets");
  const outputRoot = path.join(testRoot, "out");
  mkdirSync(libDir, { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(publicAssetsRoot, { recursive: true });
  mkdirSync(outputRoot, { recursive: true });

  try {
    // --- Copia de SOLO LECTURA de material REAL (nunca se escribe en D:\MATERIAL VIDEOS) ---
    const episodeDir = path.join(MATERIAL_ROOT, ACCOUNT, TEST_EPISODE);
    mkdirSync(path.join(episodeDir, "Imagenes"), { recursive: true });

    const realGuion = readdirSync(REAL_SOURCE_DIR).find((f) => /^guion/i.test(f) && f.endsWith(".md"));
    check("(setup) guion real de origen encontrado (episodio 011)", Boolean(realGuion), realGuion);
    if (!realGuion) throw new Error("No se encontró el guion real de origen — abortando.");
    copyFileSync(path.join(REAL_SOURCE_DIR, realGuion), path.join(episodeDir, realGuion));

    const realNarracion = path.join(REAL_SOURCE_DIR, "Narracion.mp3");
    check("(setup) Narracion.mp3 real de origen existe", existsSync(realNarracion));
    copyFileSync(realNarracion, path.join(episodeDir, "Narracion.mp3"));

    const realImages = readdirSync(path.join(REAL_SOURCE_DIR, "Imagenes"));
    check("(setup) imágenes reales de origen encontradas", realImages.length > 0, `${realImages.length} archivo(s)`);
    for (const img of realImages) copyFileSync(path.join(REAL_SOURCE_DIR, "Imagenes", img), path.join(episodeDir, "Imagenes", img));
    // Nota: episodio 011 real NO tiene carpeta "Videos" (solo "Videos_Referencia",
    // deliberadamente NO tratada como equivalente — ver nota de cabecera de
    // materialScanner.mts). No se crea ninguna carpeta "Videos" en el
    // sandbox: coincide exactamente con el material real — videoFiles=[] es
    // el resultado correcto, no un defecto de la copia.

    // --- Catálogo sandbox de episodes.ts (misma forma mínima ya validada
    // por test-sandbox-e2e-fase155.mts::buildSandboxRoot()). ---
    writeFileSync(path.join(dataRoot, "clips-000.json"), "[]\n");
    const episodesFile = path.join(libDir, "episodes.ts");
    writeFileSync(
      episodesFile,
      `export const FPS = 30;
const secToFrames = (sec) => Math.round(sec * FPS);
const normalizeCaptions = (raw) => raw;
const totalDurationFromCaptions = (captions) =>
  captions.length ? Math.max(...captions.map((c) => c.end)) : 0;

import rawClips000 from "../data/clips-000.json";

type EpisodeConfig = any;
export const episodes: EpisodeConfig[] = [];

export const getEpisode = (id) => {
  const ep = episodes.find((e) => e.id === id);
  if (!ep) throw new Error(\`Unknown episode "\${id}"\`);
  return ep;
};

export const mainDurationInFrames = (ep) =>
  Math.max(secToFrames(ep.narrationDurationSeconds), secToFrames(totalDurationFromCaptions(ep.captions)));
`
    );

    // remotion/components/AmbientAudio.tsx (REAL, sin modificar) espera una
    // librería COMPARTIDA de sfx en public/assets/audio/sfx/ — copyEpisodeAssets()
    // solo copia video/imágenes/narración POR episodio, nunca esto. Hallazgo
    // real ya documentado en test-sandbox-e2e-fase155.mts — se copia (solo
    // lectura del repo real) hacia el sandbox, nunca se modifica el original.
    const realSfxDir = path.join(REPO_ROOT, "public", "assets", "audio", "sfx");
    const sandboxSfxDir = path.join(publicAssetsRoot, "audio", "sfx");
    mkdirSync(sandboxSfxDir, { recursive: true });
    for (const file of readdirSync(realSfxDir)) copyFileSync(path.join(realSfxDir, file), path.join(sandboxSfxDir, file));

    // --- Captions REALES ya calculadas (whisper real, producción real) —
    // reutilizadas vía el mismo mecanismo de caché de processOne.mts, nunca
    // recalculadas (evita 30-40 min de whisper real). SIN EXPLICACIÓN
    // preserva su episode_id crudo (namespacedEpisodeId, excepción histórica
    // documentada) -> compositionEpisodeId === TEST_EPISODE === "900". ---
    const realCaptionsPath = path.join(REPO_ROOT, "remotion", "data", "captions-011.json");
    check("(setup) captions reales de origen (episodio 011, ya calculadas por whisper real) existen", existsSync(realCaptionsPath));
    copyFileSync(realCaptionsPath, path.join(dataRoot, `captions-${TEST_EPISODE}.json`));

    const context: PipelineExecutionContext = { episodesFile, dataRoot, publicAssetsRoot, outputRoot };

    // --- Autorización real (gate de seguridad de processOne.mts) — mismas
    // funciones reales que authorization.mts usa internamente (scanEpisode ->
    // checkCompleteness -> hashAll -> AUTHORIZED con snapshot de hashes),
    // mismo patrón que test-sandbox-e2e-fase155.mts::authorizeEpisodeDirect(). ---
    const ep = scanEpisode(ACCOUNT, TEST_EPISODE);
    console.log(`\n  scanEpisode real: scriptFile=${ep.scriptFile ? "sí" : "NO"} narrationFile=${ep.narrationFile ? "sí" : "NO"} videoFiles=${ep.videoFiles.length} imageFiles=${ep.imageFiles.length} soundFiles=${ep.soundFiles.length}`);
    check("(setup) scriptFile REAL detectado por el scanner", ep.scriptFile !== null, ep.scriptFile ?? "(ninguno)");
    check("(setup) narrationFile REAL detectado por el scanner (Narracion.mp3 real, sin generar nada)", ep.narrationFile !== null, ep.narrationFile ?? "(ninguno)");
    check("(setup) imageFiles reales detectados por el scanner", ep.imageFiles.length > 0, `${ep.imageFiles.length} archivo(s)`);
    check("(setup) videoFiles = 0 (coincide con el material real del episodio 011: sin carpeta Videos)", ep.videoFiles.length === 0);

    const completeness = checkCompleteness(ep);
    check("(setup) material real copiado está READY (guion + imágenes reales, sin video)", completeness.status === "READY", completeness.status === "WAITING_FOR_MATERIAL" ? completeness.reason : "");

    const hashes = await hashAll(allMaterialFiles(ep));
    const manifest = loadProject(ACCOUNT, TEST_EPISODE);
    manifest.status = "AUTHORIZED";
    manifest.authorizedAt = new Date().toISOString();
    manifest.authorizedBy = "fase-validacion-agent2-material-real";
    manifest.authorizedMaterialHashes = hashes;
    saveProject(manifest);
    enqueue(ACCOUNT, TEST_EPISODE);

    console.log("\n=== EJECUTANDO processOne.mts REAL (proceso hijo real, spawn real, material 100% real) ===");
    console.log("  (narración real ~262s — el render puede tardar varios minutos)");
    const PROCESS_ONE_ENTRY = path.join(REPO_ROOT, "scripts", "pipeline", "processOne.mts");
    const spawnFn: SpawnWorkerFn = (account, episodeId) =>
      spawn("node", ["--import", "tsx/esm", PROCESS_ONE_ENTRY, account, episodeId], {
        cwd: REPO_ROOT,
        stdio: "inherit",
        env: {
          ...process.env, // MATERIAL_ROOT ya está fijado en el entorno del proceso padre (ver invocación) — se hereda tal cual, nunca D:\MATERIAL VIDEOS
          PIPELINE_TEST_EPISODES_FILE: context.episodesFile,
          PIPELINE_TEST_DATA_ROOT: context.dataRoot,
          PIPELINE_TEST_PUBLIC_ROOT: context.publicAssetsRoot,
          PIPELINE_TEST_OUTPUT_ROOT: context.outputRoot,
        },
      });
    dispatchWorkers(1, spawnFn);
    const drained = await waitUntil(() => getActiveWorkerCount() === 0, 30 * 60_000, 500);
    check("el worker real terminó dentro del timeout (30 min)", drained);

    const job = listJobs().find((j) => j.account === ACCOUNT && j.episodeId === TEST_EPISODE);
    const manifestAfter = loadProject(ACCOUNT, TEST_EPISODE);
    console.log(`\n  cola=${job?.status} manifest=${manifestAfter.status} lastError=${job?.lastError ?? "(ninguno)"}`);
    check("el job terminó COMPLETED", job?.status === "COMPLETED");
    check("el manifest terminó COMPLETED", manifestAfter.status === "COMPLETED");

    console.log("\n=== VERIFICACIÓN DE OUTPUTS (dentro del sandbox MATERIAL_ROOT, nunca en D:\\MATERIAL VIDEOS real) ===");
    const exportedMain = path.join(MATERIAL_ROOT, ACCOUNT, "Videos YouTube Completos", `${TEST_EPISODE} - Video Completo.mp4`);
    const mainExists = existsSync(exportedMain);
    check("video completo exportado existe (carpeta correcta, nombre correcto)", mainExists, exportedMain);
    if (mainExists) {
      const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "default=noprint_wrappers=1", exportedMain], { encoding: "utf-8" });
      console.log(`  ffprobe MAIN:\n${probe.stdout}`);
      const durationMatch = probe.stdout.match(/duration=([\d.]+)/);
      const durationSec = durationMatch ? Number(durationMatch[1]) : NaN;
      check("duración del MAIN exportado ≈ duración real de Narracion.mp3 (262.36s ± 5s)", Math.abs(durationSec - 262.356463) < 5, `medida=${durationSec}s`);
    }
    const clipsDir = path.join(MATERIAL_ROOT, ACCOUNT, "Clips");
    const clipFiles = existsSync(clipsDir) ? readdirSync(clipsDir) : [];
    check("al menos un clip exportado en la carpeta correcta", clipFiles.length > 0, `${clipFiles.length} clip(s): ${clipFiles.join(", ")}`);
    if (clipFiles.length > 0) {
      const firstClip = path.join(clipsDir, clipFiles[0]);
      const probeClip = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "default=noprint_wrappers=1", firstClip], { encoding: "utf-8" });
      console.log(`  ffprobe CLIP (${clipFiles[0]}):\n${probeClip.stdout}`);
    }

    check("MATERIAL_ROOT real (D:\\MATERIAL VIDEOS) NO fue tocado — episodio 900 no existe ahí", !existsSync(path.join("D:\\MATERIAL VIDEOS", ACCOUNT, TEST_EPISODE)));
    const realEpisodesTs = readFileSync(path.join(REPO_ROOT, "remotion", "lib", "episodes.ts"), "utf-8");
    check('remotion/lib/episodes.ts REAL no fue tocado (el episodio "900" no vive ahí)', !realEpisodesTs.includes(`id: "${TEST_EPISODE}"`));
  } finally {
    console.log("\n=== LIMPIEZA ===");
    cleanQueueAndProjects();
    rmSync(testRoot, { recursive: true, force: true });
    rmSync(MATERIAL_ROOT, { recursive: true, force: true });
    console.log(`  sandbox eliminado: ${testRoot}`);
    console.log(`  MATERIAL_ROOT de prueba eliminado: ${MATERIAL_ROOT}`);
  }

  console.log("\n=== ESTADO DESPUÉS (confirmación) ===");
  check('resolveScannableChannels() incluye "SIN EXPLICACIÓN" (sin cambios)', resolveScannableChannels().includes(ACCOUNT));
  check('resolveChannelConfig("SIN EXPLICACIÓN").channelStatus === "ACTIVE" (sin cambios)', resolveChannelConfig(ACCOUNT)?.channelStatus === "ACTIVE");

  console.log(`\n=== ${failures === 0 ? "TODO PASS" : `${failures} FALLO(S)`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Error ejecutando la validación de Agent 2 con material real:", err);
  process.exit(1);
});

// INVOCACIÓN (MATERIAL_ROOT debe fijarse ANTES de tsx, ver nota de cabecera):
//   MATERIAL_ROOT="/c/Users/angie/AppData/Local/Temp/agent2-realmat-material" npx tsx scripts/pipeline/fase-validacion-agent2-material-real.mts
