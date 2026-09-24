// Fase 2 acelerada — registro LOCAL de series, mismo patrón exacto que
// channelRegistry.mts: nunca se fabrica una serie que no exista realmente.
//
// Decisión de diseño (ver docs/database-contract.md:206, "[DECISIÓN
// RESPETADA]"): content_files.episode_id sigue siendo la ÚNICA identidad de
// agrupación de episodio — no se propone ninguna tabla `episodes`/`series`
// nueva en Supabase. La serie es puramente un concepto LOCAL, resuelto en
// tiempo de consulta por (channelId, episodeId) contra este registro — nunca
// se guarda redundantemente en content_files ni en ningún otro lado. Un
// episodio sin serie (el 100% de la producción real hoy) es indistinguible
// de como era antes de esta fase.
export type SeriesType = "SEQUENTIAL" | "THEMATIC";

export type SeriesConfig = {
  seriesId: string;
  seriesName: string;
  // Mismo valor que el "account"/folderName ya usado en todo el pipeline
  // (channelRegistry.mts::resolveChannelConfig, processProject(account, ...)).
  // Se llama channelId acá solo para describir el concepto (canal), pero es
  // el mismo string.
  channelId: string;
  seriesType: SeriesType;
  // El ÍNDICE de este array ES el episode_order. Para SEQUENTIAL, el
  // episodio en la posición i depende de que el de la posición i-1 esté
  // COMPLETED (ver seriesDependency.mts). Para THEMATIC, el orden es
  // meramente informativo — nunca bloquea nada.
  episodeOrder: readonly string[];
};

// Vacío por defecto — deliberado. Los ejemplos del encargo de esta fase
// ("Expedientes Prohibidos", "Chismes de Internet") son ILUSTRATIVOS, no
// series reales confirmadas en D:\MATERIAL VIDEOS — no se inventan acá,
// mismo criterio ya aplicado en channelRegistry.mts para campos sin
// evidencia real. Registrar una serie real es agregar una entrada a este
// Record, sin tocar ningún otro archivo de producción.
const SERIES_REGISTRY: Record<string, SeriesConfig> = {};

export function resolveSeriesConfig(seriesId: string): SeriesConfig | null {
  return SERIES_REGISTRY[seriesId] ?? null;
}

export function listKnownSeries(): SeriesConfig[] {
  return Object.values(SERIES_REGISTRY);
}

// Núcleo PURO (testeable sin depender del registro real) — busca, dentro de
// una lista de series dada, la que pertenece a `account` (mismo valor que
// channelRegistry.mts folderName) y cuyo episodeOrder incluye `episodeId`.
export function findSeriesInList(list: SeriesConfig[], account: string, episodeId: string): SeriesConfig | null {
  return list.find((s) => s.channelId === account && s.episodeOrder.includes(episodeId)) ?? null;
}

// Único punto de unión episodio -> serie contra el registro REAL. Un
// episodio sin serie devuelve null — comportamiento neutro, nunca bloquea
// nada (ver seriesDependency.mts).
export function findSeriesForEpisode(account: string, episodeId: string): SeriesConfig | null {
  return findSeriesInList(listKnownSeries(), account, episodeId);
}

// Fase 2 acelerada — Paso 5: convención de nombres LÓGICA/METADATA (nunca
// renombra ni mueve archivos físicos reales — el nombre físico real sigue
// siendo el que ya produce exportManager.mts, sin cambios). Sirve como
// identificador estable para uso futuro (ej. bridge Agent2->Agent3, Fase 3).
export type DerivativeKind = "LONG" | "CLIP";

export const derivativeId = (episodeId: string, kind: DerivativeKind, index?: number): string =>
  kind === "LONG" ? `${episodeId}_LONG` : `${episodeId}_CLIP${String(index ?? 0).padStart(2, "0")}`;
