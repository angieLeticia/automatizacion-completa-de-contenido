// El wrapper pedido explícitamente en el encargo: NO duplica EpisodeFiles,
// lo reutiliza vía import de tipo desde scripts/pipeline. Import SOLO de
// tipo (`import type`) — se borra en compilación, cero acoplamiento en
// runtime con scripts/pipeline.
import type { EpisodeFiles, Completeness } from "../../scripts/pipeline/types.mts";
import type { ContentSubmission } from "./types.mts";

export interface ContentPackage {
  channel: string;
  episodeId: string;
  files: EpisodeFiles;
  completeness: Completeness;
  manifest: ContentSubmission;
  sourceOrigin: "human" | "research-agent";
}
