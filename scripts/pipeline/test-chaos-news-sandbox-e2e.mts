// FASE 5.10-AS (Fase 6 — sandbox E2E de ENCIENDE EL CAOS) — reutiliza EXACTA
// la infraestructura real de test-sandbox-e2e-fase155.mts (mismo mecanismo
// de sandbox, mismo bypass context.renderProviderId, mismo spawn real de
// processOne.mts) — NO se inventa arquitectura nueva. Único cambio real:
// renderProviderId="chaos-news-remotion" en vez de "documentary-remotion",
// y un fixture de assets propio para ChaosNewsMain/ChaosNewsClip.
//
// Flujo REAL atravesado (proceso hijo real, nunca simulado):
//   processOne.mts (spawn real)
//     -> resolveRenderProvider bypass (context.renderProviderId)
//     -> RENDER_PROVIDERS["chaos-news-remotion"] = chaosNewsRemotionProvider
//     -> renderComposition("ChaosNewsMain"/"ChaosNewsClip", ...)
//     -> agent/machine/renderBridge.mts::assertCompositionExists()
//     -> npx remotion render (proceso real)
//     -> archivo de salida real
//
// LIMITACIÓN YA REPORTADA EN FASE 5 (no resuelta aquí, solo evidenciada de
// nuevo): renderComposition() no pasa --props, así que Remotion SIEMPRE
// renderiza el fixture registrado como defaultProps en Root.tsx
// (chaosMainFixture/chaosClipFixture), nunca los datos del episodio
// sintético real que esta prueba arma. Por eso la duración narrada del
// episodio sintético se elige DENTRO de la tolerancia de checkRenderedVideo
// (±5s) respecto a la duración REAL del fixture (12.5s) — si no coincidiera,
// el QA de processOne.mts fallaría, no porque el pipeline esté roto, sino
// porque el contenido renderizado (el fixture) nunca es el contenido narrado
// (el episodio sintético) — la prueba deja esto explícito, no lo oculta.
import "./env.mts";
import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, statSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
import { chaosNewsRemotionProvider } from "./chaosNewsRemotionProvider.mts";
import { RENDER_PROVIDERS, resolveRenderProvider, ChannelNotProducibleError } from "./renderProviderRegistry.mts";
import { resolveChannelConfig, resolveScannableChannels } from "./channelRegistry.mts";
import { enciendeElCaosTheme } from "../../channels/enciende-el-caos/theme.ts";

const ACCOUNT = "TESTACCOUNTCHAOSE2E"; // solo alfanumérico — mismo motivo que TEST_ACCOUNT_FASE155 (namespace) documentado en episodeNamespace.mts
const EPISODE = "TESTCHAOSEP001";

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

// Misma lógica real de authorization.mts::authorizeProject() que ya usa
// test-sandbox-e2e-fase155.mts — reutilizada tal cual, no reimplementada.
async function authorizeEpisodeDirect(account: string, episodeId: string): Promise<{ ok: boolean; reason?: string }> {
  const ep = scanEpisode(account, episodeId);
  const completeness = checkCompleteness(ep);
  if (completeness.status === "WAITING_FOR_MATERIAL") return { ok: false, reason: completeness.reason };
  const files = allMaterialFiles(ep);
  const hashes = await hashAll(files);
  const manifest = loadProject(account, episodeId);
  manifest.status = "AUTHORIZED";
  manifest.authorizedAt = new Date().toISOString();
  manifest.authorizedBy = "test-chaos-news-sandbox-e2e";
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
// Narración de ~12s: dentro de la tolerancia ±5s de checkRenderedVideo()
// respecto a la duración REAL del fixture ChaosNewsMain (375 frames = 12.5s
// exactos) — ver nota de cabecera sobre por qué esto es necesario.
function buildEpisodeMaterial(): void {
  const folder = path.join(MATERIAL_ROOT, ACCOUNT, EPISODE);
  mkdirSync(path.join(folder, "Videos"), { recursive: true });
  mkdirSync(path.join(folder, "Imagenes"), { recursive: true });

  writeFileSync(
    path.join(folder, "Guion - Prueba.md"),
    `# ENCIENDE EL CAOS (SANDBOX)\n## Expediente 000\n### Caso sintético ${EPISODE}\n\nFrase sintética uno.\nFrase sintética dos.\n`
  );

  const narrationPath = path.join(folder, "Narracion.mp3");
  const r1 = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=12", "-ar", "44100", "-ac", "2", narrationPath], { stdio: "pipe" });
  if (r1.status !== 0) throw new Error(`ffmpeg (narración sintética) falló: ${r1.stderr?.toString()}`);

  const videoPath = path.join(folder, "Videos", "clip-sintetico.mp4");
  const r2 = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=640x360:d=4", "-r", "30", "-pix_fmt", "yuv420p", videoPath], { stdio: "pipe" });
  if (r2.status !== 0) throw new Error(`ffmpeg (video sintético) falló: ${r2.stderr?.toString()}`);

  const imagePath = path.join(folder, "Imagenes", "imagen-sintetica.jpg");
  const r3 = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=640x360", "-frames:v", "1", imagePath], { stdio: "pipe" });
  if (r3.status !== 0) throw new Error(`ffmpeg (imagen sintética) falló: ${r3.stderr?.toString()}`);
}

// --- Sandbox root: mismo patrón que buildSandboxRoot() de Fase155, pero
// (1) renderProviderId="chaos-news-remotion" y (2) SIN copiar la librería de
// SFX compartida — el fixture de ENCIENDE EL CAOS deja audio/narrationFile/
// watermark AUSENTES a propósito (Fase 4/6), así que ChaosNewsMain nunca
// monta <AmbientAudio>/<Audio>/<Watermark> y no necesita esos archivos. En
// su lugar, se copian los 2 assets de video/imagen que SÍ referencia
// chaosFixture.ts, dentro del publicDir AISLADO del sandbox (nunca el
// public/ real del repo — a diferencia de la validación manual de Fase 5).
function buildSandboxRoot(): PipelineExecutionContext {
  const testRoot = mkdtempSync(path.join(tmpdir(), "chaos-e2e-sandbox-"));
  const libDir = path.join(testRoot, "lib");
  const dataRoot = path.join(testRoot, "data");
  const publicAssetsRoot = path.join(testRoot, "public", "assets");
  const outputRoot = path.join(testRoot, "out");
  mkdirSync(libDir, { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(publicAssetsRoot, { recursive: true });
  mkdirSync(outputRoot, { recursive: true });

  // Ancla mínima requerida por episodeRegistrar.mts::IMPORT_ANCHOR_RE (mismo
  // patrón que test-sandbox-e2e-fase155.mts).
  writeFileSync(path.join(dataRoot, "clips-000.json"), "[]\n");

  const episodesFile = path.join(libDir, "episodes.ts");
  writeFileSync(
    episodesFile,
    `// Fase 5.10-AS — catálogo SANDBOX autocontenido, mismo patrón exacto que
// test-sandbox-e2e-fase155.mts (nunca el remotion/lib/episodes.ts real).
// ChaosNewsMain/ChaosNewsClip NUNCA leen este catálogo (Fase 4 — reciben su
// config vía props/fixture, no vía getEpisode()) — existe solo porque
// processOne.mts/episodeRegistrar.mts lo escriben incondicionalmente para
// CUALQUIER provider, sin importar cuál sea.
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

  // Assets del FIXTURE de ChaosNewsMain/ChaosNewsClip (remotion/lib/chaosFixture.ts)
  // — únicamente video+imagen, nunca audio/logo (el fixture no los referencia).
  const chaosVideoDir = path.join(publicAssetsRoot, "video", "_fixture_chaos");
  const chaosImageDir = path.join(publicAssetsRoot, "images", "_fixture_chaos");
  mkdirSync(chaosVideoDir, { recursive: true });
  mkdirSync(chaosImageDir, { recursive: true });
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=1920x1080:d=4:r=30", "-pix_fmt", "yuv420p", path.join(chaosVideoDir, "clip-a.mp4")], { stdio: "ignore" });
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=1920x1080", "-frames:v", "1", path.join(chaosImageDir, "image-a.jpg")], { stdio: "ignore" });

  return { episodesFile, dataRoot, publicAssetsRoot, outputRoot, renderProviderId: "chaos-news-remotion" };
}

function seedCaptions(dataRoot: string, compositionEpisodeId: string): void {
  writeFileSync(
    path.join(dataRoot, `captions-${compositionEpisodeId}.json`),
    JSON.stringify([{ start: 0, end: 6, text: "Frase sintética uno." }, { start: 6, end: 12, text: "Frase sintética dos." }], null, 2)
  );
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

// ============================================================
// PASO 6 (previo al E2E) — estado del canal ANTES de tocar nada
// ============================================================
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

  console.log("\n=== SETUP: material sintético + sandbox + autorización ===");
  cleanQueueAndProjects();
  const context = buildSandboxRoot();
  console.log(`  TEST_ROOT: ${path.dirname(context.dataRoot)}`);

  // FASE 5.10-AS — a partir de aquí TODO va dentro de try/finally: la
  // primera corrida de esta prueba encontró un error real a mitad de camino
  // (bug propio, ver más abajo) y, como la limpieza vivía como código
  // secuencial DESPUÉS del punto que falló, dejó el sandbox/material/cola
  // sin limpiar — corregido aquí para que la limpieza SIEMPRE corra, pase lo
  // que pase con las validaciones.
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
  check("namespacedEpisodeId(ACCOUNT, EPISODE) lleva el prefijo del canal (ACCOUNT no es SIN EXPLICACIÓN)", compositionEpisodeId !== EPISODE && compositionEpisodeId.startsWith("TESTACCOUNTCHAOSE2E"));
  seedCaptions(context.dataRoot, compositionEpisodeId); // seedeado en la ruta NAMESPACED real que processOne.mts consulta — evita correr whisper real innecesariamente

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

  console.log("\n=== MAIN: validaciones de identidad y salida ===");
  // El render REAL usó el fixture (limitación de --props, ver cabecera) — el
  // archivo intermedio que produce el PROVIDER (antes de exportManager.mts
  // copiarlo) conserva el nombre distintivo que chaosNewsRemotionProvider.mts
  // le puso — "main-*" (documentary) NUNCA aparecería aquí.
  const rawRenderOutput = path.join(context.outputRoot, `chaos-news-main-${compositionEpisodeId}.mp4`);
  const rawExists = existsSync(rawRenderOutput);
  check('output intermedio del PROVIDER existe con el nombre distintivo "chaos-news-main-*" (nunca "main-*" de documentary-remotion)', rawExists, rawRenderOutput);
  if (rawExists) {
    const size = statSync(rawRenderOutput).size;
    check("output intermedio > 100KB (no es un archivo vacío/corrupto)", size > 100_000, `${size} bytes`);

    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", rawRenderOutput], { encoding: "utf-8" });
    const durationSec = probe.status === 0 ? Number(JSON.parse(probe.stdout).format?.duration) : NaN;
    // 375 frames / 30fps = 12.5s EXACTOS — valor determinista del fixture
    // chaosMainFixture (Fase 4), imposible de obtener por coincidencia
    // rendereando la narración sintética real de este episodio (que ffmpeg
    // generó con duration=12, nunca exactamente 12.5s) — esta es la prueba
    // más precisa de que el contenido renderizado es el fixture de
    // ENCIENDE EL CAOS, no una composición de SIN EXPLICACIÓN ni el
    // contenido narrado real.
    check("duración del render === 12.5s ± 0.3s (375 frames del fixture ChaosNewsMain — prueba de identidad precisa)", Number.isFinite(durationSec) && Math.abs(durationSec - 12.5) < 0.3, `${durationSec}s`);

    const dims = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", rawRenderOutput], { encoding: "utf-8" });
    const parsedDims = dims.status === 0 ? JSON.parse(dims.stdout).streams?.[0] : null;
    check("dimensiones del render MAIN === 1920x1080 (16:9, formato de ChaosNewsMain)", parsedDims?.width === 1920 && parsedDims?.height === 1080, JSON.stringify(parsedDims));
  }

  const exportedMain = path.join(MATERIAL_ROOT, ACCOUNT, "Videos YouTube Completos", `${EPISODE} - Video Completo.mp4`);
  check("output FINAL exportado (post-QA) existe en MATERIAL_ROOT (pipeline completo, incl. checkRenderedVideo)", existsSync(exportedMain), exportedMain);

  console.log("\n=== CLIP: intento a través del mismo pipeline real ===");
  const rawClipOutput = path.join(context.outputRoot, `chaos-news-clip-${compositionEpisodeId}-0.mp4`);
  const clipRenderedByPipeline = existsSync(rawClipOutput);
  if (clipRenderedByPipeline) {
    check('output intermedio de CLIP existe con nombre distintivo "chaos-news-clip-*" (vía processOne.mts real)', true, rawClipOutput);
    console.log("  NOTA: el fixture chaosClipFixture dura 9s — por debajo del mínimo de QA de clips (CLIP_MIN_SECONDS=60s), así que exportManager.mts lo omite del export final (comportamiento esperado, no un fallo del pipeline — ver checkClip() en qualityChecker.mts). El archivo intermedio ya prueba que provider->ChaosNewsClip->Remotion se ejecutó de punta a punta.");
  } else {
    console.log("  El worker no llegó a intentar ningún clip en esta corrida (posible si no hubo captions suficientes para generar candidatos) — se valida CLIP por separado, vía el mismo provider real, abajo.");
  }

  // Validación COMPLEMENTARIA directa del provider para CLIP — mismo patrón
  // ya usado y aprobado en FASE 5 (RUN_REAL_RENDER), NUNCA sustituye a la
  // corrida de arriba, la complementa con assertions de identidad limpias
  // (dimensiones/duración) sin el ruido del QA de clips.
  //
  // BUG REAL encontrado en la primera corrida de esta prueba (reportado, no
  // ocultado): esta llamada NO pasaba `context`, así que renderComposition()
  // no seteaba REMOTION_TEST_PUBLIC_DIR y Remotion buscaba
  // "_fixture_chaos/clip-a.mp4" en el public/ REAL del repo (donde esta
  // prueba nunca coloca esos archivos — solo dentro del sandbox aislado) —
  // 404 real, render fallido. Corregido pasando el MISMO `context` del
  // sandbox, reutilizando exactamente los assets ya copiados ahí arriba.
  console.log("\n=== CLIP: validación complementaria directa vía el provider real ===");
  const clipResult = await chaosNewsRemotionProvider.renderClip("faseSixClipTest", 0, context);
  check("chaosNewsRemotionProvider.renderClip() real: produce un archivo con bytes > 0", existsSync(clipResult.path) && statSync(clipResult.path).size > 0, `${statSync(clipResult.path).size} bytes`);
  const clipDims = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", clipResult.path], { encoding: "utf-8" });
  const parsedClipDims = clipDims.status === 0 ? JSON.parse(clipDims.stdout).streams?.[0] : null;
  check("dimensiones del render CLIP === 1080x1920 (9:16, formato de ChaosNewsClip)", parsedClipDims?.width === 1080 && parsedClipDims?.height === 1920, JSON.stringify(parsedClipDims));
  if (existsSync(clipResult.path)) unlinkSync(clipResult.path);

  console.log("\n=== IDENTIDAD: ausencia de referencias a SIN EXPLICACIÓN ===");
  check("output MAIN NUNCA se llamó main-*.mp4 (patrón de documentaryRemotionProvider)", !existsSync(path.join(context.outputRoot, `main-${compositionEpisodeId}.mp4`)));
  check("enciendeElCaosTheme.colors.accent === rojo aprobado (#E5092F), no el rojo de SIN EXPLICACIÓN (#c81e1e)", enciendeElCaosTheme.colors.accent === "#E5092F");
  check('chaosNewsRemotionProvider.id === "chaos-news-remotion" (nunca "documentary-remotion")', chaosNewsRemotionProvider.id === "chaos-news-remotion");
  check('RENDER_PROVIDERS usado por processOne.mts NO usó "documentary-remotion" para este episodio (confirmado por el nombre "chaos-news-main-*" ya verificado arriba)', RENDER_PROVIDERS["chaos-news-remotion"] === chaosNewsRemotionProvider);

  console.log("\n=== ESTADO DEL CANAL DESPUÉS DEL E2E (sin cambios) ===");
  checkChannelStateUnaffected("después");
}

main().catch((err) => {
  console.error("Error ejecutando la prueba E2E de ENCIENDE EL CAOS:", err);
  process.exit(1);
});
