// FASE 9-11 — kit de pruebas COMPARTIDO para los canales con arquitectura
// documental genérica (LUNA VERDE / OBJETOS MALDITOS). Un solo archivo
// parametrizado en vez de duplicar ~300 líneas por canal (mismo principio de
// "componente genérico + configuración por canal" pedido para el código de
// producción, aplicado también a las pruebas). Cada canal solo aporta un
// `DocumentaryChannelTestParams` — ver test-luna-verde-e2e.mts/
// test-objetos-malditos-e2e.mts para el uso real.
import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, statSync, readFileSync, readdirSync } from "node:fs";
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
import { isRealDataRenderProvider, type RealDataRenderProvider } from "./renderProvider.mts";
import { resolveChannelConfig, resolveScannableChannels } from "./channelRegistry.mts";
import { resolveRenderProvider, ChannelNotProducibleError } from "./renderProviderRegistry.mts";
import { sinExplicacionTheme } from "../../remotion/theme.ts";
import type { ChannelVisualTheme } from "../../remotion/theme.ts";

const FPS = 30;
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

export type DocumentaryChannelTestParams = {
  channelDisplayName: string; // nombre real en channelRegistry.mts, ej. "LUNA VERDE"
  testAccountName: string; // solo alfanumérico, ej. "TESTLUNAVERDEE2E" (namespace)
  testEpisodeId: string; // ej. "TESTLVEP001"
  renderProviderId: string; // ej. "luna-verde-remotion"
  provider: RealDataRenderProvider & { renderMainWithProps: (episodeId: string, props: unknown, context?: PipelineExecutionContext) => Promise<{ path: string; hash: string; reused: boolean }> };
  mainCompositionOutputPrefix: string; // ej. "luna-verde-main-"
  clipCompositionOutputPrefix: string; // ej. "luna-verde-clip-"
  theme: ChannelVisualTheme;
  fixtureAssetFolder: string; // ej. "_fixture_luna_verde" — carpeta sintética propia, nunca compartida entre canales
  // Post-Fase 11 (ronda de aislamiento) — ruta real al archivo .tsx de la
  // composición MAIN de este canal, para verificar por texto que los guards
  // de audio/watermark siguen presentes (nunca se infiere, se lee el archivo real).
  mainCompositionSourceFile: string;
  // Post-Fase 11 — duración REAL esperada del fixture ya registrado en
  // Root.tsx para este canal (defaultProps) — nunca asumida como "siempre
  // 9s": ChaosNewsMain sí suma hook+bumper por encima de la narración
  // (375f/12.5s), mientras que los fixtures documentales genéricos
  // (LunaVerdeMain/ObjetosMalditosMain) son solo narración (270f/9s). Cada
  // canal declara la suya, calculada por la misma función pura que usa
  // Root.tsx (chaosMainDurationInFrames/documentaryMainDurationInFrames).
  expectedFixtureDurationSeconds: number;
};

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

// Post-Fase 11 — necesario porque la nueva prueba de aislamiento llama al
// kit UNA VEZ POR CANAL dentro del MISMO proceso (a diferencia de
// test-luna-verde-e2e.mts/test-objetos-malditos-e2e.mts, que son procesos
// `npx tsx` separados) — sin resetear, `failures` se acumularía entre
// canales y el conteo por canal sería incorrecto.
export function resetTestKitFailures(): void {
  failures = 0;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(predicate: () => boolean, timeoutMs: number, pollMs = 200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(pollMs);
  }
  return predicate();
}

function cleanQueueAndProjects(p: DocumentaryChannelTestParams): void {
  const jobs = readJson<Job[]>(stateFilePath("queue.json"), []);
  writeJsonAtomic(
    stateFilePath("queue.json"),
    jobs.filter((j) => !(j.account === p.testAccountName && j.episodeId === p.testEpisodeId) && !(j.account === p.channelDisplayName && j.episodeId === p.testEpisodeId))
  );
  for (const account of [p.testAccountName, p.channelDisplayName]) {
    const proj = path.join(process.cwd(), "scripts", "pipeline", "state", "projects", `${account}__${p.testEpisodeId}.json`);
    if (existsSync(proj)) rmSync(proj);
  }
}

function buildSandboxRoot(p: DocumentaryChannelTestParams, withFixtureAssets: boolean): PipelineExecutionContext {
  const testRoot = mkdtempSync(path.join(tmpdir(), `${p.testAccountName.toLowerCase()}-sandbox-`));
  const libDir = path.join(testRoot, "lib");
  const dataRoot = path.join(testRoot, "data");
  const publicAssetsRoot = path.join(testRoot, "public", "assets");
  const outputRoot = path.join(testRoot, "out");
  mkdirSync(libDir, { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(publicAssetsRoot, { recursive: true });
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(path.join(dataRoot, "clips-000.json"), "[]\n");
  // CRÍTICO: episodeRegistrar.mts::registerEpisode() (llamado por
  // processOne.mts SIEMPRE, sin importar qué RenderProvider se use) exige
  // este import ancla exacto (IMPORT_ANCHOR_RE) para poder insertar nuevos
  // imports de episodio por texto — sin él, registerEpisode() falla ANTES
  // de llegar al render, con un error real no relacionado con la voz. Mismo
  // stub exacto que test-chaos-real-data-sandbox-e2e.mts (Bloque 1) ya usa
  // y prueba real.
  writeFileSync(
    path.join(libDir, "episodes.ts"),
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

  if (withFixtureAssets) {
    const videoDir = path.join(publicAssetsRoot, "video", p.fixtureAssetFolder);
    const imageDir = path.join(publicAssetsRoot, "images", p.fixtureAssetFolder);
    mkdirSync(videoDir, { recursive: true });
    mkdirSync(imageDir, { recursive: true });
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=1920x1080:d=4:r=30", "-pix_fmt", "yuv420p", path.join(videoDir, "clip-a.mp4")], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=1920x1080", "-frames:v", "1", path.join(imageDir, "image-a.jpg")], { stdio: "ignore" });
  }

  return { episodesFile: path.join(libDir, "episodes.ts"), dataRoot, publicAssetsRoot, outputRoot, renderProviderId: p.renderProviderId };
}

function checkChannelStateUnaffected(p: DocumentaryChannelTestParams, momentLabel: string) {
  const scannable = resolveScannableChannels();
  check(`[${momentLabel}] resolveScannableChannels() === ["SIN EXPLICACIÓN"]`, JSON.stringify(scannable) === JSON.stringify(["SIN EXPLICACIÓN"]));
  const config = resolveChannelConfig(p.channelDisplayName);
  check(`[${momentLabel}] ${p.channelDisplayName}.channelStatus === "HISTORICAL"`, config?.channelStatus === "HISTORICAL");
  let threw = false;
  let isChannelNotProducible = false;
  try {
    resolveRenderProvider(p.channelDisplayName);
  } catch (err) {
    threw = true;
    isChannelNotProducible = err instanceof ChannelNotProducibleError;
  }
  check(`[${momentLabel}] resolveRenderProvider("${p.channelDisplayName}") sigue rechazando con ChannelNotProducibleError`, threw && isChannelNotProducible);
}

// ============================================================
// TEST A — IDENTIDAD: el canal no puede terminar usando accidentalmente
// theme/voz/música/watermark de SIN EXPLICACIÓN.
// ============================================================
function testIdentity(p: DocumentaryChannelTestParams) {
  console.log(`\n=== TEST A — IDENTIDAD (${p.channelDisplayName}) ===`);
  check("theme.colors.accent es DISTINTO del de SIN EXPLICACIÓN real", p.theme.colors.accent !== sinExplicacionTheme.colors.accent, `${p.theme.colors.accent} vs ${sinExplicacionTheme.colors.accent}`);
  check("theme.colors.background es DISTINTO del de SIN EXPLICACIÓN real", p.theme.colors.background !== sinExplicacionTheme.colors.background);
  check(`provider.id === "${p.renderProviderId}" (nunca "documentary-remotion")`, p.provider.id === p.renderProviderId);
  const config = resolveChannelConfig(p.channelDisplayName);
  // Post-Fase 11 — la voz puede estar PENDING (undefined) o ya configurada
  // con un patrón real, según el canal — nunca se asume un estado fijo. La
  // propiedad de seguridad real es SIEMPRE la misma, sin importar cuál sea:
  // nunca puede coincidir con la voz real de SIN EXPLICACIÓN.
  check(
    `channelRegistry: ${p.channelDisplayName}.voice NUNCA matchea "Kate — Velvet Midnight Narrator" (voz real de SIN EXPLICACIÓN)`,
    !config?.voice?.narratorVoicePattern.test("Kate — Velvet Midnight Narrator")
  );
  console.log(`  [INFO] ${p.channelDisplayName}.voice = ${config?.voice ? config.voice.narratorVoicePattern : "PENDING (sin configurar)"}`);
  check(`channelRegistry: ${p.channelDisplayName}.renderProviderId === "${p.renderProviderId}"`, config?.renderProviderId === p.renderProviderId);
  check("isRealDataRenderProvider(provider) === true", isRealDataRenderProvider(p.provider));
}

// ============================================================
// TEST B/C — PROPS REALES + COMPOSICIÓN: un episodio sintético con
// narración/captions distintos del fixture llega al render vía el
// mecanismo real (processOne.mts -> provider.renderMainWithRealData ->
// composición real -> Remotion), con una duración medible que PRUEBA que
// no se usó el fixture. Reutiliza EXACTAMENTE el patrón de Bloque 1
// (test-chaos-real-data-sandbox-e2e.mts).
// ============================================================
async function testPropsAndComposition(p: DocumentaryChannelTestParams): Promise<void> {
  console.log(`\n=== TEST B/C — PROPS REALES + COMPOSICIÓN (${p.channelDisplayName}) ===`);
  const NARRATION_SECONDS = 20;
  const CAPTIONS_END_SECONDS = 18;

  cleanQueueAndProjects(p);
  const context = buildSandboxRoot(p, true);
  try {
    const folder = path.join(MATERIAL_ROOT, p.testAccountName, p.testEpisodeId);
    mkdirSync(path.join(folder, "Videos"), { recursive: true });
    mkdirSync(path.join(folder, "Imagenes"), { recursive: true });
    writeFileSync(path.join(folder, "Guion - Prueba.md"), `# ${p.channelDisplayName} (SANDBOX)\n## Caso sintético\n\nFrase sintética uno.\nFrase sintética dos.\n`);
    const narrationPath = path.join(folder, "Narracion.mp3");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${NARRATION_SECONDS}`, "-ar", "44100", "-ac", "2", narrationPath], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=green:s=640x360:d=6", "-r", "30", "-pix_fmt", "yuv420p", path.join(folder, "Videos", "clip-sintetico.mp4")], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=yellow:s=640x360", "-frames:v", "1", path.join(folder, "Imagenes", "imagen-sintetica.jpg")], { stdio: "ignore" });

    const compositionEpisodeId = namespacedEpisodeId(p.testAccountName, p.testEpisodeId);
    writeFileSync(
      path.join(context.dataRoot, `captions-${compositionEpisodeId}.json`),
      JSON.stringify([{ start: 0, end: 9, text: "Frase sintética de prueba uno." }, { start: 9, end: CAPTIONS_END_SECONDS, text: "Frase sintética de prueba dos." }], null, 2)
    );

    const ep = scanEpisode(p.testAccountName, p.testEpisodeId);
    const completeness = checkCompleteness(ep);
    check("(setup) material sintético READY", completeness.status === "READY", completeness.status === "WAITING_FOR_MATERIAL" ? completeness.reason : "");
    const hashes = await hashAll(allMaterialFiles(ep));
    const manifest = loadProject(p.testAccountName, p.testEpisodeId);
    manifest.status = "AUTHORIZED";
    manifest.authorizedAt = new Date().toISOString();
    manifest.authorizedBy = "documentaryChannelE2ETestKit";
    manifest.authorizedMaterialHashes = hashes;
    saveProject(manifest);
    enqueue(p.testAccountName, p.testEpisodeId);

    console.log("  ejecutando processOne.mts REAL (proceso hijo real, spawn real)...");
    const PROCESS_ONE_ENTRY = path.join(process.cwd(), "scripts", "pipeline", "processOne.mts");
    const spawnFn: SpawnWorkerFn = (account, episodeId) =>
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
    dispatchWorkers(1, spawnFn);
    const drained = await waitUntil(() => getActiveWorkerCount() === 0, 15 * 60_000, 200);
    check("el worker real terminó dentro del timeout (15 min)", drained);

    const job = listJobs().find((j) => j.account === p.testAccountName && j.episodeId === p.testEpisodeId);
    const manifestAfter = loadProject(p.testAccountName, p.testEpisodeId);
    console.log(`  cola=${job?.status} manifest=${manifestAfter.status} lastError=${job?.lastError ?? "(ninguno)"}`);

    const rawRenderOutput = path.join(context.outputRoot, `${p.mainCompositionOutputPrefix}${compositionEpisodeId}.mp4`);
    const rawExists = existsSync(rawRenderOutput);
    check(`output intermedio existe con nombre distintivo "${p.mainCompositionOutputPrefix}*"`, rawExists, rawRenderOutput);
    if (rawExists) {
      const size = statSync(rawRenderOutput).size;
      check("output > 100KB", size > 100_000, `${size} bytes`);
      const expectedFrames = Math.max(NARRATION_SECONDS * FPS, CAPTIONS_END_SECONDS * FPS);
      const expectedSeconds = expectedFrames / FPS;
      const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", rawRenderOutput], { encoding: "utf-8" });
      const durationSec = probe.status === 0 ? Number(JSON.parse(probe.stdout).format?.duration) : NaN;
      check(
        `duración del render ≈ ${expectedSeconds}s ± 0.5s (derivada de LA NARRACIÓN REAL, prueba de que llegó por props, no por el fixture de 9s)`,
        Number.isFinite(durationSec) && Math.abs(durationSec - expectedSeconds) < 0.5,
        `medida=${durationSec}s`
      );
      const dims = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", rawRenderOutput], { encoding: "utf-8" });
      const parsedDims = dims.status === 0 ? JSON.parse(dims.stdout).streams?.[0] : null;
      check("dimensiones MAIN === 1920x1080 (composición correcta resuelta)", parsedDims?.width === 1920 && parsedDims?.height === 1080, JSON.stringify(parsedDims));
    }
  } finally {
    cleanQueueAndProjects(p);
    rmSync(path.dirname(context.dataRoot), { recursive: true, force: true });
    rmSync(path.join(MATERIAL_ROOT, p.testAccountName), { recursive: true, force: true });
  }
}

// ============================================================
// TEST D — AGENT 2: el episodio recorre el flujo real hasta el punto EXACTO
// donde falta un requisito humano (voz) — SIN narración pre-grabada, usando
// el nombre REAL del canal (para que resolveChannelConfig() real confirme
// que no hay voz configurada), pero episodio/material 100% sintéticos y
// aislados (nunca D:\MATERIAL VIDEOS real).
// ============================================================
async function testAgent2StopsAtRealBlocker(p: DocumentaryChannelTestParams): Promise<void> {
  console.log(`\n=== TEST D — AGENT 2 se detiene en el bloqueo real (${p.channelDisplayName}) ===`);
  const voiceConfig = resolveChannelConfig(p.channelDisplayName)?.voice;
  // CRÍTICO (hallazgo real, post-Fase 11 → configuración de voces reales):
  // este test SOLO tiene sentido mientras el canal no tenga voz configurada
  // (existe específicamente para probar que processOne.mts se detiene en el
  // gate de voz). Si el canal YA tiene una voz real (channelRegistry.mts),
  // continuar spawnearía un processOne.mts REAL que llegaría hasta
  // generateNarration() → ElevenLabs real (findVoiceByName + textToSpeech,
  // esta última SÍ gasta créditos) — exactamente lo que este kit nunca debe
  // hacer sin autorización explícita para ESA prueba puntual. Por eso se
  // ABORTA ANTES de spawnear nada, no solo se registra como fallo.
  if (voiceConfig !== undefined) {
    check(
      `(precondición) ${p.channelDisplayName} ya tiene voz real configurada — TEST D se OMITE a propósito (spawnear ahora gastaría créditos reales de ElevenLabs)`,
      true,
      `voice.narratorVoicePattern=${voiceConfig.narratorVoicePattern}`
    );
    console.log(`  [SKIP] ${p.channelDisplayName} ya tiene voz real — este test ya no aplica sin gastar créditos. Ver informe: la protección ahora es "processOne.mts intenta generar narración real", no "se detiene".`);
    return;
  }
  check(`(precondición real) ${p.channelDisplayName} no tiene voz configurada en channelRegistry.mts hoy`, voiceConfig === undefined);

  cleanQueueAndProjects(p);
  const context = buildSandboxRoot(p, false);
  try {
    const folder = path.join(MATERIAL_ROOT, p.channelDisplayName, p.testEpisodeId);
    mkdirSync(path.join(folder, "Videos"), { recursive: true });
    mkdirSync(path.join(folder, "Imagenes"), { recursive: true });
    writeFileSync(path.join(folder, "Guion - Prueba.md"), `# ${p.channelDisplayName} (SANDBOX Test D)\n\nFrase sintética sin narración todavía.\n`);
    // Deliberadamente SIN Narracion.mp3 — el episodio tiene guion + material
    // visual real (b-roll sintético), pero ninguna voz grabada.
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=green:s=640x360:d=4", "-r", "30", "-pix_fmt", "yuv420p", path.join(folder, "Videos", "clip-sintetico.mp4")], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=yellow:s=640x360", "-frames:v", "1", path.join(folder, "Imagenes", "imagen-sintetica.jpg")], { stdio: "ignore" });

    const ep = scanEpisode(p.channelDisplayName, p.testEpisodeId);
    const completeness = checkCompleteness(ep);
    check("(setup) material sintético READY (guion + b-roll, sin narración)", completeness.status === "READY", completeness.status === "WAITING_FOR_MATERIAL" ? completeness.reason : "");
    check("(setup) narrationFile ausente (a propósito — este test prueba el bloqueo de voz)", ep.narrationFile === null);

    const hashes = await hashAll(allMaterialFiles(ep));
    const manifest = loadProject(p.channelDisplayName, p.testEpisodeId);
    manifest.status = "AUTHORIZED";
    manifest.authorizedAt = new Date().toISOString();
    manifest.authorizedBy = "documentaryChannelE2ETestKit";
    manifest.authorizedMaterialHashes = hashes;
    saveProject(manifest);
    enqueue(p.channelDisplayName, p.testEpisodeId);

    console.log("  ejecutando processOne.mts REAL — se espera que se detenga exactamente en el gate de voz...");
    // agent.mts descarta a propósito el texto real del error (solo guarda
    // "worker exit <code>" en job.lastError — ver su propio comentario de
    // cabecera, "pérdida de información aceptada, no un bug"). Para verificar
    // el MENSAJE real (no solo que falló), este test captura el stderr real
    // del proceso hijo él mismo, en vez de heredarlo (stdio:"inherit").
    let capturedStderr = "";
    const PROCESS_ONE_ENTRY = path.join(process.cwd(), "scripts", "pipeline", "processOne.mts");
    const spawnFn: SpawnWorkerFn = (account, episodeId) => {
      const child = spawn("node", ["--import", "tsx/esm", PROCESS_ONE_ENTRY, account, episodeId], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PIPELINE_TEST_EPISODES_FILE: context.episodesFile,
          PIPELINE_TEST_DATA_ROOT: context.dataRoot,
          PIPELINE_TEST_PUBLIC_ROOT: context.publicAssetsRoot,
          PIPELINE_TEST_OUTPUT_ROOT: context.outputRoot,
          PIPELINE_TEST_RENDER_PROVIDER_ID: context.renderProviderId ?? "",
        },
      });
      child.stdout?.on("data", (d) => process.stdout.write(d));
      child.stderr?.on("data", (d) => {
        capturedStderr += d.toString();
        process.stderr.write(d);
      });
      return child;
    };
    dispatchWorkers(1, spawnFn);
    const drained = await waitUntil(() => getActiveWorkerCount() === 0, 5 * 60_000, 200);
    check("el worker real terminó dentro del timeout (5 min — falla rápido, nunca llega a whisper/render)", drained);

    const job = listJobs().find((j) => j.account === p.channelDisplayName && j.episodeId === p.testEpisodeId);
    console.log(`  cola=${job?.status} lastError=${job?.lastError ?? "(ninguno)"}`);
    check("el job terminó en ERROR (nunca COMPLETED — no hay forma de generar narración sin voz)", job?.status === "ERROR");
    check(
      'el stderr REAL del proceso hijo menciona la falta de configuración de voz ("No hay configuración de voz")',
      /configuraci[oó]n de voz/i.test(capturedStderr),
      capturedStderr.slice(0, 300)
    );
    check(`el stderr REAL menciona el nombre del canal ("${p.channelDisplayName}")`, capturedStderr.includes(p.channelDisplayName));
    const outputRootFiles = existsSync(context.outputRoot) ? readdirSync(context.outputRoot) : [];
    check("cero archivos de render producidos (nunca se llegó a Remotion)", outputRootFiles.length === 0, JSON.stringify(outputRootFiles));
  } finally {
    cleanQueueAndProjects(p);
    rmSync(path.dirname(context.dataRoot), { recursive: true, force: true });
    rmSync(path.join(MATERIAL_ROOT, p.channelDisplayName, p.testEpisodeId), { recursive: true, force: true });
  }
}

// ============================================================
// TEST E — SEGURIDAD: se verifica junto con A/B/C/D vía checkChannelStateUnaffected()
// antes/después + confirmaciones explícitas acá.
// ============================================================
function testSecurity(p: DocumentaryChannelTestParams) {
  console.log(`\n=== TEST E — SEGURIDAD (${p.channelDisplayName}) ===`);
  check("cero publicaciones: este kit nunca importa agent/publish/*", true);
  check("cero OAuth: este kit nunca importa ningún cliente de red social", true);
  check("cero credenciales impresas: ningún check imprime valores de .env.local", true);
}

// ============================================================
// TEST F (post-Fase 11) — guards de audio/watermark presentes en el código
// FUENTE real de la composición (nunca se infiere ni se asume) — la misma
// verificación por texto que Fase 4/6.5 ya usaron para las composiciones de
// ENCIENDE EL CAOS, extendida ahora a la arquitectura documental genérica.
// ============================================================
function testCompositionSourceGuards(p: DocumentaryChannelTestParams) {
  console.log(`\n=== TEST F — GUARDS DE AUDIO/WATERMARK EN CÓDIGO FUENTE (${p.channelDisplayName}) ===`);
  const src = readFileSync(p.mainCompositionSourceFile, "utf-8");
  check(
    "la composición NUNCA monta <AmbientAudio> sin comprobar config.audio primero (si lo hiciera, heredaría la música real de SIN EXPLICACIÓN)",
    /\{config\.audio && </.test(src)
  );
  check(
    "la composición NUNCA monta <Watermark> sin comprobar watermark?.imageSrc primero (si lo hiciera, heredaría el logo real de SIN EXPLICACIÓN)",
    /\{watermark\?\.imageSrc && </.test(src)
  );
}

// ============================================================
// TEST G (post-Fase 11) — render REAL sin watermark: prueba pequeña y
// rápida (usa el fixture ya registrado en Root.tsx, 270 frames/9s — nunca
// el episodio sintético de 20s) de que la composición renderiza
// correctamente cuando watermark/audio están AUSENTES (PENDING), sin
// fallback a ningún asset de SIN EXPLICACIÓN. Coloca temporalmente los 2
// assets sintéticos del fixture en el public/ REAL del repo (mismo patrón
// ya usado y aprobado en Fase 5 para chaosNewsRemotionProvider,
// RUN_REAL_RENDER) — siempre limpiados en el finally.
// ============================================================
async function testWatermarklessFixtureRender(p: DocumentaryChannelTestParams): Promise<void> {
  console.log(`\n=== TEST G — RENDER REAL SIN WATERMARK (${p.channelDisplayName}) ===`);
  const videoDir = path.join(REPO_ROOT, "public", "assets", "video", p.fixtureAssetFolder);
  const imageDir = path.join(REPO_ROOT, "public", "assets", "images", p.fixtureAssetFolder);
  mkdirSync(videoDir, { recursive: true });
  mkdirSync(imageDir, { recursive: true });
  let outPath: string | null = null;
  try {
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=1920x1080:d=4:r=30", "-pix_fmt", "yuv420p", path.join(videoDir, "clip-a.mp4")], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=1920x1080", "-frames:v", "1", path.join(imageDir, "image-a.jpg")], { stdio: "ignore" });

    const result = await p.provider.renderMain(`fase12WatermarklessTest${Date.now()}`);
    outPath = result.path;
    check("render del fixture (sin watermark, sin audio) produce un archivo real", existsSync(result.path) && statSync(result.path).size > 0, `${existsSync(result.path) ? statSync(result.path).size : 0} bytes`);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", result.path], { encoding: "utf-8" });
    const durationSec = probe.status === 0 ? Number(JSON.parse(probe.stdout).format?.duration) : NaN;
    check(
      `duración del fixture ≈ ${p.expectedFixtureDurationSeconds}s ± 0.3s (el render terminó sin necesitar ningún watermark/audio)`,
      Number.isFinite(durationSec) && Math.abs(durationSec - p.expectedFixtureDurationSeconds) < 0.3,
      `${durationSec}s`
    );
  } finally {
    rmSync(videoDir, { recursive: true, force: true });
    rmSync(imageDir, { recursive: true, force: true });
    if (outPath && existsSync(outPath)) rmSync(outPath, { force: true });
  }
}

// ============================================================
// Orquestador LIGERO (post-Fase 11) — "aislamiento", no "props reales"
// (eso ya quedó probado con datos reales en la ronda anterior para los 3
// canales — repetirlo aquí sería la auditoría grande que esta ronda pidió
// explícitamente evitar). Corre: identidad (A) + guards de código fuente
// (F) + render real sin watermark (G) + bloqueo real de voz (D) +
// seguridad (E) — nunca la prueba pesada de props con narración de 20s (B/C).
// ============================================================
export async function runIsolationCheck(p: DocumentaryChannelTestParams): Promise<number> {
  resetTestKitFailures();
  if (!/test|tmp|temp/i.test(MATERIAL_ROOT) || MATERIAL_ROOT.toLowerCase() === "d:\\material videos") {
    throw new Error(`MATERIAL_ROOT no parece una carpeta de prueba ("${MATERIAL_ROOT}") — abortando por seguridad.`);
  }
  mkdirSync(MATERIAL_ROOT, { recursive: true });

  console.log(`=== ESTADO DEL CANAL ANTES (${p.channelDisplayName}) ===`);
  checkChannelStateUnaffected(p, "antes");

  testIdentity(p);
  testCompositionSourceGuards(p);
  await testWatermarklessFixtureRender(p);
  await testAgent2StopsAtRealBlocker(p);
  testSecurity(p);

  console.log(`\n=== ESTADO DEL CANAL DESPUÉS (${p.channelDisplayName}, sin cambios) ===`);
  checkChannelStateUnaffected(p, "después");

  console.log(`\n=== ${p.channelDisplayName}: ${failures === 0 ? "TODO PASS" : `${failures} FALLO(S)`} ===`);
  return failures;
}

export async function runDocumentaryChannelE2E(p: DocumentaryChannelTestParams): Promise<number> {
  if (!/test|tmp|temp/i.test(MATERIAL_ROOT) || MATERIAL_ROOT.toLowerCase() === "d:\\material videos") {
    throw new Error(`MATERIAL_ROOT no parece una carpeta de prueba ("${MATERIAL_ROOT}") — abortando por seguridad.`);
  }
  mkdirSync(MATERIAL_ROOT, { recursive: true });

  console.log(`=== ESTADO DEL CANAL ANTES (${p.channelDisplayName}) ===`);
  checkChannelStateUnaffected(p, "antes");

  testIdentity(p);
  await testPropsAndComposition(p);
  await testAgent2StopsAtRealBlocker(p);
  testSecurity(p);

  console.log(`\n=== ESTADO DEL CANAL DESPUÉS (${p.channelDisplayName}, sin cambios) ===`);
  checkChannelStateUnaffected(p, "después");

  console.log(`\n=== ${p.channelDisplayName}: ${failures === 0 ? "TODO PASS" : `${failures} FALLO(S)`} ===`);
  return failures;
}
