// Fase 5.0 — Sección 3: mapping lógico de storage SIN migración física.
// CurrentPath -> LogicalAssetType -> FutureCanonicalPath. Puro dato/función,
// no mueve ni renombra ningún archivo real — describe dónde vive hoy cada
// tipo de asset (auditoría real de D:\MATERIAL VIDEOS, Fase 5.0 §2) y a qué
// ruta canónica correspondería en el modelo lógico
// channel/episode/{source,script,audio,media,render,clips,highlights,vertical,metadata,logs,temp}.
export type LogicalAssetType =
  | "source" // Guion*.md, Concepto.md, script.md, Videos_Referencia (según canal)
  | "script"
  | "audio" // Narracion*.mp3, Sonidos/, Audios/, audio/
  | "media" // Imagenes/, Videos/, images/
  | "render" // salida principal ya renderizada
  | "clips"
  | "highlights" // NO EXISTE físicamente en ningún canal hoy
  | "vertical" // NO EXISTE físicamente en ningún canal hoy (ALZA LA VOZ tiene "_VERTICAL" pero es su propio repo externo)
  | "metadata" // NO EXISTE en disco — vive en Supabase content_metadata
  | "logs" // NO EXISTE en disco — vive en este repo (logs/, scripts/pipeline/state/)
  | "temp"; // NO EXISTE en disco — os.tmpdir(), nunca persistente

export type PathMapping = {
  logicalType: LogicalAssetType;
  currentPathPattern: string; // relativo a D:\MATERIAL VIDEOS\<channel>\<episode>\
  futureCanonicalPath: string; // relativo a channel/episode/
  existsToday: "EXISTE" | "NO_EXISTE" | "PARCIAL" | "DESCONOCIDO";
  note: string;
};

// Convención real observada en SIN EXPLICACIÓN/OBJETOS MALDITOS/LUNA VERDE
// (las tres con Guion*.md + Imagenes/) — la más cercana al modelo lógico.
export const DOCUMENTARY_CONVENTION_MAPPING: PathMapping[] = [
  { logicalType: "source", currentPathPattern: "Guion*.md", futureCanonicalPath: "script/guion.md", existsToday: "EXISTE", note: "SIN EXPLICACIÓN/OBJETOS MALDITOS/LUNA VERDE" },
  { logicalType: "audio", currentPathPattern: "Narracion*.mp3 | Voz*.mp3", futureCanonicalPath: "audio/narracion.mp3", existsToday: "PARCIAL", note: "solo existe una vez generada — LUNA VERDE/OBJETOS MALDITOS todavía no la tienen" },
  { logicalType: "media", currentPathPattern: "Imagenes/ , Videos/ , Sonidos/", futureCanonicalPath: "media/{images,videos,sfx}/", existsToday: "EXISTE", note: "" },
  { logicalType: "render", currentPathPattern: "<canal>/Videos YouTube Completos/<id> - Video Completo.mp4", futureCanonicalPath: "render/main.mp4", existsToday: "PARCIAL", note: "carpeta existe solo en SIN EXPLICACIÓN/OBJETOS MALDITOS/LUNA VERDE; contenido real solo en SIN EXPLICACIÓN" },
  { logicalType: "clips", currentPathPattern: "<canal>/Clips/<id> - Clip N.mp4", futureCanonicalPath: "clips/{n}.mp4", existsToday: "PARCIAL", note: "carpeta existe en los mismos 3 canales; contenido real solo en SIN EXPLICACIÓN" },
  { logicalType: "highlights", currentPathPattern: "(ninguno)", futureCanonicalPath: "highlights/{n}.mp4", existsToday: "NO_EXISTE", note: "ningún canal tiene esta carpeta físicamente — HIGHLIGHT vive solo como DerivedContent en memoria/reporte hoy" },
  { logicalType: "vertical", currentPathPattern: "(ninguno, salvo ALZA LA VOZ en su repo externo)", futureCanonicalPath: "vertical/{platform}.mp4", existsToday: "NO_EXISTE", note: "ShortClip ya renderiza 9:16 pero se guarda en Clips/, no en una carpeta 'vertical' separada" },
  { logicalType: "metadata", currentPathPattern: "(ninguno)", futureCanonicalPath: "metadata/content.json", existsToday: "NO_EXISTE", note: "vive en Supabase content_metadata, nunca en disco" },
  { logicalType: "logs", currentPathPattern: "(ninguno)", futureCanonicalPath: "logs/", existsToday: "NO_EXISTE", note: "vive en este repo (logs/, scripts/pipeline/state/), nunca junto al material" },
  { logicalType: "temp", currentPathPattern: "(ninguno)", futureCanonicalPath: "temp/", existsToday: "NO_EXISTE", note: "os.tmpdir(), nunca persistente en D:\\" },
];

// No se implementa un mapping distinto para ENCIENDE EL CAOS/ASMR/ALZA LA
// VOZ/PELICULAS/MUSICA/CHISMES en código — sus convenciones reales (Sección
// 5.0 §2 del informe) son demasiado distintas entre sí (audio-first sin
// guion, ambient sin narración, topic-folders con output ya final, etc.)
// para forzar un único adapter sin evidencia de que deban converger. Migrar
// físicamente cualquiera de ellos SIN necesidad real sería exactamente el
// "cambio cosmético" que la Sección 3 prohíbe.
