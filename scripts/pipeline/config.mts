// Configuración compartida del pipeline de producción audiovisual.
// Ver plan: agente autónomo por cuenta sobre D:\MATERIAL VIDEOS.
import { resolveScannableChannels } from "./channelRegistry.mts";

export const MATERIAL_ROOT = process.env.MATERIAL_ROOT || "D:\\MATERIAL VIDEOS";

// Fase 4.8 — ya NO es un literal fijo: se resuelve desde channelRegistry.mts
// (canales con estado ACTIVE/READY/TEST Y un RenderProvider real). Hoy
// resuelve exactamente a ["SIN EXPLICACIÓN"] porque es el único canal que
// cumple ambas condiciones — agregar un RenderProvider nuevo para otro canal
// alcanza para que empiece a escanearse, sin tocar este archivo ni agent.mts.
export const ACCOUNTS: readonly string[] = resolveScannableChannels();
export type AccountName = string;

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
