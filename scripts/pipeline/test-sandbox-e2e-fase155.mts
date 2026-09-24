// Fase 1.5.5 — prueba E2E REAL: dos workers-proceso reales, processOne.mts
// real, processProject() real, hasta COMPLETED, usando exclusivamente
// material sintético dentro de un sandbox temporal. NUNCA toca
// D:\MATERIAL VIDEOS, NUNCA usa un canal real (el gate de Fase 1.5.5 permite
// bypassear channelRegistry.mts vía context.renderProviderId="documentary-remotion",
// el MISMO provider real, agnóstico de canal).
//
// Requiere ffmpeg en PATH (para generar material sintético: audio/video/imagen
// triviales) y que MATERIAL_ROOT se haya seteado ANTES de invocar tsx (mismo
// requisito que el resto de tests de este proyecto).
import "./env.mts";
import { spawnSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, statSync, readFileSync, readdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import { MATERIAL_ROOT } from "./config.mts";
import { enqueue, listJobs, isProcessAlive, type Job } from "./queue.mts";
import { dispatchWorkers, getActiveWorkerCount, listActiveWorkers } from "./agent.mts";
import { scanEpisode, allMaterialFiles } from "./materialScanner.mts";
import { checkCompleteness } from "./completenessChecker.mts";
import { hashAll } from "./fileRegistry.mts";
import { loadProject, saveProject } from "./projectManifest.mts";
import { stateFilePath, readJson, writeJsonAtomic } from "./stateStore.mts";
import type { SpawnWorkerFn } from "./agent.mts";
import type { PipelineExecutionContext } from "./pipelineExecutionContext.mts";
import { namespacedEpisodeId } from "./episodeNamespace.mts"; // FASE 5.10-AI

const ACCOUNT = "TEST_ACCOUNT_FASE155";
// Fase 1.5.5 — dos restricciones reales, DESCUBIERTAS por esta misma prueba,
// que se intersectan: (1) Remotion valida su compositionId
// (`MainDocumentary-${episode.id}`) y rechaza guiones bajos ("Composition id
// can only contain a-z, A-Z, 0-9, CJK characters and -"); (2)
// episodeRegistrar.mts::registerEpisode() concatena el episodeId directo a un
// identificador JS (`rawCaptions${episodeId}`, `rawClips${episodeId}`, etc.)
// y ESE identificador rechaza guiones. La intersección de "sin guion bajo" Y
// "sin guion medio" es: solo alfanumérico, sin separadores.
const EPISODE_A = "TESTEPISODEA155";
const EPISODE_B = "TESTEPISODEB155";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(predicate: () => boolean, timeoutMs: number, pollMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(pollMs);
  }
  return predicate();
}

// Fase 1.5.5 — replica exactamente la lógica REAL de
// authorization.mts::authorizeProject() (scanEpisode -> checkCompleteness ->
// hashAll -> guardar AUTHORIZED con el snapshot de hashes), SIN pasar por su
// pre-chequeo `listEpisodeFolders(account).includes(episodeId)` — ese
// pre-chequeo filtra por EPISODE_FOLDER_RE (/^\d+$/, solo carpetas
// numéricas), una restricción real de la función de conveniencia para CLI,
// no del esquema de datos ni de processProject() en sí (que llama
// scanEpisode(account, episodeId) directo, sin ese filtro). Los episodeId de
// esta prueba son descriptivos (no numéricos) para que coincidan con los IDs
// de composición pedidos — se autoriza con las MISMAS funciones reales que
// authorization.mts usa internamente, solo sin ese filtro de listado
// irrelevante a esta invocación directa.
async function authorizeEpisodeDirect(account: string, episodeId: string): Promise<{ ok: boolean; reason?: string }> {
  const ep = scanEpisode(account, episodeId);
  const completeness = checkCompleteness(ep);
  if (completeness.status === "WAITING_FOR_MATERIAL") return { ok: false, reason: completeness.reason };
  const files = allMaterialFiles(ep);
  const hashes = await hashAll(files);
  const manifest = loadProject(account, episodeId);
  manifest.status = "AUTHORIZED";
  manifest.authorizedAt = new Date().toISOString();
  manifest.authorizedBy = "test-sandbox-e2e-fase155";
  manifest.authorizedMaterialHashes = hashes;
  saveProject(manifest);
  return { ok: true };
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function cleanQueueAndProjects(): void {
  const jobs = readJson<Job[]>(stateFilePath("queue.json"), []);
  writeJsonAtomic(stateFilePath("queue.json"), jobs.filter((j) => j.account !== ACCOUNT));
  for (const ep of [EPISODE_A, EPISODE_B]) {
    const p = path.join(process.cwd(), "scripts", "pipeline", "state", "projects", `${ACCOUNT}__${ep}.json`);
    if (existsSync(p)) rmSync(p);
  }
}

// --- 1. Material sintético (dentro de MATERIAL_ROOT, nunca D:\MATERIAL VIDEOS) ---
function buildEpisodeMaterial(episodeId: string, sentenceA: string, sentenceB: string): void {
  const folder = path.join(MATERIAL_ROOT, ACCOUNT, episodeId);
  mkdirSync(path.join(folder, "Videos"), { recursive: true });
  mkdirSync(path.join(folder, "Imagenes"), { recursive: true });

  writeFileSync(
    path.join(folder, "Guion - Prueba.md"),
    `# CANAL DE PRUEBA\n## Expediente 000\n### Caso sintético ${episodeId}\n\n${sentenceA}\n${sentenceB}\n`
  );

  const narrationPath = path.join(folder, "Narracion.mp3");
  const r1 = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=12", "-ar", "44100", "-ac", "2", narrationPath], {
    stdio: "pipe",
  });
  if (r1.status !== 0) throw new Error(`ffmpeg (narración sintética) falló para ${episodeId}: ${r1.stderr?.toString()}`);

  const videoPath = path.join(folder, "Videos", "clip-sintetico.mp4");
  const r2 = spawnSync(
    "ffmpeg",
    ["-y", "-f", "lavfi", "-i", "color=c=blue:s=640x360:d=4", "-r", "30", "-pix_fmt", "yuv420p", videoPath],
    { stdio: "pipe" }
  );
  if (r2.status !== 0) throw new Error(`ffmpeg (video sintético) falló para ${episodeId}: ${r2.stderr?.toString()}`);

  const imagePath = path.join(folder, "Imagenes", "imagen-sintetica.jpg");
  const r3 = spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=640x360", "-frames:v", "1", imagePath], { stdio: "pipe" });
  if (r3.status !== 0) throw new Error(`ffmpeg (imagen sintética) falló para ${episodeId}: ${r3.stderr?.toString()}`);
}

// --- 2. Sandbox TEST_ROOT compartido (episodes.ts/data/public/out) ---
function buildSandboxRoot(): PipelineExecutionContext {
  const testRoot = mkdtempSync(path.join(tmpdir(), "fase155-sandbox-"));
  const libDir = path.join(testRoot, "lib");
  const dataRoot = path.join(testRoot, "data");
  const publicAssetsRoot = path.join(testRoot, "public", "assets");
  const outputRoot = path.join(testRoot, "out");
  mkdirSync(libDir, { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(publicAssetsRoot, { recursive: true });
  mkdirSync(outputRoot, { recursive: true });

  // Fase 1.5.5 — hallazgo real: remotion/components/AmbientAudio.tsx (REAL,
  // sin modificar) espera una librería COMPARTIDA de efectos de sonido en
  // public/assets/audio/sfx/ (nunca generada por copyEpisodeAssets(), que solo
  // copia video/imágenes/narración POR episodio) — los 11 archivos exactos
  // están hardcoded en remotion/lib/musicBed.ts (musicTracks/textureTracks).
  // Se copian (SOLO LECTURA del repo real, nunca se modifica el original)
  // hacia el sandbox — usar los archivos reales evita adivinar un formato de
  // audio sintético compatible con lo que Remotion espera poder decodificar.
  const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
  const realSfxDir = path.join(REPO_ROOT, "public", "assets", "audio", "sfx");
  const sandboxSfxDir = path.join(publicAssetsRoot, "audio", "sfx");
  mkdirSync(sandboxSfxDir, { recursive: true });
  for (const file of readdirSync(realSfxDir)) {
    copyFileSync(path.join(realSfxDir, file), path.join(sandboxSfxDir, file));
  }

  // Ancla mínima requerida por episodeRegistrar.mts::IMPORT_ANCHOR_RE (mismo
  // patrón ya usado en test-episodes-registry-lock.mts desde Día 1.1).
  writeFileSync(path.join(dataRoot, "clips-000.json"), "[]\n");

  const episodesFile = path.join(libDir, "episodes.ts");
  writeFileSync(
    episodesFile,
    `// Fase 1.5.5 — catálogo SANDBOX, autocontenido (sin imports relativos fuera
// de TEST_ROOT) — reimplementación mínima de la forma pública real de
// remotion/lib/episodes.ts (FPS/normalizeCaptions/secToFrames/
// totalDurationFromCaptions/getEpisode/mainDurationInFrames), nunca el
// archivo real, nunca modificado.
export const FPS = 30;
const secToFrames = (sec) => Math.round(sec * FPS);
const normalizeCaptions = (raw) => raw;
const totalDurationFromCaptions = (captions) =>
  captions.length ? Math.max(...captions.map((c) => c.end)) : 0;

import rawClips000 from "../data/clips-000.json";

// episodeRegistrar.mts::EXPORT_LINE_RE exige textualmente esta anotación de
// tipo — sin ella no reconoce el ancla "export const episodes = [...]" y
// falla con "No se encontró \`export const episodes = [...]\`". EpisodeConfig
// = any acá es intencional: es un catálogo de PRUEBA, nunca se type-checkea
// (tsx transpila sin chequear tipos), no hace falta reimplementar el tipo real.
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

  return { episodesFile, dataRoot, publicAssetsRoot, outputRoot, renderProviderId: "documentary-remotion" };
}

// --- 3. Captions pre-seeded (segmentos crudos) para SALTAR whisper real ---
function seedCaptions(dataRoot: string, episodeId: string, sentenceA: string, sentenceB: string): void {
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(
    path.join(dataRoot, `captions-${episodeId}.json`),
    JSON.stringify(
      [
        { start: 0, end: 6, text: sentenceA },
        { start: 6, end: 12, text: sentenceB },
      ],
      null,
      2
    )
  );
}

// --- 4. Spawn real de worker CON las 5 env vars del contexto sandbox ---
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

async function testErrorIsolationBeforePositive() {
  console.log("\n=== PRUEBA DE ERROR AISLADO (antes del E2E positivo) — A válido, B con provider inexistente ===");
  cleanQueueAndProjects();
  const context = buildSandboxRoot();
  seedCaptions(context.dataRoot, EPISODE_A, "Frase A uno.", "Frase A dos.");
  buildEpisodeMaterial(EPISODE_A, "Frase A uno.", "Frase A dos.");
  await authorizeEpisodeDirect(ACCOUNT, EPISODE_A);
  enqueue(ACCOUNT, EPISODE_A);

  buildEpisodeMaterial(EPISODE_B, "Frase B uno.", "Frase B dos.");
  await authorizeEpisodeDirect(ACCOUNT, EPISODE_B);
  enqueue(ACCOUNT, EPISODE_B);

  const goodEnv = makeRealSandboxSpawn(context);
  const badContext: PipelineExecutionContext = { ...context, renderProviderId: "NO_EXISTE_FASE155" };
  const badEnv = makeRealSandboxSpawn(badContext);
  const spawnFn: SpawnWorkerFn = (account, episodeId) => (episodeId === EPISODE_A ? goodEnv(account, episodeId) : badEnv(account, episodeId));

  dispatchWorkers(2, spawnFn);
  await waitUntil(() => getActiveWorkerCount() === 0, 60_000, 100);

  const jobA = listJobs().find((j) => j.account === ACCOUNT && j.episodeId === EPISODE_A);
  const jobB = listJobs().find((j) => j.account === ACCOUNT && j.episodeId === EPISODE_B);
  check("A (provider válido) NO quedó en ERROR por culpa de B", jobA?.status !== "ERROR" || jobA?.lastError === undefined, jobA?.lastError);
  check("B (provider inexistente) SÍ terminó en ERROR (fail-closed, sin fallback)", jobB?.status === "ERROR", jobB?.lastError);
  console.log(`  estado A tras la ronda: ${jobA?.status} (puede seguir PROCESSING legítimamente si aún no le tocó turno con MAX_WORKERS=2 — se re-verifica abajo)`);

  // A puede haber quedado QUEUED/PROCESSING si el error de B fue más rápido —
  // se le da una segunda vuelta de dispatch para que efectivamente corra y
  // se confirme que NUNCA fue afectado por el fallo de B.
  dispatchWorkers(2, spawnFn);
  await waitUntil(() => getActiveWorkerCount() === 0, 60_000, 100);
  const jobA2 = listJobs().find((j) => j.account === ACCOUNT && j.episodeId === EPISODE_A);
  check("A, corrido hasta el final, NUNCA terminó en ERROR por culpa de B", jobA2?.status !== "ERROR", jobA2?.lastError);

  cleanQueueAndProjects();
  rmSync(path.dirname(context.dataRoot), { recursive: true, force: true });
  rmSync(path.join(MATERIAL_ROOT, ACCOUNT), { recursive: true, force: true });
}

async function testTwoWorkersCompleted() {
  console.log("\n=== PRUEBA POSITIVA E2E: DOS WORKERS REALES HASTA COMPLETED ===");
  cleanQueueAndProjects();

  const context = buildSandboxRoot();
  console.log(`  TEST_ROOT: ${path.dirname(context.dataRoot)}`);

  buildEpisodeMaterial(EPISODE_A, "El caso comenzo una noche de invierno.", "Nadie volvio a saber de ella jamas.");
  buildEpisodeMaterial(EPISODE_B, "El segundo expediente permanecio cerrado por anios.", "La verdad seguia sin explicacion clara.");
  seedCaptions(context.dataRoot, EPISODE_A, "El caso comenzo una noche de invierno.", "Nadie volvio a saber de ella jamas.");
  seedCaptions(context.dataRoot, EPISODE_B, "El segundo expediente permanecio cerrado por anios.", "La verdad seguia sin explicacion clara.");

  const authA = await authorizeEpisodeDirect(ACCOUNT, EPISODE_A);
  const authB = await authorizeEpisodeDirect(ACCOUNT, EPISODE_B);
  check("(setup) episodio A autorizado", authA.ok, authA.ok ? "" : authA.reason);
  check("(setup) episodio B autorizado", authB.ok, authB.ok ? "" : authB.reason);

  enqueue(ACCOUNT, EPISODE_A);
  enqueue(ACCOUNT, EPISODE_B);

  const spawnFn = makeRealSandboxSpawn(context);

  const overlapSamples: Array<{ t: number; workers: string[] }> = [];
  const startedAt = Date.now();
  const pidByEpisode = new Map<string, number>();
  const startTimeByEpisode = new Map<string, number>();

  dispatchWorkers(2, spawnFn);

  const sampler = setInterval(() => {
    const active = listActiveWorkers();
    for (const w of active) {
      if (!pidByEpisode.has(w.episodeId)) {
        pidByEpisode.set(w.episodeId, w.child.pid!);
        startTimeByEpisode.set(w.episodeId, Date.now() - startedAt);
      }
    }
    overlapSamples.push({ t: Date.now() - startedAt, workers: active.map((w) => `${w.episodeId}(pid ${w.child.pid})`) });
  }, 25);

  const drained = await waitUntil(() => getActiveWorkerCount() === 0, 20 * 60_000, 200); // hasta 20 min: whisper está bypasseado, pero el render real de Remotion puede tardar
  clearInterval(sampler);

  check("ambos workers terminaron dentro del timeout (20 min)", drained);

  const samplesWithBoth = overlapSamples.filter((s) => s.workers.length === 2);
  check(
    "hubo AL MENOS UNA muestra temporal con los DOS workers reales activos a la vez (overlap real)",
    samplesWithBoth.length > 0,
    `muestras con 2 activos=${samplesWithBoth.length}/${overlapSamples.length}`
  );
  if (samplesWithBoth.length > 0) {
    console.log(`  evidencia de overlap: t=${samplesWithBoth[0].t}ms -> ${samplesWithBoth[0].workers.join(", ")}`);
  }

  const jobA = listJobs().find((j) => j.account === ACCOUNT && j.episodeId === EPISODE_A);
  const jobB = listJobs().find((j) => j.account === ACCOUNT && j.episodeId === EPISODE_B);
  const manifestA = loadProject(ACCOUNT, EPISODE_A);
  const manifestB = loadProject(ACCOUNT, EPISODE_B);

  console.log(`\n  --- WORKER A --- pid=${pidByEpisode.get(EPISODE_A)} inicio_t=${startTimeByEpisode.get(EPISODE_A)}ms cola=${jobA?.status} manifest=${manifestA.status}`);
  console.log(`  --- WORKER B --- pid=${pidByEpisode.get(EPISODE_B)} inicio_t=${startTimeByEpisode.get(EPISODE_B)}ms cola=${jobB?.status} manifest=${manifestB.status}`);

  check("Job A (cola) === COMPLETED", jobA?.status === "COMPLETED", jobA?.lastError);
  check("Job B (cola) === COMPLETED", jobB?.status === "COMPLETED", jobB?.lastError);
  check("Manifest A === COMPLETED", manifestA.status === "COMPLETED");
  check("Manifest B === COMPLETED", manifestB.status === "COMPLETED");
  check("Job A sin workerPid/workerToken residual", jobA?.workerPid === undefined && jobA?.workerToken === undefined);
  check("Job B sin workerPid/workerToken residual", jobB?.workerPid === undefined && jobB?.workerToken === undefined);

  // --- outputs ---
  const outA = path.join(MATERIAL_ROOT, ACCOUNT, "Videos YouTube Completos", `${EPISODE_A} - Video Completo.mp4`);
  const outB = path.join(MATERIAL_ROOT, ACCOUNT, "Videos YouTube Completos", `${EPISODE_B} - Video Completo.mp4`);
  const existsA = existsSync(outA);
  const existsB = existsSync(outB);
  check("output final de A existe", existsA, outA);
  check("output final de B existe", existsB, outB);
  if (existsA) check("output A > 0 bytes", statSync(outA).size > 0, `${statSync(outA).size} bytes`);
  if (existsB) check("output B > 0 bytes", statSync(outB).size > 0, `${statSync(outB).size} bytes`);
  if (existsA && existsB) {
    const hashA = sha256(outA);
    const hashB = sha256(outB);
    check("outputs A y B tienen hashes DISTINTOS (no es el mismo archivo)", hashA !== hashB, `A=${hashA.slice(0, 12)}... B=${hashB.slice(0, 12)}...`);
  }

  // --- episodes.ts sandbox: sin duplicados, sin pérdidas, chapterNumber distinto ---
  // FASE 5.10-AI — el id real escrito en episodes.ts ya NO es el episode_id
  // crudo (EPISODE_A/EPISODE_B) sino el namespaced por canal
  // (namespacedEpisodeId(ACCOUNT, episodeId)) — exactamente el cambio que
  // esta fase introdujo para que dos canales con el mismo episode_id físico
  // nunca colisionen en este mismo archivo. ACCOUNT ("TEST_ACCOUNT_FASE155")
  // no es el canal legacy sin prefijo (SIN EXPLICACIÓN), así que SIEMPRE
  // lleva el prefijo del canal — confirmado con Remotion/esbuild reales.
  const namespacedA = namespacedEpisodeId(ACCOUNT, EPISODE_A);
  const namespacedB = namespacedEpisodeId(ACCOUNT, EPISODE_B);
  const episodesSrc = readFileSync(context.episodesFile, "utf-8");
  check(`episodes.ts sandbox contiene la entrada de A ("id: \\"${namespacedA}\\"")`, episodesSrc.includes(`id: "${namespacedA}"`));
  check(`episodes.ts sandbox contiene la entrada de B ("id: \\"${namespacedB}\\"")`, episodesSrc.includes(`id: "${namespacedB}"`));
  const chapterMatches = [...episodesSrc.matchAll(/chapterNumber: (\d+)/g)].map((m) => Number(m[1]));
  check("chapterNumber de A y B son DISTINTOS entre sí (sin duplicados)", new Set(chapterMatches).size === chapterMatches.length, JSON.stringify(chapterMatches));

  console.log(`\n  TEST_ROOT (evidencia, se borra después): ${path.dirname(context.dataRoot)}`);

  cleanQueueAndProjects();
  rmSync(path.dirname(context.dataRoot), { recursive: true, force: true });
  rmSync(path.join(MATERIAL_ROOT, ACCOUNT), { recursive: true, force: true });
}

async function main() {
  if (!/test|tmp|temp/i.test(MATERIAL_ROOT) || MATERIAL_ROOT.toLowerCase() === "d:\\material videos") {
    throw new Error(`MATERIAL_ROOT no parece una carpeta de prueba ("${MATERIAL_ROOT}") — abortando por seguridad.`);
  }
  mkdirSync(MATERIAL_ROOT, { recursive: true });

  await testErrorIsolationBeforePositive();
  await testTwoWorkersCompleted();

  console.log(`\n=== ${failures === 0 ? "TODO PASS" : `${failures} FALLO(S)`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Error ejecutando la prueba E2E:", err);
  process.exit(1);
});
