// Bloque 1 (post-Fase 6.5) — prueba REAL de que processOne.mts ya no
// depende de chaosFixture/defaultProps cuando procesa un episodio real: el
// mismo flujo E2E de Fase 6 (test-chaos-news-sandbox-e2e.mts), reutilizado
// tal cual (mismo sandbox, mismo spawn real de processOne.mts, mismo bypass
// context.renderProviderId), con UN cambio deliberado: la narración
// sintética dura ~20s (no ~12s como en Fase 6, elegido A PROPÓSITO para caer
// FUERA de cualquier tolerancia razonable de los 12.5s exactos del fixture
// ChaosNewsMain) — si el render todavía usara el fixture (el bug que Fase
// 6.5/Bloque 1 resuelven), la duración medida seguiría siendo 12.5s; si usa
// los datos reales (whisper/captions/duración real vía
// renderMainWithRealData), la duración medida debe reflejar la narración de
// ESTE episodio sintético, no la del fixture.
//
// Flujo REAL atravesado (proceso hijo real, nunca simulado):
//   processOne.mts (spawn real)
//     -> resolveRenderProvider bypass (context.renderProviderId)
//     -> isRealDataRenderProvider(chaosNewsRemotionProvider) === true
//     -> renderMainWithRealData(id, {captions/videoPool/imagePool/shots/narración REALES}, context)
//     -> renderComposition("ChaosNewsMain", ..., {props: {config}})
//     -> npx remotion render --props=<archivo> (proceso real)
//     -> archivo de salida real, duración = la del episodio real, no la del fixture
import "./env.mts";
import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MATERIAL_ROOT } from "./config.mts";
import { enqueue, listJobs } from "./queue.mts";
import { dispatchWorkers, getActiveWorkerCount } from "./agent.mts";
import type { SpawnWorkerFn } from "./agent.mts";
import { scanEpisode, allMaterialFiles } from "./materialScanner.mts";
import { checkCompleteness } from "./completenessChecker.mts";
import { hashAll } from "./fileRegistry.mts";
import { loadProject, saveProject } from "./projectManifest.mts";
import { stateFilePath, readJson, writeJsonAtomic } from "./stateStore.mts";
import type { Job } from "./queue.mts";
import type { PipelineExecutionContext } from "./pipelineExecutionContext.mts";
import { namespacedEpisodeId } from "./episodeNamespace.mts";
import { chaosNewsRemotionProvider, CHAOS_NEWS_MAIN_COMPOSITION_ID } from "./chaosNewsRemotionProvider.mts";
import { isRealDataRenderProvider } from "./renderProvider.mts";
import { resolveChannelConfig, resolveScannableChannels } from "./channelRegistry.mts";
import { resolveRenderProvider, ChannelNotProducibleError } from "./renderProviderRegistry.mts";
import { chaosMainDurationInFrames } from "../../remotion/lib/chaosEpisode.ts";
import { chaosMainFixture } from "../../remotion/lib/chaosFixture.ts";

const ACCOUNT = "TESTACCOUNTCHAOSRD1"; // solo alfanumérico — mismo motivo que Fase 6 (episodeNamespace.mts)
const EPISODE = "TESTCHAOSRD1EP001";
const FPS = 30;
const NARRATION_SECONDS = 20; // deliberadamente distinto de los 12.5s del fixture

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(predicate: () => boolean, timeoutMs: number, pollMs = 200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(pollMs);
  }
  return predicate();
}

async function authorizeEpisodeDirect(account: string, episodeId: string): Promise<{ ok: boolean; reason?: string }> {
  const ep = scanEpisode(account, episodeId);
  const completeness = checkCompleteness(ep);
  if (completeness.status === "WAITING_FOR_MATERIAL") return { ok: false, reason: completeness.reason };
  const files = allMaterialFiles(ep);
  const hashes = await hashAll(files);
  const manifest = loadProject(account, episodeId);
  manifest.status = "AUTHORIZED";
  manifest.authorizedAt = new Date().toISOString();
  manifest.authorizedBy = "test-chaos-real-data-sandbox-e2e";
  manifest.authorizedMaterialHashes = hashes;
  saveProject(manifest);
  return { ok: true };
}

function cleanQueueAndProjects(): void {
  const jobs = readJson<Job[]>(stateFilePath("queue.json"), []);
  writeJsonAtomic(stateFilePath("queue.json"), jobs.filter((j) => j.account !== ACCOUNT));
  const p = path.join(process.cwd(), "scripts", "pipeline", "state", "projects", `${ACCOUNT}__${EPISODE}.json`);
  if (existsSync(p)) rmSync(p);
}

// --- Material sintético (dentro de MATERIAL_ROOT, nunca D:\MATERIAL VIDEOS) ---
function buildEpisodeMaterial(): void {
  const folder = path.join(MATERIAL_ROOT, ACCOUNT, EPISODE);
  mkdirSync(path.join(folder, "Videos"), { recursive: true });
  mkdirSync(path.join(folder, "Imagenes"), { recursive: true });

  writeFileSync(
    path.join(folder, "Guion - Prueba.md"),
    `# ENCIENDE EL CAOS (SANDBOX — Bloque 1)\n## Expediente 000\n### Caso sintético ${EPISODE}\n\nFrase sintética uno.\nFrase sintética dos.\n`
  );

  const narrationPath = path.join(folder, "Narracion.mp3");
  const r1 = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${NARRATION_SECONDS}`, "-ar", "44100", "-ac", "2", narrationPath], { stdio: "pipe" });
  if (r1.status !== 0) throw new Error(`ffmpeg (narración sintética) falló: ${r1.stderr?.toString()}`);

  const videoPath = path.join(folder, "Videos", "clip-sintetico.mp4");
  const r2 = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=green:s=640x360:d=6", "-r", "30", "-pix_fmt", "yuv420p", videoPath], { stdio: "pipe" });
  if (r2.status !== 0) throw new Error(`ffmpeg (video sintético) falló: ${r2.stderr?.toString()}`);

  const imagePath = path.join(folder, "Imagenes", "imagen-sintetica.jpg");
  const r3 = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=yellow:s=640x360", "-frames:v", "1", imagePath], { stdio: "pipe" });
  if (r3.status !== 0) throw new Error(`ffmpeg (imagen sintética) falló: ${r3.stderr?.toString()}`);
}

// --- Sandbox root: mismo patrón que Fase 6, SIN necesitar el fixture
// _fixture_chaos (la parte de b-roll ya no viene del fixture — viene de la
// copia REAL del material sintético que processOne.mts hace vía
// copyEpisodeAssets(), como para cualquier episodio real). ---
function buildSandboxRoot(): PipelineExecutionContext {
  const testRoot = mkdtempSync(path.join(tmpdir(), "chaos-realdata-sandbox-"));
  const libDir = path.join(testRoot, "lib");
  const dataRoot = path.join(testRoot, "data");
  const publicAssetsRoot = path.join(testRoot, "public", "assets");
  const outputRoot = path.join(testRoot, "out");
  mkdirSync(libDir, { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(publicAssetsRoot, { recursive: true });
  mkdirSync(outputRoot, { recursive: true });

  writeFileSync(path.join(dataRoot, "clips-000.json"), "[]\n");

  const episodesFile = path.join(libDir, "episodes.ts");
  writeFileSync(
    episodesFile,
    `// Bloque 1 — catálogo SANDBOX autocontenido, mismo patrón que Fase 6.
// ChaosNewsMain/ChaosNewsClip nunca lo leen (reciben su config vía props) —
// existe solo porque processOne.mts/episodeRegistrar.mts lo escriben
// incondicionalmente para CUALQUIER provider.
export const FPS = 30;
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

  return { episodesFile, dataRoot, publicAssetsRoot, outputRoot, renderProviderId: "chaos-news-remotion" };
}

// Captions DISTINTAS de las de Fase 6 (terminan ~18s, dentro del rango de
// NARRATION_SECONDS=20) — reemplaza la transcripción real (whisper tardaría
// ~30-40 min y una sinusoidal no tiene habla real que transcribir), mismo
// mecanismo de caché que processOne.mts ya soporta (captions-{id}.json con
// datos existentes -> se reusa, nunca corre whisper).
function seedCaptions(dataRoot: string, compositionEpisodeId: string): number {
  const CAPTIONS_END_SECONDS = 18;
  writeFileSync(
    path.join(dataRoot, `captions-${compositionEpisodeId}.json`),
    JSON.stringify(
      [
        { start: 0, end: 9, text: "Frase sintética de Bloque uno." },
        { start: 9, end: CAPTIONS_END_SECONDS, text: "Frase sintética de Bloque dos." },
      ],
      null,
      2
    )
  );
  return CAPTIONS_END_SECONDS;
}

function makeRealSandboxSpawn(context: PipelineExecutionContext): SpawnWorkerFn {
  const PROCESS_ONE_ENTRY = path.join(process.cwd(), "scripts", "pipeline", "processOne.mts");
  return (account: string, episodeId: string): ChildProcess =>
    spawn("node", ["--import", "tsx/esm", PROCESS_ONE_ENTRY, account, episodeId], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: {
        ...process.env,
        PIPELINE_TEST_EPISODES_FILE: context.episodesFile,
        PIPELINE_TEST_DATA_ROOT: context.dataRoot,
        PIPELINE_TEST_PUBLIC_ROOT: context.publicAssetsRoot,
        PIPELINE_TEST_OUTPUT_ROOT: context.outputRoot,
        PIPELINE_TEST_RENDER_PROVIDER_ID: context.renderProviderId ?? "",
      },
    });
}

function checkChannelStateUnaffected(momentLabel: string) {
  const scannable = resolveScannableChannels();
  check(`[${momentLabel}] resolveScannableChannels() === ["SIN EXPLICACIÓN"]`, JSON.stringify(scannable) === JSON.stringify(["SIN EXPLICACIÓN"]));
  const config = resolveChannelConfig("ENCIENDE EL CAOS");
  check(`[${momentLabel}] ENCIENDE EL CAOS.channelStatus === "HISTORICAL"`, config?.channelStatus === "HISTORICAL");
  let threw = false;
  let isChannelNotProducible = false;
  try {
    resolveRenderProvider("ENCIENDE EL CAOS");
  } catch (err) {
    threw = true;
    isChannelNotProducible = err instanceof ChannelNotProducibleError;
  }
  check(`[${momentLabel}] resolveRenderProvider("ENCIENDE EL CAOS") sigue rechazando con ChannelNotProducibleError`, threw && isChannelNotProducible);
}

async function main() {
  if (!/test|tmp|temp/i.test(MATERIAL_ROOT) || MATERIAL_ROOT.toLowerCase() === "d:\\material videos") {
    throw new Error(`MATERIAL_ROOT no parece una carpeta de prueba ("${MATERIAL_ROOT}") — abortando por seguridad.`);
  }
  mkdirSync(MATERIAL_ROOT, { recursive: true });

  console.log("=== ESTADO DEL CANAL ANTES DEL E2E ===");
  checkChannelStateUnaffected("antes");

  check("isRealDataRenderProvider(chaosNewsRemotionProvider) === true (precondición de esta prueba)", isRealDataRenderProvider(chaosNewsRemotionProvider));

  console.log("\n=== SETUP: material sintético + sandbox + autorización ===");
  cleanQueueAndProjects();
  const context = buildSandboxRoot();
  console.log(`  TEST_ROOT: ${path.dirname(context.dataRoot)}`);

  try {
    await runE2E(context);
  } finally {
    console.log("\n=== LIMPIEZA ===");
    cleanQueueAndProjects();
    rmSync(path.dirname(context.dataRoot), { recursive: true, force: true });
    rmSync(path.join(MATERIAL_ROOT, ACCOUNT), { recursive: true, force: true });
    console.log("  sandbox y material sintético eliminados.");
  }

  console.log(`\n=== ${failures === 0 ? "TODO PASS" : `${failures} FALLO(S)`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

async function runE2E(context: PipelineExecutionContext): Promise<void> {
  buildEpisodeMaterial();

  const compositionEpisodeId = namespacedEpisodeId(ACCOUNT, EPISODE);
  const captionsEndSeconds = seedCaptions(context.dataRoot, compositionEpisodeId);

  const auth = await authorizeEpisodeDirect(ACCOUNT, EPISODE);
  check("(setup) episodio autorizado", auth.ok, auth.ok ? "" : auth.reason);
  enqueue(ACCOUNT, EPISODE);

  console.log("\n=== EJECUTANDO processOne.mts REAL (proceso hijo real, spawn real) ===");
  const spawnFn = makeRealSandboxSpawn(context);
  dispatchWorkers(1, spawnFn);
  const drained = await waitUntil(() => getActiveWorkerCount() === 0, 15 * 60_000, 200);
  check("el worker real terminó dentro del timeout (15 min)", drained);

  const job = listJobs().find((j) => j.account === ACCOUNT && j.episodeId === EPISODE);
  const manifest = loadProject(ACCOUNT, EPISODE);
  console.log(`\n  cola=${job?.status} manifest=${manifest.status} lastError=${job?.lastError ?? "(ninguno)"}`);

  console.log("\n=== MAIN: la duración debe reflejar EL EPISODIO REAL, no el fixture ===");
  const rawRenderOutput = path.join(context.outputRoot, `chaos-news-main-${compositionEpisodeId}.mp4`);
  const rawExists = existsSync(rawRenderOutput);
  check('output intermedio del PROVIDER existe con el nombre distintivo "chaos-news-main-*"', rawExists, rawRenderOutput);

  if (rawExists) {
    const size = statSync(rawRenderOutput).size;
    check("output intermedio > 100KB (no es un archivo vacío/corrupto)", size > 100_000, `${size} bytes`);

    // Duración real esperada: la MISMA fórmula pura que usa Root.tsx
    // (chaosMainDurationInFrames), con el hook/bumper del fixture (identidad
    // creativa, sin cambios de Bloque 1) pero la narración/captions REALES
    // de este episodio sintético — exactamente lo que
    // chaosNewsRemotionProvider.renderMainWithRealData() debería construir.
    const expectedFrames = chaosMainDurationInFrames({
      ...chaosMainFixture,
      narrationDurationSeconds: NARRATION_SECONDS,
      captions: [{ start: 0, end: captionsEndSeconds, text: "x", type: "normal" }],
    });
    const expectedSeconds = expectedFrames / FPS;
    const fixtureSeconds = 12.5;

    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", rawRenderOutput], { encoding: "utf-8" });
    const durationSec = probe.status === 0 ? Number(JSON.parse(probe.stdout).format?.duration) : NaN;
    check(
      `duración del render ≈ ${expectedSeconds}s ± 0.5s (derivada de LA NARRACIÓN REAL de este episodio de prueba — prueba de que renderMainWithRealData() se usó de verdad)`,
      Number.isFinite(durationSec) && Math.abs(durationSec - expectedSeconds) < 0.5,
      `medida=${durationSec}s esperado=${expectedSeconds}s`
    );
    check(
      "duración del render está a más de 5s del fixture (12.5s) — si coincidiera, seguiría dependiendo del fixture, no del episodio real",
      Number.isFinite(durationSec) && Math.abs(durationSec - fixtureSeconds) > 5,
      `medida=${durationSec}s`
    );

    const dims = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", rawRenderOutput], { encoding: "utf-8" });
    const parsedDims = dims.status === 0 ? JSON.parse(dims.stdout).streams?.[0] : null;
    check("dimensiones del render MAIN === 1920x1080", parsedDims?.width === 1920 && parsedDims?.height === 1080, JSON.stringify(parsedDims));
  }

  const exportedMain = path.join(MATERIAL_ROOT, ACCOUNT, "Videos YouTube Completos", `${EPISODE} - Video Completo.mp4`);
  check("output FINAL exportado (post-QA) existe en MATERIAL_ROOT", existsSync(exportedMain), exportedMain);

  console.log("\n=== CLIP: la duración debe reflejar el rango real del clip seleccionado ===");
  const clipsJsonPath = path.join(context.dataRoot, `clips-${compositionEpisodeId}.json`);
  const realClips = existsSync(clipsJsonPath) ? (JSON.parse(readFileSync(clipsJsonPath, "utf-8")) as { startFrame: number; endFrame: number }[]) : [];
  check("clips-{id}.json real contiene al menos un clip seleccionado", realClips.length > 0, `${realClips.length} clip(s)`);

  if (realClips.length > 0) {
    const rawClipOutput = path.join(context.outputRoot, `chaos-news-clip-${compositionEpisodeId}-0.mp4`);
    const clipExists = existsSync(rawClipOutput);
    check('output intermedio de CLIP existe con nombre distintivo "chaos-news-clip-*-0" (vía processOne.mts real)', clipExists, rawClipOutput);
    if (clipExists) {
      const expectedClipSeconds = (realClips[0].endFrame - realClips[0].startFrame) / FPS;
      const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", rawClipOutput], { encoding: "utf-8" });
      const durationSec = probe.status === 0 ? Number(JSON.parse(probe.stdout).format?.duration) : NaN;
      check(
        `duración del CLIP ≈ ${expectedClipSeconds.toFixed(2)}s ± 0.3s (rango [startFrame,endFrame) REAL de clipSelector.mts, no el fixture fijo de 9s)`,
        Number.isFinite(durationSec) && Math.abs(durationSec - expectedClipSeconds) < 0.3,
        `medida=${durationSec}s esperado=${expectedClipSeconds.toFixed(2)}s`
      );
      const dims = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", rawClipOutput], { encoding: "utf-8" });
      const parsedDims = dims.status === 0 ? JSON.parse(dims.stdout).streams?.[0] : null;
      check("dimensiones del render CLIP === 1080x1920", parsedDims?.width === 1080 && parsedDims?.height === 1920, JSON.stringify(parsedDims));
    }
  }

  console.log("\n=== IDENTIDAD ===");
  check("output MAIN NUNCA se llamó main-*.mp4 (patrón de documentary-remotion)", !existsSync(path.join(context.outputRoot, `main-${compositionEpisodeId}.mp4`)));
  check('chaosNewsRemotionProvider.id === "chaos-news-remotion"', chaosNewsRemotionProvider.id === "chaos-news-remotion");
  check(`CHAOS_NEWS_MAIN_COMPOSITION_ID === "ChaosNewsMain"`, CHAOS_NEWS_MAIN_COMPOSITION_ID === "ChaosNewsMain");

  console.log("\n=== ESTADO DEL CANAL DESPUÉS DEL E2E (sin cambios) ===");
  checkChannelStateUnaffected("después");
}

main().catch((err) => {
  console.error("Error ejecutando la prueba real-data E2E de Bloque 1:", err);
  process.exit(1);
});
