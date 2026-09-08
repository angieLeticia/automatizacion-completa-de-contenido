export type EpisodeFiles = {
  account: string;
  episodeId: string;
  folder: string;
  scriptFile: string | null;
  narrationFile: string | null;
  videoFiles: string[];
  imageFiles: string[];
  soundFiles: string[];
};

// READY = guion + material visual, sin exigir narración (Fase 4.5: la
// narración faltante se genera vía ElevenLabs recién después de que un humano
// autorice la producción, no como condición para llegar a READY).
export type Completeness = { status: "WAITING_FOR_MATERIAL"; reason: string } | { status: "READY" };

export type ScriptSentence = {
  index: number;
  text: string;
  chapterIndex: number; // 0 = cold open / hook (antes del primer "# CAPÍTULO"), luego 1..N, último = FINAL
  chapterTitle: string;
  isChapterOpening: boolean; // primera oración del capítulo
  isHookSection: boolean; // chapterIndex === 0
  isFinalSection: boolean; // dentro del capítulo "FINAL"
  hasEmphasis: boolean; // contiene **negrita** en el guion original
  isQuestion: boolean; // termina en "?"
  breakBeforeSeconds: number;
  breakAfterSeconds: number;
  positionRatio: number; // 0 (inicio) .. 1 (cierre), por posición en el guion
};

export type ScriptChapter = {
  index: number;
  title: string;
};

export type ScriptAnalysis = {
  title: string;
  chapters: ScriptChapter[];
  sentences: ScriptSentence[];
  plainText: string; // guion completo sin tags SSML ni markdown, para pasarlo a whisper como referencia
};
