// Contrato de entrada del sistema (Fase 4.3). Puro dato — sin lógica de
// negocio, sin dependencia de Supabase/Remotion/proveedor de investigación.
// Ver docs/system-contracts.md §4 y docs/content-ingestion.md §4.

export type ManifestFileKind = "video" | "image" | "audio" | "script" | "reference";

// Ruta SIEMPRE relativa a la carpeta de la propia submission dentro del
// Inbox — nunca absoluta, nunca fuera de esa carpeta (ver pathSafety.mts).
export interface ManifestFile {
  kind: ManifestFileKind;
  path: string;
  sha256: string;
}

export interface ManifestSource {
  name: string;
  url?: string;
  tier?: "primary" | "secondary" | "tertiary";
}

export interface ContentSubmission {
  submission_id: string;
  channel: string;
  episode_id?: string;
  submitted_by?: string;
  submitted_at?: string;
  files: ManifestFile[];
  sources?: ManifestSource[];
  intended_platforms?: string[];
  metadata_hints?: { title?: string; classification?: string; tags?: string[] };
  submission_checksum: string;
  schema_version: number;
}

// Wrapper delgado sobre EpisodeFiles (scripts/pipeline/types.mts) — NO
// duplica esa forma, la reutiliza vía import de tipo. ContentPackage es lo
// que ContentProvider entrega: EpisodeFiles ya en la convención de carpetas
// que Agent 2 sabe escanear, más la trazabilidad de dónde vino.
export interface ContentPackageMeta {
  channel: string;
  episodeId: string;
  manifest: ContentSubmission;
  sourceOrigin: "human" | "research-agent";
}
