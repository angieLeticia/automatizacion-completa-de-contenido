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

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const RENDER_OUTPUT_ROOT = path.join(REPO_ROOT, "out");

export class UnknownCompositionError extends Error {
  constructor(compositionId: string, reason: string) {
    super(`Composición desconocida "${compositionId}": ${reason}`);
  }
}

function requireSafeOutputPath(outputPath: string): string {
  const resolved = resolveSafePath(RENDER_OUTPUT_ROOT, outputPath);
  if (!resolved) throw new PathViolationError(RENDER_OUTPUT_ROOT, outputPath);
  return resolved;
}

// Valida compositionId contra los episodios/clips reales de
// remotion/lib/episodes.ts — exactamente los dos patrones que
// renderMain/renderShort producen hoy (MainDocumentary-<id> | Short-<id>-<n>).
// Cualquier otro id (incluidos Intro/Chapter-N/ClosingCTA, que no forman
// parte del flujo automático de Agente 2) se rechaza: MachineBridge.render
// no es un `remotion render <lo-que-sea>` genérico.
async function assertCompositionExists(compositionId: string): Promise<void> {
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
      'no coincide con ningún patrón soportado ("MainDocumentary-<id>" | "Short-<id>-<n>" | "Quote-alza-la-voz-<videoId>-<vertical|square>")'
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
  const mod = await import(`../../remotion/lib/episodes.ts?t=${Date.now()}`);
  if (mainMatch) {
    const episodeId = mainMatch[1];
    if (!mod.episodes.some((e: { id: string }) => e.id === episodeId)) {
      throw new UnknownCompositionError(compositionId, `no existe ningún episodio registrado con id="${episodeId}"`);
    }
    return;
  }
  const episodeId = shortMatch![1];
  const clipIndex = Number(shortMatch![2]);
  const episode = mod.episodes.find((e: { id: string }) => e.id === episodeId);
  if (!episode) {
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
  const clipsJsonPath = path.join(REPO_ROOT, "remotion", "data", `clips-${episodeId}.json`);
  let realClipCount = Array.isArray(episode.clips) ? episode.clips.length : 0;
  if (existsSync(clipsJsonPath)) {
    try {
      const realClips = JSON.parse(readFileSync(clipsJsonPath, "utf-8"));
      if (Array.isArray(realClips)) realClipCount = realClips.length;
    } catch {
      // Si el JSON está corrupto/a medio escribir, se cae al valor de episode.clips
      // (comportamiento anterior) en vez de fallar de forma ambigua acá.
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
    await assertCompositionExists(compositionId);
    const safeOutputPath = requireSafeOutputPath(outputPath);

    if (opts?.reuseIfExists) {
      const existingHash = await existingValidRender(safeOutputPath);
      if (existingHash) {
        return { path: safeOutputPath, hash: existingHash, reused: true };
      }
    }

    const outRelPath = path.relative(REPO_ROOT, safeOutputPath);
    renderCompositionImpl(compositionId, outRelPath, { timeoutMs: opts?.timeoutMs });
    if (!existsSync(safeOutputPath)) {
      throw new Error(`El render terminó sin errores pero no se encontró el archivo esperado: ${safeOutputPath}`);
    }
    const hash = await hashFileImpl(safeOutputPath);
    return { path: safeOutputPath, hash, reused: false };
  },
};
