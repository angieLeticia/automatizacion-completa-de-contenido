// Fase 1: procesa un episodio de punta a punta. `processProject()` es la
// función reutilizable (la usan tanto este CLI manual como el agente
// continuo de Fase 3, ver agent.mts) — no hay dos implementaciones del
// pipeline, solo dos formas de invocar la misma.
// Uso manual: npx tsx scripts/pipeline/processOne.mts "SIN EXPLICACIÓN" 008
import "./env.mts"; // SIEMPRE primero — ver env.mts para por qué el orden importa
import path from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { scanEpisode, allMaterialFiles } from "./materialScanner.mts";
import { checkCompleteness } from "./completenessChecker.mts";
import { loadProject, hashSetsEqual } from "./projectManifest.mts";
import { hashAll } from "./fileRegistry.mts";
import { analyzeScript, buildTtsChapters } from "./scriptAnalyzer.mts";
import { probeVideo, probeImage } from "./mediaCatalog.mts";
import type { VideoPoolItem, ImagePoolItem } from "./mediaCatalog.mts";
import { type RawSegment } from "./transcriber.mts";
import { tagCaptions, alignedSentencesFor } from "./captionTagger.mts";
import { assignVisuals } from "./visualAssigner.mts";
import { generateNarration } from "./voiceGenerator.mts";
import {
  copyEpisodeAssets,
  writeCaptions,
  ensureEmptyClips,
  writeClips,
  writeShots,
  registerEpisode,
} from "./episodeRegistrar.mts";
import { checkRenderedVideo, checkClip } from "./qualityChecker.mts";
// Fase 4.8 — resuelve el RenderProvider del canal en vez de llamar a
// MachineBridge.render directamente con un compositionId fijo (mismo
// MachineBridge por debajo para "documentary-remotion", el único provider
// real hoy). Ver scripts/pipeline/renderProviderRegistry.mts.
import { resolveRenderProvider } from "./renderProviderRegistry.mts";
import { selectClips, selectClipsSequential } from "./clipSelector.mts";
import { exportMainVideo, exportClip } from "./exportManager.mts";
import { CLIP_MAX_SECONDS, CLIP_MIN_SECONDS, MAIN_TARGET_MAX_SECONDS, MAIN_TARGET_MIN_SECONDS } from "./config.mts";
import { FPS } from "../../remotion/theme.ts";
// Fase 4.6 — probe de audio, detección de silencios, transcripción y render
// pasan por MachineBridge (agent/machine/), que envuelve exactamente estas
// mismas funciones (mediaCatalog.mts/silenceDetector.mts/transcriber.mts/
// renderer.mts, sin cambios) con seguridad de rutas y validación de
// composición añadidas. probeVideo/probeImage NO migran (ver docs/
// machine-access.md — su firma no es compatible: hacen extracción de
// keywords y devuelven un shape distinto a MediaInfo). El concat de audio de
// generateNarration tampoco migra (sus chunks viven en un tmpdir fuera de las
// raíces permitidas del Bridge). reselectClips.mts sigue usando las funciones
// originales directamente, sin pasar por el Bridge todavía.
import { machineBridge } from "../../agent/machine/machineBridge.mts";
if (!machineBridge.media || !machineBridge.render) {
  throw new Error("MachineBridge.media/render deben estar implementados (ver agent/machine/machineBridge.mts) para correr el pipeline.");
}
const media = machineBridge.media;

export const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

const nextChapterNumber = async (): Promise<number> => {
  const mod = await import("../../remotion/lib/episodes.ts");
  return Math.max(0, ...mod.episodes.map((e: { chapterNumber: number }) => e.chapterNumber)) + 1;
};

const pickReelOptions = (videoCount: number) => {
  if (videoCount <= 2) return { imagesPerVideo: 3 };
  if (videoCount <= 5) return { imagesPerVideo: 2 };
  return undefined;
};

export type ProcessResult =
  | { status: "WAITING_FOR_MATERIAL"; reason: string }
  | { status: "NOT_AUTHORIZED"; reason: string }
  | { status: "MAIN_QA_FAILED"; reason: string }
  | { status: "COMPLETED"; mainOutput: string; clipsExported: number; clipsTotal: number };

// Produce un episodio completo: guion -> (voz si falta) -> whisper -> captions
// -> visuales -> registro en episodes.ts -> render largo -> QA -> clips
// (editoriales + secuenciales) -> render -> QA -> export. No usa
// process.exit() en ningún lado — quien la llama decide qué hacer con el
// resultado (el CLI de abajo sale del proceso; el agente sigue con la cola).
export async function processProject(account: string, episodeId: string): Promise<ProcessResult> {
  // Fase 4.8 — resuelve el RenderProvider del canal ANTES de cualquier paso
  // costoso (whisper/ElevenLabs/render): si el canal no tiene provider
  // (BLOCKED/HISTORICAL, o sin provider integrado todavía), falla rápido con
  // un error claro (CHANNEL_*) en vez de gastar trabajo real para terminar
  // fallando solo al llegar al render.
  const renderProvider = resolveRenderProvider(account);

  // Fase 4.5 — GATE DE AUTORIZACIÓN, segunda capa de defensa. agent.mts ya
  // filtra esto antes de encolar (ver decideEnqueue en agent.mts), pero
  // processProject() puede llamarse directamente (CLI manual, o un bug futuro
  // en el llamador) — así que la protección real contra gasto accidental de
  // ElevenLabs/render vive ACÁ, antes de cualquier paso costoso, no solo en el
  // agente. Se re-verifica el hash actual contra el snapshot autorizado en vez
  // de confiar en manifest.status (para cuando llega acá, el worker ya lo puso
  // en PROCESSING — el hash es la única prueba estable de "esto es lo que se
  // autorizó").
  const manifestBefore = loadProject(account, episodeId);
  if (!manifestBefore.authorizedMaterialHashes || manifestBefore.authorizedMaterialHashes.length === 0) {
    return { status: "NOT_AUTHORIZED", reason: "el proyecto nunca pasó por pipeline:authorize (falta authorizedMaterialHashes)" };
  }
  const epForAuthCheck = scanEpisode(account, episodeId);
  const currentHashesForAuthCheck = await hashAll(allMaterialFiles(epForAuthCheck));
  if (!hashSetsEqual(currentHashesForAuthCheck, manifestBefore.authorizedMaterialHashes)) {
    return { status: "NOT_AUTHORIZED", reason: "el material cambió después de la autorización — requiere pipeline:authorize de nuevo" };
  }

  log(`Escaneando ${account}/${episodeId}...`);
  let ep = scanEpisode(account, episodeId);

  const completeness = checkCompleteness(ep);
  if (completeness.status === "WAITING_FOR_MATERIAL") {
    return completeness;
  }

  log("Analizando guion...");
  // checkCompleteness ya garantizó que hay guion en esta rama (WAITING_FOR_MATERIAL
  // ya devolvió arriba si no) — TS no puede ver esa relación entre funciones.
  const script = analyzeScript(ep.scriptFile!);
  log(`  título="${script.title}" capítulos=${script.chapters.length - 1} oraciones=${script.sentences.length}`);

  if (!ep.narrationFile) {
    log("No hay narración todavía — generándola en ElevenLabs a partir del guion...");
    const narrationOut = path.join(ep.folder, "Narracion.mp3");
    const ttsChapters = buildTtsChapters(script);
    await generateNarration(ttsChapters, narrationOut, (msg) => log(`  ${msg}`));
    log(`  narración generada: ${narrationOut}`);
    ep = scanEpisode(account, episodeId); // re-escanea para recoger el archivo recién creado
  }

  log("Catalogando videos/imágenes (ffprobe)...");
  const videoItems: VideoPoolItem[] = ep.videoFiles.map((v) => probeVideo(v, `${episodeId}/${path.basename(v)}`));
  const imageItems: ImagePoolItem[] = ep.imageFiles.map((im) => probeImage(im, `${episodeId}/${path.basename(im)}`));
  log(`  videos=${videoItems.length} imágenes=${imageItems.length}`);

  // whisper es, por lejos, el paso más lento (~30-40 min en CPU para un
  // episodio de ~10 min) — si ya existe una transcripción de una corrida
  // anterior para este episodio, se reusa en vez de repetirla. Los
  // start/end/text de captions-{id}.json son el segmento de whisper crudo,
  // sin tocar (el "type" es lo único que cambia entre corridas).
  const captionsPath = path.join(import.meta.dirname, "..", "..", "remotion", "data", `captions-${episodeId}.json`);
  let segments: RawSegment[];
  if (existsSync(captionsPath) && JSON.parse(readFileSync(captionsPath, "utf-8")).length > 0) {
    log("Reusando transcripción existente (captions-{id}.json ya tiene datos)...");
    const cached = JSON.parse(readFileSync(captionsPath, "utf-8")) as { start: number; end: number; text: string }[];
    segments = cached.map((c) => ({ start: c.start, end: c.end, text: c.text }));
  } else {
    log("Transcribiendo narración (whisper, vía MachineBridge.media)...");
    segments = await media.transcribe(ep.narrationFile!, true);
  }
  log(`  ${segments.length} segmentos`);

  log("Detectando silencios (vía MachineBridge.media)...");
  const silences = await media.detectSilences(ep.narrationFile!);
  log(`  ${silences.length} silencios`);

  log("Etiquetando captions (hook/reveal) por alineación con el guion...");
  const captions = tagCaptions(segments, script);
  const alignedSentences = alignedSentencesFor(segments, script);
  const nonNormal = captions.filter((c) => c.type !== "normal").length;
  log(`  ${captions.length} captions, ${nonNormal} hook/reveal`);

  const narrationDurationSeconds = (await media.probe(ep.narrationFile!)).durationSeconds;
  if (narrationDurationSeconds < MAIN_TARGET_MIN_SECONDS || narrationDurationSeconds > MAIN_TARGET_MAX_SECONDS) {
    log(
      `  aviso: la narración dura ${(narrationDurationSeconds / 60).toFixed(1)} min, fuera del objetivo 10-15 min (no bloquea, solo aviso)`
    );
  }
  const totalFrames = Math.round(narrationDurationSeconds * FPS);
  const reelOptions = pickReelOptions(videoItems.length);

  log("Asignando recursos visuales por palabra clave (con fallback a rotación)...");
  const pool = { videoPool: videoItems, imagePool: imageItems };
  const shots = assignVisuals(captions, pool, totalFrames, videoItems, imageItems, reelOptions);
  log(`  ${shots.length} shots en la línea de tiempo`);

  log("Copiando assets a public/assets/ ...");
  const { narrationRelPath } = copyEpisodeAssets(episodeId, ep.videoFiles, ep.imageFiles, ep.narrationFile!);

  log("Escribiendo captions-{id}.json, shots-{id}.json y clips-{id}.json (vacío)...");
  writeCaptions(episodeId, captions);
  writeShots(episodeId, shots);
  ensureEmptyClips(episodeId);

  log("Registrando episodio en remotion/lib/episodes.ts...");
  const chapterNumber = await nextChapterNumber();
  const registerResult = registerEpisode({
    episodeId,
    chapterNumber,
    narrationRelPath,
    narrationDurationSeconds,
    videoPool: videoItems,
    imagePool: imageItems,
    reelOptions,
    hasShots: true,
  });
  log(`  ${registerResult === "inserted" ? `insertado, chapterNumber=${chapterNumber}` : "actualizado (ya estaba registrado)"}`);

  log(`Renderizando video largo (esto puede tardar varios minutos, vía RenderProvider "${renderProvider.id}")...`);
  // renderProvider.renderMain() para "documentary-remotion" hace exactamente
  // lo que renderMain() hacía antes de la Fase 4.8: MachineBridge.render con
  // el mismo compositionId y el mismo out/main-{id}.mp4. Sin reuseIfExists ni
  // timeoutMs: se preserva el comportamiento actual (siempre renderiza, sin
  // límite de tiempo).
  const mainOut = (await renderProvider.renderMain(episodeId)).path;
  const mainQa = checkRenderedVideo(mainOut, narrationDurationSeconds);
  if (!mainQa.ok) {
    log(`QA del video largo FALLÓ: ${mainQa.reason}`);
    return { status: "MAIN_QA_FAILED", reason: mainQa.reason };
  }
  log("QA del video largo: OK");

  log("Seleccionando clips a partir del video largo ya renderizado...");
  // Dos modalidades: "Clip" = mejores momentos (editorial, con huecos,
  // cantidad variable) + "Parte" = corte secuencial de cobertura completa
  // (sin huecos, tamaño parejo) — pedidas ambas explícitamente.
  const editorialClips = selectClips(captions, alignedSentences, silences, narrationDurationSeconds);
  const sequentialClips = selectClipsSequential(captions, silences, narrationDurationSeconds);
  const clips = [...editorialClips, ...sequentialClips];
  log(`  ${editorialClips.length} clips editoriales + ${sequentialClips.length} partes secuenciales`);
  writeClips(episodeId, clips);

  const exportedMain = exportMainVideo(account, episodeId, script.title, mainOut);
  log(`Video largo exportado a: ${exportedMain}`);

  const exportedClips: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    const isSequential = i >= editorialClips.length;
    const label = isSequential ? "Parte" : "Clip";
    const localIndex = isSequential ? i - editorialClips.length : i;
    log(`Renderizando ${label} ${localIndex + 1} (${i + 1}/${clips.length})...`);
    const clipOut = (await renderProvider.renderClip(episodeId, i)).path;
    const clipDurationSec = (clips[i].endFrame - clips[i].startFrame) / FPS;
    const clipQa = checkClip(clipOut, CLIP_MIN_SECONDS, CLIP_MAX_SECONDS);
    if (!clipQa.ok) {
      log(`  QA FALLÓ: ${clipQa.reason} — se omite, no se exporta`);
      continue;
    }
    const exported = exportClip(account, episodeId, script.title, localIndex, clipOut, label);
    exportedClips.push(exported);
    log(`  OK (${clipDurationSec.toFixed(0)}s) -> ${exported}`);
  }

  log(`Producción completa. Video largo + ${exportedClips.length}/${clips.length} clips exportados.`);
  return { status: "COMPLETED", mainOutput: exportedMain, clipsExported: exportedClips.length, clipsTotal: clips.length };
}

// --- CLI manual: solo parsea argv, llama processProject y traduce el
// resultado a exit code — cero lógica de producción acá. ---
async function cli() {
  const [account, episodeId] = process.argv.slice(2);
  if (!account || !episodeId) {
    console.error('Uso: npx tsx scripts/pipeline/processOne.mts "SIN EXPLICACIÓN" 008');
    process.exit(1);
  }

  const result = await processProject(account, episodeId);
  if (result.status === "WAITING_FOR_MATERIAL") {
    log(`Estado: WAITING_FOR_MATERIAL — ${result.reason}`);
    process.exit(0);
  }
  if (result.status === "NOT_AUTHORIZED") {
    log(`Estado: NOT_AUTHORIZED — ${result.reason}`);
    log(`  Autorizar primero con: npm run pipeline:authorize -- "${account}" ${episodeId}`);
    process.exit(1);
  }
  if (result.status === "MAIN_QA_FAILED") {
    process.exit(1);
  }
}

const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  cli().catch((err) => {
    console.error("Error en el pipeline:", err);
    process.exit(1);
  });
}
