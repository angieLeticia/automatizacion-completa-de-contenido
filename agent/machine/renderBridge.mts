// Implementación real de RenderBridge (Fase 4.5). Envuelve
// scripts/pipeline/renderer.mts::renderComposition (exportada en esta misma
// fase — antes era privada) SIN reescribir la invocación real de
// `npx remotion render`. No existe ninguna forma de pedir un compositionId
// arbitrario: se valida contra los episodios/clips REALMENTE registrados en
// remotion/lib/episodes.ts (los mismos que Root.tsx usa para registrar
// composiciones), no contra una lista inventada aparte.
import path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolveSafeSubmissionPath as resolveSafePath } from "../ingestion/pathSafety.mts";
import { hashFile as hashFileImpl } from "./hashFile.mts";
import { renderComposition as renderCompositionImpl } from "../../scripts/pipeline/renderer.mts";
import type { RenderBridge } from "./types.mts";
import { PathViolationError } from "./machineBridge.mts";
import type { PipelineExecutionContext } from "../../scripts/pipeline/pipelineExecutionContext.mts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const RENDER_OUTPUT_ROOT = path.join(REPO_ROOT, "out");

export class UnknownCompositionError extends Error {
  constructor(compositionId: string, reason: string) {
    super(`Composición desconocida "${compositionId}": ${reason}`);
  }
}

// Fase 1.5.3 — `outputRoot` opcional: SIN contexto (producción real), la
// única raíz válida sigue siendo RENDER_OUTPUT_ROOT (out/ real), exactamente
// como antes — nunca se convierte en una allowlist genérica. CON contexto, se
// valida contra `outputRoot` (context.outputRoot) EN VEZ DE RENDER_OUTPUT_ROOT
// (no además de — un solo root válido por llamada, fail-closed: una ruta que
// intente escapar del root activo con "../" sigue siendo rechazada por
// resolveSafeSubmissionPath, sin cambios en esa función).
function requireSafeOutputPath(outputPath: string, outputRoot: string = RENDER_OUTPUT_ROOT): string {
  const resolved = resolveSafePath(outputRoot, outputPath);
  if (!resolved) throw new PathViolationError(outputRoot, outputPath);
  return resolved;
}

// Valida compositionId contra los episodios/clips reales de
// remotion/lib/episodes.ts — exactamente los dos patrones que
// renderMain/renderShort producen hoy (MainDocumentary-<id> | Short-<id>-<n>).
// Cualquier otro id (incluidos Intro/Chapter-N/ClosingCTA, que no forman
// parte del flujo automático de Agente 2) se rechaza: MachineBridge.render
// no es un `remotion render <lo-que-sea>` genérico.
// Fase 1.5.3 — `context` opcional: SIN él (producción real), valida contra
// remotion/lib/episodes.ts y remotion/data/clips-{id}.json REALES, exactamente
// como antes. CON él, valida contra context.episodesFile/context.dataRoot —
// nunca contra ambos a la vez, nunca "además de" el catálogo real (fail-closed:
// un compositionId sandbox no puede colarse validándose contra el catálogo real).
// FASE 5.10-AR (Fase 5 — provider de ENCIENDE EL CAOS) — composiciones de ID
// FIJO, nunca per-episodio (ver Fase 4: ChaosNewsMain/ChaosNewsClip se
// registran UNA sola vez en Root.tsx, sin episode_id embebido — a
// diferencia de MainDocumentary/Short/Quote-alza-la-voz, que sí varían por
// episodio/video real y necesitan validarse contra un catálogo). No
// requieren ningún catálogo externo: si el id coincide exactamente con uno
// de estos dos, SIEMPRE existe (están registrados incondicionalmente en
// Root.tsx, confirmado con `npx remotion compositions` en Fase 4). Cambio
// puramente aditivo — ningún patrón/rama existente se modificó.
// FASE 9 — LunaVerdeMain/LunaVerdeClip/ObjetosMalditosMain/ObjetosMalditosClip
// agregados por el MISMO motivo exacto que ChaosNewsMain/ChaosNewsClip
// (Fase 5.10-AR): id fijo, registrado una sola vez en Root.tsx, sin
// episode_id embebido — cambio puramente aditivo.
const FIXED_COMPOSITION_IDS = new Set(["ChaosNewsMain", "ChaosNewsClip", "LunaVerdeMain", "LunaVerdeClip", "ObjetosMalditosMain", "ObjetosMalditosClip"]);

async function assertCompositionExists(compositionId: string, context?: PipelineExecutionContext): Promise<void> {
  if (FIXED_COMPOSITION_IDS.has(compositionId)) return;

  const mainMatch = compositionId.match(/^MainDocumentary-(.+)$/);
  const shortMatch = compositionId.match(/^Short-(.+)-(\d+)$/);
  // Fase 5.1 — patrón nuevo para el template QuoteVideo (migrado del
  // repositorio externo de ALZA LA VOZ). Se valida contra los videos REALES
  // registrados en channels/alza-la-voz/videos.ts, nunca contra una lista
  // inventada — mismo principio que MainDocumentary/Short contra episodes.ts.
  const quoteMatch = compositionId.match(/^Quote-alza-la-voz-(.+)-(vertical|square)$/);
  if (!mainMatch && !shortMatch && !quoteMatch) {
    throw new UnknownCompositionError(
      compositionId,
      'no coincide con ningún patrón soportado ("MainDocumentary-<id>" | "Short-<id>-<n>" | "Quote-alza-la-voz-<videoId>-<vertical|square>" | "ChaosNewsMain" | "ChaosNewsClip")'
    );
  }
  if (quoteMatch) {
    const videoId = quoteMatch[1];
    const { videos } = await import(`../../channels/alza-la-voz/videos.ts?t=${Date.now()}`);
    if (!videos.some((v: { id: string }) => v.id === videoId)) {
      throw new UnknownCompositionError(compositionId, `no existe ningún video registrado con id="${videoId}" en channels/alza-la-voz/videos.ts`);
    }
    return;
  }
  // Fase 5.1 — cache-busting deliberado: import() de un mismo specifier queda
  // cacheado por Node durante todo el proceso. Si esta es la PRIMERA vez que
  // se registra un episodio (registerEpisode() lo acaba de escribir a disco
  // en esta misma corrida de processProject(), ANTES de llegar acá), un
  // import() sin cache-bust devolvería la versión vieja de episodes.ts —
  // exactamente el episodio que se busca NO estaría todavía en esa versión
  // cacheada, aunque sí esté en el archivo real. Forzar un specifier distinto
  // por llamada garantiza leer el archivo real tal cual está en disco ahora.
  // No cambia nada para episodios ya registrados antes del proceso (ahí la
  // versión cacheada y la real ya coincidían).
  //
  // Fase 1.5.5 — para el catálogo SANDBOX (context.episodesFile) se evita
  // import() por completo: tsx no logra aplicar su hook ESM/TS a un archivo
  // fuera del proyecto cuando se usa cache-busting "?t=" (falla con
  // MODULE_NOT_FOUND, sea el specifier relativo o absoluto — limitación real
  // de tsx, no de este código). Se comprueba la existencia leyendo el archivo
  // como TEXTO (mismo mecanismo que episodeRegistrar.mts::registerEpisode()
  // ya usa para su propio chequeo "¿ya registrado?") — nunca hace falta
  // cache-busting acá porque leer texto siempre da el contenido real en
  // disco. Producción (sin contexto) sigue usando EXACTAMENTE el import()
  // original, sin cambios.
  const episodeExistsInCatalog = async (episodeId: string): Promise<boolean> => {
    if (context?.episodesFile) {
      const src = readFileSync(context.episodesFile, "utf-8");
      return src.includes(`id: "${episodeId}"`);
    }
    const mod = await import(`../../remotion/lib/episodes.ts?t=${Date.now()}`);
    return mod.episodes.some((e: { id: string }) => e.id === episodeId);
  };

  if (mainMatch) {
    const episodeId = mainMatch[1];
    if (!(await episodeExistsInCatalog(episodeId))) {
      throw new UnknownCompositionError(compositionId, `no existe ningún episodio registrado con id="${episodeId}"`);
    }
    return;
  }
  const episodeId = shortMatch![1];
  const clipIndex = Number(shortMatch![2]);
  if (!(await episodeExistsInCatalog(episodeId))) {
    throw new UnknownCompositionError(compositionId, `no existe ningún episodio registrado con id="${episodeId}"`);
  }
  // Fase 5.1 — NO usar episode.clips acá: ese array llega de un import()
  // estático DENTRO de episodes.ts (`rawClips<id>` <- clips-<id>.json), que
  // tiene su PROPIO cache de módulo independiente del cache-bust de arriba
  // (el cache-bust solo fuerza releer episodes.ts, no sus imports internos).
  // Si writeClips() acaba de escribir los clips reales de esta misma corrida
  // DESPUÉS de que algo ya importó episodes.ts por primera vez (siempre pasa:
  // nextChapterNumber() en processOne.mts lo importa antes de registerEpisode()),
  // episode.clips seguiría viendo el array vacío de ensureEmptyClips(). Leer
  // el JSON directo del disco (sin ningún import, sin cache posible) es la
  // única forma de ver el valor real. No se duplica el TIPO (ClipMark), solo
  // se lee su longitud real.
  const clipsJsonPath = context?.dataRoot
    ? path.join(context.dataRoot, `clips-${episodeId}.json`)
    : path.join(REPO_ROOT, "remotion", "data", `clips-${episodeId}.json`);
  // Fase 1.5.5 — el fallback (si clipsJsonPath no existiera todavía) solo
  // puede venir de episode.clips en producción (requiere el import() real);
  // en sandbox, dado que episodeExistsInCatalog() ya confirmó por texto que
  // el episodio existe, y ensureEmptyClips()/writeClips() SIEMPRE escriben
  // clips-{id}.json antes de llegar a este punto real del pipeline, el
  // fallback nunca debería ejercitarse — se usa 0 en vez de requerir un
  // import() adicional que fallaría por el mismo motivo ya documentado arriba.
  let realClipCount = 0;
  if (!context?.episodesFile) {
    const mod = await import(`../../remotion/lib/episodes.ts?t=${Date.now()}`);
    const episode = mod.episodes.find((e: { id: string }) => e.id === episodeId);
    realClipCount = Array.isArray(episode?.clips) ? episode.clips.length : 0;
  }
  if (existsSync(clipsJsonPath)) {
    try {
      const realClips = JSON.parse(readFileSync(clipsJsonPath, "utf-8"));
      if (Array.isArray(realClips)) realClipCount = realClips.length;
    } catch {
      // Si el JSON está corrupto/a medio escribir, se cae al valor ya
      // calculado arriba (comportamiento anterior) en vez de fallar de forma
      // ambigua acá.
    }
  }
  if (clipIndex >= realClipCount) {
    throw new UnknownCompositionError(compositionId, `el episodio "${episodeId}" no tiene un clip en el índice ${clipIndex}`);
  }
}

// "Válido" para reuseIfExists es deliberadamente simple (existencia + tamaño
// + legibilidad real vía hash) — no repite la validación audiovisual de
// checkRenderedVideo/checkClip (ffprobe, tolerancia de duración), que es una
// responsabilidad distinta y ya cubierta donde corresponde (qualityChecker.mts).
async function existingValidRender(absPath: string): Promise<string | null> {
  try {
    const st = statSync(absPath);
    if (!st.isFile() || st.size === 0) return null;
    return await hashFileImpl(absPath);
  } catch {
    return null;
  }
}

export const renderBridge: RenderBridge = {
  async renderComposition(compositionId, outputPath, opts) {
    await assertCompositionExists(compositionId, opts?.context);
    // Fase 1.5.3 — dos roots distintos, a propósito, igual que la lógica
    // original: `containmentRoot` es contra qué se valida que `outputPath` no
    // escape (RENDER_OUTPUT_ROOT=REPO_ROOT/out en producción, sin cambios).
    // `relativeBase` es la raíz contra la que se calcula el path RELATIVO que
    // se le pasa a renderer.mts — en producción es REPO_ROOT (bare, SIN "/out"),
    // precisamente para que el prefijo "out/" sobreviva en ese relativo, tal
    // como renderer.mts::renderMain/renderShort ya lo esperan (unen ese
    // relativo contra REPO_ROOT de nuevo). En sandbox, renderer.mts une el
    // relativo directamente contra context.outputRoot (ver Bloque C) — no hay
    // una carpeta "out" anidada dentro del sandbox más que la que el propio
    // TEST_ROOT/out ya representa, así que ambos roots coinciden.
    const containmentRoot = opts?.context?.outputRoot ?? RENDER_OUTPUT_ROOT;
    const relativeBase = opts?.context?.outputRoot ?? REPO_ROOT;
    const safeOutputPath = requireSafeOutputPath(outputPath, containmentRoot);

    if (opts?.reuseIfExists) {
      const existingHash = await existingValidRender(safeOutputPath);
      if (existingHash) {
        return { path: safeOutputPath, hash: existingHash, reused: true };
      }
    }

    const outRelPath = path.relative(relativeBase, safeOutputPath);
    renderCompositionImpl(compositionId, outRelPath, { timeoutMs: opts?.timeoutMs, context: opts?.context, props: opts?.props });
    if (!existsSync(safeOutputPath)) {
      throw new Error(`El render terminó sin errores pero no se encontró el archivo esperado: ${safeOutputPath}`);
    }
    const hash = await hashFileImpl(safeOutputPath);
    return { path: safeOutputPath, hash, reused: false };
  },
};
