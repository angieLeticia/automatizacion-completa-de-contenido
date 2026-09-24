import { loadProject } from "./projectManifest.mts";
import { findSeriesForEpisode, type SeriesConfig } from "./seriesRegistry.mts";

export type ProductionGate = { canProduce: true } | { canProduce: false; reason: string };

// Inyectable — permite testear sin tocar disco/Supabase real (mismo patrón
// que RecoverStaleClaimsDeps/SpawnWorkerFn ya usados en el pipeline).
export type CanProduceEpisodeDeps = {
  findSeries?: (account: string, episodeId: string) => SeriesConfig | null;
  // Devuelve el status del manifest de un episodio. loadProject() real NUNCA
  // devuelve null — si el proyecto no existe todavía devuelve un manifest
  // sintético en "WAITING_FOR_MATERIAL", que ya es != "COMPLETED" y por lo
  // tanto bloquea correctamente sin necesitar un caso null aparte.
  loadManifestStatus?: (account: string, episodeId: string) => string;
};

const defaultLoadManifestStatus = (account: string, episodeId: string): string => loadProject(account, episodeId).status;

// Función PURA (con dependencias inyectadas por defecto reales) — decide si
// un episodio puede producirse ahora mismo:
//   - Sin serie asociada -> siempre true (100% de la producción actual hoy).
//   - THEMATIC -> siempre true, nunca depende de otro episodio.
//   - SEQUENTIAL, primer episodio de la serie (índice 0) -> true.
//   - SEQUENTIAL, índice > 0 -> requiere que el episodio anterior en
//     episodeOrder tenga status COMPLETED; si no, bloquea con el motivo.
export function canProduceEpisode(account: string, episodeId: string, deps?: CanProduceEpisodeDeps): ProductionGate {
  const findSeries = deps?.findSeries ?? findSeriesForEpisode;
  const loadManifestStatus = deps?.loadManifestStatus ?? defaultLoadManifestStatus;

  const series = findSeries(account, episodeId);
  if (!series) return { canProduce: true };
  if (series.seriesType === "THEMATIC") return { canProduce: true };

  const index = series.episodeOrder.indexOf(episodeId);
  if (index <= 0) return { canProduce: true };

  const previousEpisodeId = series.episodeOrder[index - 1];
  const previousStatus = loadManifestStatus(account, previousEpisodeId);
  if (previousStatus !== "COMPLETED") {
    return {
      canProduce: false,
      reason: `serie SEQUENTIAL "${series.seriesId}": episodio anterior "${previousEpisodeId}" no está COMPLETED (status actual: ${previousStatus})`,
    };
  }
  return { canProduce: true };
}
