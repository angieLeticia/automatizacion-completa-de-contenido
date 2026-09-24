// Configuración compartida del pipeline de producción audiovisual.
// Ver plan: agente autónomo por cuenta sobre D:\MATERIAL VIDEOS.
import path from "node:path";
import { resolveScannableChannels } from "./channelRegistry.mts";

// NOTA (Fase 5.10-B): MATERIAL_ROOT/ACCOUNTS de aquí abajo se mantienen SIN
// CAMBIOS a propósito — varios archivos (clipSelector.mts, exportManager.mts,
// materialScanner.mts, processOne.mts, y los tests
// test-authorization-gate.mts/test-concurrent-workers.mts/test-sandbox-e2e-fase155.mts)
// importan este modulo sin nunca fijar RUN_SCOPE, y JS evalua TODO el cuerpo
// de un modulo al importarlo (no solo el export que se usa) - si el parsing
// fail-closed de RUN_SCOPE viviera aqui arriba, romperia esos importadores
// sin necesidad. Por eso la integracion de RUN_SCOPE para Agent 2 vive en
// resolveAgentTwoScope() (mas abajo), una funcion normal NUNCA invocada al
// importar - solo scripts/pipeline/agent.mts::main() la llama, y solo
// cuando el proceso arranca de verdad (guard isMainModule).
export const MATERIAL_ROOT = process.env.MATERIAL_ROOT || "D:\\MATERIAL VIDEOS";

// Fase 4.8 — ya NO es un literal fijo: se resuelve desde channelRegistry.mts
// (canales con estado ACTIVE/READY/TEST Y un RenderProvider real). Hoy
// resuelve exactamente a ["SIN EXPLICACIÓN"] porque es el único canal que
// cumple ambas condiciones — agregar un RenderProvider nuevo para otro canal
// alcanza para que empiece a escanearse, sin tocar este archivo ni agent.mts.
export const ACCOUNTS: readonly string[] = resolveScannableChannels();
export type AccountName = string;

// ---------------------------------------------------------------------------
// Fase 5.10-B — integración de RUN_SCOPE para Agent 2 (scripts/pipeline/agent.mts).
// Patrón "copiado, no importado" ya establecido en este repo para cruzar la
// frontera agent/ <-> scripts/pipeline/ (Agent 2 nunca importa
// agent/runScope.mts ni supabaseClient.mts — arquitectura Fase 2.1, sin
// cambios): se duplica aquí, en forma mínima, la misma lógica fail-closed de
// parsing de RUN_SCOPE y de normalización de MATERIAL_ROOT que
// agent/runScope.mts ya usa (path.win32.resolve — ver el hallazgo 7.3 de la
// revisión de Fase 5.10-A).
// ---------------------------------------------------------------------------
export type PipelineRunScopeName = "PRODUCTION" | "TEST";

export interface PipelineRunScope {
  runScope: PipelineRunScopeName;
  accounts: readonly string[];
  materialRoot: string;
}

// Decision K.1 — lista CERRADA de los 4 canales reales, la MISMA que
// agent/runScope.mts::PRODUCTION_FOLDER_NAMES (duplicada a propósito, nunca
// derivada de channelRegistry.mts's channelStatus, que es un espejo LOCAL
// desincronizado de Supabase — ver ese archivo).
const PRODUCTION_FOLDER_NAMES = ["SIN EXPLICACIÓN", "ENCIENDE EL CAOS", "LUNA VERDE", "OBJETOS MALDITOS"] as const;
const REAL_MATERIAL_ROOT = "D:\\MATERIAL VIDEOS";

function parsePipelineRunScopeName(raw: string | undefined): PipelineRunScopeName {
  if (raw === "PRODUCTION" || raw === "TEST") return raw;
  throw new Error(
    `RUN_SCOPE ${raw === undefined || raw === "" ? "ausente" : `inválido ('${raw}')`} — Agent 2 exige exactamente 'PRODUCTION' o 'TEST'. Fail-closed (Fase 5.10) — nunca "procesa todo".`
  );
}

function normalizePipelinePath(p: string): string {
  return path.win32.resolve(p.trim()).toLowerCase();
}

function resolvePipelineMaterialRootFor(scope: PipelineRunScopeName, env: NodeJS.ProcessEnv): string {
  const raw = env.MATERIAL_ROOT;
  if (scope === "PRODUCTION") {
    return raw && raw.trim().length > 0 ? raw.trim() : REAL_MATERIAL_ROOT;
  }
  if (!raw || raw.trim().length === 0) {
    throw new Error("RUN_SCOPE=TEST requiere MATERIAL_ROOT explícito — ausente. Agent 2 detenido, NUNCA usa D:\\MATERIAL VIDEOS como fallback para TEST.");
  }
  if (normalizePipelinePath(raw) === normalizePipelinePath(REAL_MATERIAL_ROOT)) {
    throw new Error(`RUN_SCOPE=TEST no puede usar MATERIAL_ROOT='${raw}' — coincide con la ruta real de producción. Agent 2 detenido.`);
  }
  return raw.trim();
}

// Fase 5.10-B — Agent 2 PRODUCTION escanea la intersección entre lo que
// channelRegistry.mts ya considera "escaneable" (canal con RenderProvider
// real, sin cambios) y la lista cerrada de las 4 cuentas reales — nunca más
// que eso. Agent 2 TEST devuelve [] deliberadamente: a diferencia de
// Analyze/Schedule/Publish, Agent 2 nunca consulta Supabase directamente
// (arquitectura Fase 2.1) y channelRegistry.mts NO es fuente de verdad para
// TEST (Decision K.1) — sin un mecanismo propio para resolver qué carpetas
// son TEST, la opción segura es escanear CERO carpetas bajo TEST, nunca las
// 4 reales. Limitación conocida, documentada aquí a propósito.
export function resolveAgentTwoScope(env: NodeJS.ProcessEnv = process.env): PipelineRunScope {
  const runScope = parsePipelineRunScopeName(env.RUN_SCOPE);
  const materialRoot = resolvePipelineMaterialRootFor(runScope, env);
  const accounts =
    runScope === "PRODUCTION" ? resolveScannableChannels().filter((name) => (PRODUCTION_FOLDER_NAMES as readonly string[]).includes(name)) : [];
  return { runScope, accounts, materialRoot };
}

// Carpetas de salida dentro de cada cuenta — nunca se escanean como entrada.
export const OUTPUT_FOLDER_NAMES = ["Videos YouTube Completos", "Clips"];

// Carpetas de episodio válidas: nombre puramente numérico (001, 002, ...).
export const EPISODE_FOLDER_RE = /^\d+$/;

export const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv"]);
export const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".jfif", ".gif"]);
export const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a"]);

// Narración: archivo de audio suelto en la raíz del episodio, nombrado
// Narracion*.mp3|wav o Voz*.mp3|wav (junto al Guion, sin subcarpeta nueva).
export const NARRATION_FILE_RE = /^(narracion|voz)/i;
export const SCRIPT_FILE_RE = /^guion/i;

export const FILE_STABILITY_SECONDS = Number(process.env.FILE_STABILITY_SECONDS ?? 10);

// "Día 1" (cola de producción concurrente) — cuántos episodios puede tener
// EN PROCESO al mismo tiempo un único proceso agent.mts. Distinto y
// complementario del lock de instancia única de agentLock.mts (que sigue
// impidiendo un SEGUNDO proceso agent.mts completo) - esto es concurrencia
// DENTRO de un mismo proceso, mediante N "slots" de worker. Default 2 por
// pedido explícito; MAX_WORKERS=1 preserva el comportamiento secuencial
// anterior (un episodio a la vez).
export const MAX_WORKERS = Math.max(1, Number(process.env.MAX_WORKERS ?? 2));

// Filtro opcional SOLO para pruebas controladas del agente (ver agent.mts):
// lista de episode ids separados por coma. Si está vacío (default en
// producción), el agente evalúa todos los episodios de cada cuenta como
// siempre. Se usa para poder probar la mecánica del agente contra un único
// episodio real sin arriesgar que dispare producción real (y gasto real de
// ElevenLabs) sobre otros episodios incompletos que todavía no deberían
// tocarse en esa prueba puntual.
export const EPISODE_FILTER: string[] | null = process.env.EPISODE_FILTER
  ? process.env.EPISODE_FILTER.split(",").map((s) => s.trim()).filter(Boolean)
  : null;

// Duración objetivo del video largo y de cada clip corto.
export const MAIN_TARGET_MIN_SECONDS = 10 * 60;
export const MAIN_TARGET_MAX_SECONDS = 15 * 60;
export const CLIP_MIN_SECONDS = 60;
export const CLIP_MAX_SECONDS = 120;
