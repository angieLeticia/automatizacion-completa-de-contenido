// Configuracion de la Fase 3 (analisis de contenido + metadata con LLM local).
// Modulo aislado: no importa nada de scripts/pipeline ni de agent/validateFile.mts,
// a proposito, para no arriesgar el codigo ya probado de la Fase 2.
import path from "node:path";

try {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", ".env.local"));
} catch {
  // .env.local no existe o ya esta cargado por el shell - seguimos sin frenar.
}

export const WHISPER_MODEL = process.env.WHISPER_MODEL || "medium";

// --- LLM: 100% local, $0 por video ---
// LLM_PROVIDER solo admite "local" en esta version (Ollama). Ver agent/analyze/llm/index.mts.
export const LLM_PROVIDER = process.env.LLM_PROVIDER || "local";
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5vl:3b";
export const OLLAMA_MAX_OUTPUT_TOKENS = 1200;

export const MAX_RETRIES = 3;
export const POLL_INTERVAL_MS = 30_000;
export const STALE_CLAIM_MINUTES = 30;

export const MIN_TRANSCRIPT_CHARS_FOR_SPEECH = 15;

// Version del esquema/prompt de metadata - subir este numero si en el futuro se
// cambia sustancialmente el prompt o la forma esperada del JSON.
export const METADATA_SCHEMA_VERSION = 3; // v3 = arquitectura de analisis canonico + generacion deterministica (Opcion C)

// Identidad editorial de una cuenta de contenido (content_accounts.style).
// Vive aqui (no en buildCanonicalPrompt.mts) porque la usan varios modulos:
// generateMetadata.mts (relevancia de hashtags_base) y validateMetadata.mts
// (palabras_prohibidas) - el analisis canonico en si NO la necesita, es
// agnostico de cuenta a proposito (ver decision de Fase 3, Opcion C).
export interface AccountStyle {
  tono?: string;
  temas?: string[];
  hashtags_base?: string[];
  palabras_prohibidas?: string[];
}

export const HASHTAG_MIN_COUNT = 3;
export const HASHTAG_MAX_COUNT = 15;

export const PLATFORM_LIMITS = {
  youtube: { titleMax: 100, descMin: 50, descMax: 5000 },
  youtube_shorts: { titleMax: 100, descMin: 30, descMax: 1000 },
  instagram_reels: { titleMax: 100, descMin: 30, descMax: 2200 },
  facebook_reels: { titleMax: 100, descMin: 30, descMax: 2000 },
  tiktok: { titleMax: 100, descMin: 20, descMax: 2200 },
} as const;
export type PlatformKey = keyof typeof PLATFORM_LIMITS;

// Que claves de "platforms" se le piden al LLM segun el tipo de carpeta de origen.
export const PLATFORMS_BY_FOLDER_TYPE: Record<"completo" | "clip", PlatformKey[]> = {
  completo: ["youtube"],
  clip: ["youtube_shorts", "instagram_reels", "facebook_reels", "tiktok"],
};

// Salvaguarda: si alguna vez OLLAMA_BASE_URL se configura mal, el agente debe negarse
// a arrancar en vez de mandar transcripciones/contenido a una URL desconocida.
export function assertOllamaUrlIsLocal(): void {
  const url = new URL(OLLAMA_BASE_URL);
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(
      `OLLAMA_BASE_URL="${OLLAMA_BASE_URL}" no apunta a localhost/127.0.0.1 - se rechaza por seguridad (LLM_PROVIDER="local" solo debe hablar con Ollama en esta misma PC).`
    );
  }
}
