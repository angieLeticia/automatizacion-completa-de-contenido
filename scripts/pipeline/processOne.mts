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
import { withEpisodesRegistryLock } from "./episodesRegistryLock.mts";
import { withEpisodesFileLock } from "./episodesFileLock.mts";
import type { PipelineExecutionContext } from "./pipelineExecutionContext.mts";
// Fase 4.8 — resuelve el RenderProvider del canal en vez de llamar a
// MachineBridge.render directamente con un compositionId fijo (mismo
// MachineBridge por debajo para "documentary-remotion", el único provider
// real hoy). Ver scripts/pipeline/renderProviderRegistry.mts.
import { resolveRenderProvider, RENDER_PROVIDERS } from "./renderProviderRegistry.mts";
import { isRealDataRenderProvider, type RealEpisodeData } from "./renderProvider.mts";
import { selectClips, selectClipsSequential } from "./clipSelector.mts";
import { exportMainVideo, exportClip } from "./exportManager.mts";
import { CLIP_MAX_SECONDS, CLIP_MIN_SECONDS, MAIN_TARGET_MAX_SECONDS, MAIN_TARGET_MIN_SECONDS } from "./config.mts";
import { FPS } from "../../remotion/theme.ts";
// FASE 5.10-AI — namespace de episodios particionado por canal (episodeNamespace.mts)
// y resolución de configuración de voz POR CANAL (channelRegistry.mts) — ver
// esos archivos para el detalle completo de por qué y qué garantizan.
import { namespacedEpisodeId } from "./episodeNamespace.mts";
import { resolveChannelConfig } from "./channelRegistry.mts";
import { applyTranscriptGlossaryToSegments } from "../../lib/transcriptGlossary.ts";
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

// "Día 1.1" — cache-busting deliberado (mismo motivo exacto ya documentado en
// agent/machine/renderBridge.mts::assertCompositionExists): import() de un
// mismo specifier queda cacheado por Node durante todo el proceso. Sin esto,
// una SEGUNDA llamada a nextChapterNumber() en la vida de este mismo proceso
// (para un episodio distinto, incluso procesado secuencialmente después del
// primero, no solo concurrente) seguiría viendo la versión de episodes.ts
// anterior a la primera escritura — pudiendo calcular un chapterNumber ya
// usado. El query string `?t=` fuerza releer el archivo real en disco cada vez.
// Fase 1.5.5 — segunda corrección real encontrada por la prueba E2E: NI
// siquiera un specifier relativo resuelve el problema — tsx no logra aplicar
// su hook ESM/TS para un archivo FUERA del proyecto (ej. una carpeta temporal
// del sandbox) cuando se usa el cache-busting "?t=": cae a un shim estilo CJS
// que no entiende query strings (MODULE_NOT_FOUND), sin importar si el
// specifier era relativo o absoluto. Es una limitación real de tsx para
// archivos fuera de su raíz de proyecto, no un error de esta implementación.
//
// Para el caso sandbox (episodesFile presente) se evita el problema de raíz:
// en vez de import(), se lee el archivo como TEXTO y se extrae el
// chapterNumber máximo por regex — el MISMO mecanismo que
// episodeRegistrar.mts::registerEpisode() YA usa internamente para su propio
// chequeo "¿ya estaba registrado con qué chapterNumber?" (ver esa función),
// no una técnica nueva. Nunca hace falta cache-busting en este camino: leer
// el archivo de texto siempre da el contenido real en disco, sin ningún
// caché de módulo de por medio. Producción (sin episodesFile) sigue usando
// EXACTAMENTE el import() original, sin cambios.
const nextChapterNumberFromText = (episodesFile: string): number => {
  const src = readFileSync(episodesFile, "utf-8");
  const matches = [...src.matchAll(/chapterNumber:\s*(\d+)/g)].map((m) => Number(m[1]));
  return matches.length === 0 ? 1 : Math.max(...matches) + 1;
};

const nextChapterNumber = async (episodesFile?: string): Promise<number> => {
  if (episodesFile) return nextChapterNumberFromText(episodesFile);
  const mod = await import(`../../remotion/lib/episodes.ts?t=${Date.now()}`);
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
// Fase 1.5.3 — `context` opcional (PipelineExecutionContext): SIN este
// parámetro (producción real, todos los llamadores existentes — agent.mts vía
// CLI, npm run pipeline:process — nunca lo pasan), processProject() se
// comporta EXACTAMENTE igual que antes de esta fase, byte a byte, en cada
// ruta que toca. Con él (solo desde un test/sandbox explícito), cada paso que
// escribe/lee un recurso namespaced por episodio (episodes.ts, remotion/data,
// public/assets, out/) usa las rutas del sandbox en su lugar. NUNCA se creó
// un segundo processProject ni una rama por NODE_ENV — es la misma función,
// con un dato más que, ausente, no cambia nada.
export async function processProject(account: string, episodeId: string, context?: PipelineExecutionContext): Promise<ProcessResult> {
  // Fase 4.8 — resuelve el RenderProvider del canal ANTES de cualquier paso
  // costoso (whisper/ElevenLabs/render): si el canal no tiene provider
  // (BLOCKED/HISTORICAL, o sin provider integrado todavía), falla rápido con
  // un error claro (CHANNEL_*) en vez de gastar trabajo real para terminar
  // fallando solo al llegar al render.
  //
  // Fase 1.5.5 — bypass EXPLÍCITO y doble opt-in (context Y
  // context.renderProviderId, ninguno solo) para poder ejercitar el pipeline
  // real con una cuenta ficticia (sandbox), sin channelRegistry.mts: reutiliza
  // el MISMO RenderProvider real ya registrado (nunca uno inventado) por id
  // directo. Sin ninguno de los dos, o con renderProviderId vacío/ausente,
  // el camino es EXACTAMENTE resolveRenderProvider(account) — producción sin
  // cambios, byte a byte.
  let renderProvider: ReturnType<typeof resolveRenderProvider>;
  if (context?.renderProviderId) {
    const provider = RENDER_PROVIDERS[context.renderProviderId];
    if (!provider) {
      throw new Error(
        `PipelineExecutionContext.renderProviderId="${context.renderProviderId}" no existe en RENDER_PROVIDERS — ` +
          `nunca se hace fallback a resolveRenderProvider(account) desde acá (fail-closed explícito).`
      );
    }
    renderProvider = provider;
  } else {
    renderProvider = resolveRenderProvider(account);
  }

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
    // FASE 5.10-AI — la voz YA NO es un patrón global fijo: cada canal debe
    // declarar la suya en channelRegistry.mts::ChannelConfig.voice. Sin
    // configuración real para este canal, se falla EXPLÍCITO y ANTES de
    // gastar ningún crédito de ElevenLabs — nunca se usa por accidente la voz
    // de otro canal (ver auditoría FASE 5.10-AI, Parte A: hoy solo SIN
    // EXPLICACIÓN tiene una voz real documentada).
    const voiceConfig = resolveChannelConfig(account)?.voice;
    if (!voiceConfig) {
      throw new Error(
        `No hay configuración de voz (ElevenLabs) definida para el canal "${account}" — ver channelRegistry.mts::ChannelConfig.voice. ` +
          `No se genera narración con la voz de otro canal. Define voiceConfig.narratorVoicePattern para "${account}" antes de producir este episodio.`
      );
    }
    log("No hay narración todavía — generándola en ElevenLabs a partir del guion...");
    const narrationOut = path.join(ep.folder, "Narracion.mp3");
    const ttsChapters = buildTtsChapters(script);
    await generateNarration(ttsChapters, narrationOut, voiceConfig.narratorVoicePattern, voiceConfig.voiceSettings, voiceConfig.modelId, (msg) =>
      log(`  ${msg}`)
    );
    log(`  narración generada: ${narrationOut}`);
    ep = scanEpisode(account, episodeId); // re-escanea para recoger el archivo recién creado
  }

  // FASE 5.10-AI — a partir de aquí, todo lo que entra a la capa de Remotion
  // (remotion/lib/episodes.ts, remotion/data/*.json, public/assets/*, IDs de
  // composición, y los `file` relativos guardados en videoPool/imagePool que
  // Remotion resuelve vía staticFile() contra public/assets/) usa
  // `compositionEpisodeId`, NUNCA `episodeId` crudo — evita que dos canales
  // con el mismo episode_id físico (ej. "001") se pisen la misma clave/
  // archivo. `episodeId` crudo sigue usándose sin cambios para todo lo demás
  // (scanEpisode, exportMainVideo/exportClip — el archivo final en
  // D:\MATERIAL VIDEOS, que YA vive en una carpeta por canal). Ver
  // episodeNamespace.mts para el detalle completo, incluida la excepción
  // deliberada para SIN EXPLICACIÓN (preserva sus ids planos históricos).
  const compositionEpisodeId = namespacedEpisodeId(account, episodeId);

  log("Catalogando videos/imágenes (ffprobe)...");
  const videoItems: VideoPoolItem[] = ep.videoFiles.map((v) => probeVideo(v, `${compositionEpisodeId}/${path.basename(v)}`));
  const imageItems: ImagePoolItem[] = ep.imageFiles.map((im) => probeImage(im, `${compositionEpisodeId}/${path.basename(im)}`));
  log(`  videos=${videoItems.length} imágenes=${imageItems.length}`);

  // whisper es, por lejos, el paso más lento (~30-40 min en CPU para un
  // episodio de ~10 min) — si ya existe una transcripción de una corrida
  // anterior para este episodio, se reusa en vez de repetirla. Los
  // start/end/text de captions-{id}.json son el segmento de whisper crudo,
  // sin tocar (el "type" es lo único que cambia entre corridas).
  const captionsPath = context?.dataRoot
    ? path.join(context.dataRoot, `captions-${compositionEpisodeId}.json`)
    : path.join(import.meta.dirname, "..", "..", "remotion", "data", `captions-${compositionEpisodeId}.json`);
  let segments: RawSegment[];
  if (existsSync(captionsPath) && JSON.parse(readFileSync(captionsPath, "utf-8")).length > 0) {
    log("Reusando transcripción existente (captions-{id}.json ya tiene datos)...");
    const cached = JSON.parse(readFileSync(captionsPath, "utf-8")) as { start: number; end: number; text: string }[];
    segments = cached.map((c) => ({ start: c.start, end: c.end, text: c.text }));
  } else {
    log("Transcribiendo narración (whisper, vía MachineBridge.media)...");
    segments = await media.transcribe(ep.narrationFile!, true);
  }
  // Glosario de nombres propios por canal (lib/transcriptGlossary.ts): corrige
  // errores típicos de Whisper ANTES de etiquetar captions/alinear con el
  // guion, tanto para transcripciones nuevas como reusadas del caché. Solo
  // cambia `text`; canales sin reglas quedan idénticos.
  const glossarySegments = applyTranscriptGlossaryToSegments(segments, account, episodeId);
  const glossaryFixed = glossarySegments.filter((s, i) => s.text !== segments[i].text).length;
  if (glossaryFixed > 0) log(`  glosario: ${glossaryFixed} segmento(s) corregido(s)`);
  segments = glossarySegments;
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
  const { narrationRelPath } = copyEpisodeAssets(compositionEpisodeId, ep.videoFiles, ep.imageFiles, ep.narrationFile!, context?.publicAssetsRoot);

  log("Escribiendo captions-{id}.json, shots-{id}.json y clips-{id}.json (vacío)...");
  writeCaptions(compositionEpisodeId, captions, context?.dataRoot);
  writeShots(compositionEpisodeId, shots, context?.dataRoot);
  ensureEmptyClips(compositionEpisodeId, context?.dataRoot);

  log("Registrando episodio en remotion/lib/episodes.ts...");
  // "Día 1.1" — sección crítica mínima: nextChapterNumber() lee episodes.ts
  // para calcular el próximo número, y registerEpisode() lo relee y reescribe
  // por texto. Si dos episodios ejecutaran esto a la vez (dos workers
  // concurrentes), podrían calcular el mismo chapterNumber o perder la
  // escritura del otro. El mutex serializa SOLO este bloque - nunca el resto
  // de processProject() (whisper/render/etc. siguen sin este lock).
  //
  // Fase 1.4 — el mutex anterior (withEpisodesRegistryLock, EN MEMORIA) solo
  // protege llamadas concurrentes DENTRO de este mismo proceso; ahora que cada
  // episodio puede correr en un proceso Node independiente (worker), hace
  // falta ADEMÁS un lock cruzado-proceso real (withEpisodesFileLock, archivo
  // con creación exclusiva "wx" + token de propiedad — ver
  // episodesFileLock.mts). Se anida AFUERA del mutex existente, que queda sin
  // modificar: el lock de archivo protege entre procesos, el mutex en memoria
  // sigue protegiendo dentro de cada proceso. Ninguno de los dos cubre más
  // que este bloque — nunca processProject() completo.
  const { chapterNumber, registerResult } = await withEpisodesFileLock(
    () =>
      withEpisodesRegistryLock(async () => {
        const num = await nextChapterNumber(context?.episodesFile);
        const result = registerEpisode({
          episodeId: compositionEpisodeId,
          chapterNumber: num,
          narrationRelPath,
          narrationDurationSeconds,
          videoPool: videoItems,
          imagePool: imageItems,
          reelOptions,
          hasShots: true,
          episodesFile: context?.episodesFile,
        });
        return { chapterNumber: num, registerResult: result };
      }),
    // Fase 1.5.5 — bug real encontrado por la prueba E2E: el lock de archivo
    // NUNCA debe usar el mismo path que el CATÁLOGO que protege — son dos
    // archivos distintos por diseño (episodesFileLock.mts crea el suyo con
    // "wx" exclusivo, y lo borra/reemplaza si detecta que quedó "stale"). Usar
    // `context.episodesFile` tal cual como lockFile hacía que, tras ~30s de
    // sondeo sin poder crearlo (el catálogo YA existe), se lo tratara como
    // lock huérfano, se BORRARA, y se reemplazara con el JSON del lock —
    // corrompiendo el catálogo sandbox compartido entre los dos workers.
    // Nunca afectó producción (sin context, cae al LOCK_FILE real de
    // siempre) — es un archivo SEPARADO, derivado pero distinto.
    context?.episodesFile ? { lockFile: `${context.episodesFile}.lock` } : {}
  );
  log(`  ${registerResult === "inserted" ? `insertado, chapterNumber=${chapterNumber}` : "actualizado (ya estaba registrado)"}`);

  log(`Renderizando video largo (esto puede tardar varios minutos, vía RenderProvider "${renderProvider.id}")...`);
  // renderProvider.renderMain() para "documentary-remotion" hace exactamente
  // lo que renderMain() hacía antes de la Fase 4.8: MachineBridge.render con
  // el mismo compositionId y el mismo out/main-{id}.mp4. Sin reuseIfExists ni
  // timeoutMs: se preserva el comportamiento actual (siempre renderiza, sin
  // límite de tiempo).
  //
  // Bloque 1 (post-Fase 6.5) — capacidad OPCIONAL y ADITIVA, detectada por
  // duck typing (isRealDataRenderProvider), nunca por nombre de canal: si el
  // provider resuelto sabe recibir los datos reales de este episodio
  // (captions/videoPool/imagePool/shots/narración — ya calculados arriba con
  // whisper/ffprobe reales, no un dato nuevo), se le pasan en vez de dejar
  // que dependa de defaultProps/fixtures estáticos. "documentary-remotion" y
  // "quote-video-remotion" no implementan esta capacidad — su camino es
  // EXACTAMENTE el de siempre (renderMain sin datos), sin ninguna rama nueva
  // que los afecte.
  const realEpisodeData: RealEpisodeData = {
    captions,
    videoPool: videoItems,
    imagePool: imageItems,
    shots,
    narrationFile: narrationRelPath,
    narrationDurationSeconds,
    reelOptions,
  };
  const mainOut = (
    isRealDataRenderProvider(renderProvider)
      ? await renderProvider.renderMainWithRealData(compositionEpisodeId, realEpisodeData, context)
      : await renderProvider.renderMain(compositionEpisodeId, context)
  ).path;
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
  writeClips(compositionEpisodeId, clips, context?.dataRoot);

  const exportedMain = exportMainVideo(account, episodeId, script.title, mainOut);
  log(`Video largo exportado a: ${exportedMain}`);

  const exportedClips: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    const isSequential = i >= editorialClips.length;
    const label = isSequential ? "Parte" : "Clip";
    const localIndex = isSequential ? i - editorialClips.length : i;
    log(`Renderizando ${label} ${localIndex + 1} (${i + 1}/${clips.length})...`);
    // Bloque 1 — mismo criterio que el render principal: mismos datos reales
    // de episodio, más el rango [startFrame, endFrame) real de ESTE clip
    // (clipSelector.mts ya lo calculó arriba, no un dato nuevo). hookText/
    // objectPosition — cierre de identidad de OBJETOS MALDITOS: clips[i] YA
    // es un ClipMark real con estos dos campos calculados de verdad
    // (clipSelector.mts); antes se descartaban acá silenciosamente.
    const clipOut = (
      isRealDataRenderProvider(renderProvider)
        ? await renderProvider.renderClipWithRealData(
            compositionEpisodeId,
            i,
            { ...realEpisodeData, startFrame: clips[i].startFrame, endFrame: clips[i].endFrame, hookText: clips[i].hookText, objectPosition: clips[i].objectPosition },
            context
          )
        : await renderProvider.renderClip(compositionEpisodeId, i, context)
    ).path;
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

// Fase 1.4 (workers multiproceso) — mapeo PURO ProcessResult -> exit code,
// exportado para poder probarlo directamente sin invocar processProject() ni
// spawnear ningún proceso real. Contrato exacto pedido: COMPLETED=0,
// WAITING_FOR_MATERIAL=3 (antes compartía el 0 con COMPLETED sin que nadie
// necesitara distinguirlos automáticamente — ahora el coordinador SÍ
// necesita diferenciarlos para decidir si corre el post-proceso de éxito o
// no, ver agent.mts), cualquier otro resultado (NOT_AUTHORIZED,
// MAIN_QA_FAILED) = 1. El exit code es la ÚNICA señal que el coordinador usa
// para decidir el resultado — no se agrega ningún archivo de resultado ni se
// parsea stdout/stderr.
export function resultToExitCode(result: ProcessResult): number {
  if (result.status === "COMPLETED") return 0;
  if (result.status === "WAITING_FOR_MATERIAL") return 3;
  return 1; // NOT_AUTHORIZED | MAIN_QA_FAILED
}

// Fase 1.5.3 — único punto donde un PipelineExecutionContext se construye a
// partir de variables de entorno: es el canal que existe para pasarle
// contexto a un worker que es un PROCESO SEPARADO (spawn), ya que no hay
// ningún otro canal hacia el CLI real más que argv/env (regla ya establecida
// desde Fase 1.4: "no archivo de resultado, no IPC nuevo"). Producción real
// NUNCA setea estas variables — ausentes, `buildContextFromEnv()` devuelve
// `undefined` y processProject() sigue su camino real exacto.
function buildContextFromEnv(): PipelineExecutionContext | undefined {
  const episodesFile = process.env.PIPELINE_TEST_EPISODES_FILE;
  const dataRoot = process.env.PIPELINE_TEST_DATA_ROOT;
  const publicAssetsRoot = process.env.PIPELINE_TEST_PUBLIC_ROOT;
  const outputRoot = process.env.PIPELINE_TEST_OUTPUT_ROOT;
  // Fase 1.5.5 — "" (string vacío) se trata IGUAL que ausente (nunca activa
  // el bypass) — `||` en vez de lectura directa, a propósito.
  const renderProviderId = process.env.PIPELINE_TEST_RENDER_PROVIDER_ID || undefined;

  const hasAnyRoute = episodesFile || dataRoot || publicAssetsRoot || outputRoot;
  if (!hasAnyRoute) {
    // Fase 1.5.5 — un renderProviderId sin el contexto sandbox completo NUNCA
    // es válido por sí solo: fail-closed explícito, nunca se ignora en silencio.
    if (renderProviderId) {
      throw new Error(
        "PIPELINE_TEST_RENDER_PROVIDER_ID está presente sin las 4 rutas de sandbox " +
          "(PIPELINE_TEST_EPISODES_FILE/DATA_ROOT/PUBLIC_ROOT/OUTPUT_ROOT) — fail-closed, nunca se activa un bypass parcial."
      );
    }
    return undefined;
  }
  if (!episodesFile || !dataRoot || !publicAssetsRoot || !outputRoot) {
    throw new Error(
      "PipelineExecutionContext parcial: si se define una variable PIPELINE_TEST_*, las cuatro deben estar presentes " +
        "(episodesFile/dataRoot/publicAssetsRoot/outputRoot) — fail-closed, nunca se completa a medias."
    );
  }
  // renderProviderId es OPCIONAL dentro de un contexto ya completo — su
  // validez contra RENDER_PROVIDERS se comprueba dentro de processProject(),
  // nunca acá (acá solo se decide si el campo viaja o no).
  return { episodesFile, dataRoot, publicAssetsRoot, outputRoot, ...(renderProviderId ? { renderProviderId } : {}) };
}

// --- CLI manual: solo parsea argv, llama processProject y traduce el
// resultado a exit code — cero lógica de producción acá. ---
async function cli() {
  const [account, episodeId] = process.argv.slice(2);
  if (!account || !episodeId) {
    console.error('Uso: npx tsx scripts/pipeline/processOne.mts "SIN EXPLICACIÓN" 008');
    process.exit(1);
  }

  const result = await processProject(account, episodeId, buildContextFromEnv());
  if (result.status === "WAITING_FOR_MATERIAL") {
    log(`Estado: WAITING_FOR_MATERIAL — ${result.reason}`);
  }
  if (result.status === "NOT_AUTHORIZED") {
    log(`Estado: NOT_AUTHORIZED — ${result.reason}`);
    log(`  Autorizar primero con: npm run pipeline:authorize -- "${account}" ${episodeId}`);
  }
  process.exit(resultToExitCode(result));
}

const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  cli().catch((err) => {
    console.error("Error en el pipeline:", err);
    process.exit(1);
  });
}
