// Genera deterministicamente (CERO llamadas adicionales a Ollama) las variantes
// de metadata por plataforma, a partir del analisis canonico del contenido real.
//
// Las descripciones difieren por CONSTRUCCION (una funcion de plantilla distinta
// por plataforma, con distintos campos fuente y distinto texto de cierre) - no
// porque se le pida "amablemente" al modelo que varie. Esa fue exactamente la
// causa de los 3 fallos reales observados con la arquitectura de una sola llamada
// pidiendo las 4 plataformas juntas (ver decision de Fase 3, Opcion C).
import { PLATFORM_LIMITS, PLATFORMS_BY_FOLDER_TYPE, type AccountStyle, type PlatformKey } from "./config.mts";
import type { CanonicalAnalysis } from "./validateCanonical.mts";

export interface PlatformMetadata {
  title: string;
  description: string;
  hashtags: string[];
}
export interface GeneratedMetadata {
  topic_summary: string;
  platforms: Partial<Record<PlatformKey, PlatformMetadata>>;
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function tokenize(text: string): Set<string> {
  return new Set(
    stripAccents(text.toLowerCase())
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
  );
}

function truncate(s: string, max: number): string {
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).trimEnd() + "…";
}

function capitalize(s: string): string {
  const t = s.trim();
  return t.length > 0 ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

// "colonia de roanoke" -> "#ColoniaDeRoanoke"
function toHashtag(phrase: string): string {
  const cleaned = stripAccents(phrase)
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const pascal = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
  return `#${pascal}`;
}

function dedupeNormalized(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

const HASHTAG_TARGET_COUNT = 5;

// Prioridad, tal como se definio: 1) relevancia del contenido real, 2) identidad
// de cuenta (SOLO si hay relacion real, nunca por defecto), 3) cantidad. Un
// hashtag_base de la cuenta nunca aparece si no hay solapamiento real con el
// contenido - esto es justo lo que evita el problema real observado (#naturaleza/
// #meditacion apareciendo en un video sobre Roanoke solo porque la cuenta los tenia
// configurados).
function buildHashtags(canonical: CanonicalAnalysis, style: AccountStyle): string[] {
  const contentTags = dedupeNormalized(canonical.content_keywords.map(toHashtag));

  if (contentTags.length >= HASHTAG_TARGET_COUNT) {
    return contentTags.slice(0, HASHTAG_TARGET_COUNT);
  }

  const contentTokens = tokenize(`${canonical.topic} ${canonical.summary} ${canonical.content_keywords.join(" ")}`);
  const relevantBaseTags = (style.hashtags_base ?? [])
    .filter((base) => {
      const normalized = stripAccents(base.toLowerCase());
      return [...contentTokens].some((t) => normalized.includes(t) || t.includes(normalized));
    })
    .map(toHashtag);

  return dedupeNormalized([...contentTags, ...relevantBaseTags]).slice(0, HASHTAG_TARGET_COUNT);
}

type Limits = { titleMax: number; descMin: number; descMax: number };

function ensureMinLength(text: string, canonical: CanonicalAnalysis, min: number): string {
  let result = text.trim();
  if (result.length < min) result = `${result} ${canonical.topic}`.trim();
  if (result.length < min) result = `${result} ${canonical.summary}`.trim();
  return result;
}

interface Built {
  title: string;
  description: string;
}

// Cada plataforma tiene su propia funcion, con su propia estructura - no son
// sustituciones de palabras sobre una misma plantilla.

// YouTube (largo) / YouTube Shorts: descubrimiento + contexto.
function buildDiscovery(c: CanonicalAnalysis, limits: Limits): Built {
  const title = truncate(capitalize(c.topic), limits.titleMax);
  const description = ensureMinLength(`${c.summary} Descubre el contexto completo en este video.`, c, limits.descMin);
  return { title, description: truncate(description, limits.descMax) };
}

// Instagram Reels: interaccion, termina invitando a comentar.
function buildInstagramReels(c: CanonicalAnalysis, limits: Limits): Built {
  const title = truncate(capitalize(c.hook), limits.titleMax);
  const invite = /\?\s*$/.test(c.hook.trim()) ? "¿Tú qué opinas?" : "¿Tú qué crees que ocurrió?";
  const description = ensureMinLength(`${c.hook} ${invite}`, c, limits.descMin);
  return { title, description: truncate(description, limits.descMax) };
}

// Facebook Reels: lectura narrativa, contexto general.
function buildFacebookReels(c: CanonicalAnalysis, limits: Limits): Built {
  const title = truncate(capitalize(c.topic), limits.titleMax);
  const description = ensureMinLength(`${c.summary} Una historia que todavía genera preguntas.`, c, limits.descMin);
  return { title, description: truncate(description, limits.descMax) };
}

// TikTok: gancho directo, sin rodeos.
function buildTiktok(c: CanonicalAnalysis, limits: Limits): Built {
  const title = truncate(capitalize(c.hook), limits.titleMax);
  const description = ensureMinLength(c.hook, c, limits.descMin);
  return { title, description: truncate(description, limits.descMax) };
}

const BUILDERS: Record<PlatformKey, (c: CanonicalAnalysis, limits: Limits) => Built> = {
  youtube: buildDiscovery,
  youtube_shorts: buildDiscovery,
  instagram_reels: buildInstagramReels,
  facebook_reels: buildFacebookReels,
  tiktok: buildTiktok,
};

// Red de seguridad: si dos descripciones coinciden (normalizadas) - solo posible
// en transcripciones muy cortas donde hook y summary terminan pareciendose mucho -
// se rompe el empate con un sufijo minimo y deterministico. Nunca se deja que dos
// plataformas queden identicas, sin depender de que el modelo "se acuerde" de variar.
const TIE_BREAKERS: Partial<Record<PlatformKey, string>> = {
  instagram_reels: " 👀",
  facebook_reels: " Cuéntanos qué piensas en los comentarios.",
  tiktok: " 🔎",
};

export function generateMetadata(canonical: CanonicalAnalysis, style: AccountStyle, folderType: "completo" | "clip"): GeneratedMetadata {
  const platformKeys = PLATFORMS_BY_FOLDER_TYPE[folderType];
  const hashtags = buildHashtags(canonical, style);

  const platforms: GeneratedMetadata["platforms"] = {};
  const seenDescriptions = new Set<string>();

  for (const key of platformKeys) {
    const limits = PLATFORM_LIMITS[key];
    const built = BUILDERS[key](canonical, limits);
    let description = built.description;

    const normalized = description.trim().toLowerCase();
    if (seenDescriptions.has(normalized) && TIE_BREAKERS[key]) {
      description = truncate(description + TIE_BREAKERS[key]!, limits.descMax);
    }
    seenDescriptions.add(description.trim().toLowerCase());

    platforms[key] = { title: built.title, description, hashtags };
  }

  return { topic_summary: canonical.summary, platforms };
}
