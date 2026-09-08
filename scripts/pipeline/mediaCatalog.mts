import { execFileSync } from "node:child_process";
import path from "node:path";
import type { SourceImage, SourceVideo } from "../../remotion/lib/broll.ts";
import { normalizeWord } from "./textUtils.mts";

type FfprobeStream = { width?: number; height?: number; duration?: string };
type FfprobeOutput = { streams: FfprobeStream[]; format?: { duration?: string } };

const runFfprobe = (file: string): FfprobeOutput => {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=width,height,duration", "-show_entries", "format=duration", "-of", "json", file],
    { encoding: "utf-8" }
  );
  return JSON.parse(out) as FfprobeOutput;
};

// Palabras sin valor semántico en nombres de stock footage (proveedor,
// resolución, fps, ids numéricos) — se descartan al extraer keywords.
const STOPWORDS = new Set([
  "mixkit", "pexels", "wikimedia", "uhd", "hd", "sd", "4k", "fps", "medium", "small", "large",
  "image", "images", "img", "video", "whatsapp", "at", "pm", "am", "png", "jpg", "jpeg", "webp",
  "jfif", "gif", "mp4", "mov",
]);

export const extractKeywords = (filePath: string): string[] => {
  const base = path.basename(filePath, path.extname(filePath));
  const tokens = base
    .split(/[^a-záéíóúñü]+/i)
    .map(normalizeWord)
    .filter((t) => t.length > 2 && !/^\d+$/.test(t) && !STOPWORDS.has(t) && !/^\d+p$/.test(t));
  return [...new Set(tokens)];
};

export type VideoPoolItem = SourceVideo & { keywords: string[] };
export type ImagePoolItem = SourceImage & { keywords: string[] };

// `publicRelPath` es la ruta con la que el recurso quedará bajo
// public/assets/{video,images}/ tras copiarse (típicamente "{episodeId}/{basename}") —
// no la ruta de origen en Material Videos, que se descarta tras la copia.
export const probeVideo = (filePath: string, publicRelPath: string): VideoPoolItem => {
  const info = runFfprobe(filePath);
  const stream = info.streams.find((s) => s.width && s.height) ?? info.streams[0] ?? {};
  const durationSec = Number(stream.duration ?? info.format?.duration ?? 0);
  return {
    kind: "video",
    file: publicRelPath,
    durationSec,
    width: stream.width ?? 0,
    height: stream.height ?? 0,
    keywords: extractKeywords(filePath),
  };
};

export const probeImage = (filePath: string, publicRelPath: string): ImagePoolItem => {
  const info = runFfprobe(filePath);
  const stream = info.streams[0] ?? {};
  return {
    kind: "image",
    file: publicRelPath,
    width: stream.width ?? 0,
    height: stream.height ?? 0,
    keywords: extractKeywords(filePath),
  };
};

export const probeAudioDurationSeconds = (filePath: string): number => {
  const info = runFfprobe(filePath);
  const stream = info.streams[0] ?? {};
  return Number(stream.duration ?? info.format?.duration ?? 0);
};
