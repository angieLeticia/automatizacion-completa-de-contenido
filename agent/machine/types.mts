// Contrato de MachineBridge (Fase 4.4, extendido en Fase 4.5). Diseño
// completo de las 5 áreas auditadas. `filesystem`, `health` (Fase 4.4) y
// `media`, `render` (Fase 4.5) tienen implementación real — ver
// machineBridge.mts, mediaBridge.mts, renderBridge.mts. Envuelven
// exactamente el código YA EXISTENTE en scripts/pipeline/*.mts y
// agent/analyze/*.mts (ver docs/machine-access.md §Auditoría), sin
// reescribirlo. `localAI` sigue como contrato documentado, sin implementar
// (fuera de alcance de la Fase 4.5) — Agent 2/3 tampoco consumen el Bridge
// todavía, eso es trabajo de una fase posterior.
//
// NUNCA existe un método execute(comando) — cada operación está nombrada y
// acotada. Un método nuevo = una capacidad nueva agregada explícitamente.

export interface MediaInfo {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudioStream: boolean;
}

export interface Silence {
  start: number;
  end: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

// --- filesystem: IMPLEMENTADO en esta fase ---
export interface FilesystemBridge {
  hashFile(root: string, relPath: string): Promise<string>;
  readFile(root: string, relPath: string): Promise<Buffer>;
  writeFile(root: string, relPath: string, data: Buffer | string): Promise<void>;
  exists(root: string, relPath: string): Promise<boolean>;
}

// --- health: IMPLEMENTADO en esta fase ---
export interface HealthBridge {
  checkToolAvailable(tool: "ffmpeg" | "ffprobe" | "whisper"): Promise<boolean>;
  checkOllamaReachable(baseUrl: string): Promise<boolean>;
}

// --- media: IMPLEMENTADO (Fase 4.5, ver mediaBridge.mts) — envuelve
// scripts/pipeline/{mediaCatalog,silenceDetector,transcriber,voiceGenerator}.mts
// y agent/analyze/{probeMedia,extractAudio,transcribe}.mts SIN reescribirlos ---
export interface MediaBridge {
  probe(filePath: string): Promise<MediaInfo>;
  extractAudioToWav(videoPath: string, outDir: string): Promise<string>;
  detectSilences(audioPath: string): Promise<Silence[]>;
  concatAudio(chunkPaths: string[], outputPath: string): Promise<void>;
  transcribe(audioPath: string, withTimestamps: boolean): Promise<TranscriptSegment[]>;
}

// --- render: IMPLEMENTADO (Fase 4.5, ver renderBridge.mts) — envuelve
// scripts/pipeline/renderer.mts (que a su vez ya envuelve `npx remotion render`) ---
export interface RenderBridge {
  renderComposition(
    compositionId: string,
    outputPath: string,
    opts?: { reuseIfExists?: boolean; timeoutMs?: number }
  ): Promise<{ path: string; hash: string; reused: boolean }>;
}

// --- localAI: DISEÑADO, NO implementado en esta fase — envolvería
// agent/analyze/llm/localOllamaClient.mts, heredando la MISMA restricción de
// localhost que assertOllamaUrlIsLocal() ya aplica hoy, no una nueva ---
export interface LocalAIBridge {
  chatOllama(prompt: string, model: string, baseUrl: string): Promise<string>;
}

export interface MachineBridge {
  filesystem: FilesystemBridge;
  health: HealthBridge;
  media?: MediaBridge; // opcional a propósito: no existe todavía
  render?: RenderBridge; // opcional a propósito: no existe todavía
  localAI?: LocalAIBridge; // opcional a propósito: no existe todavía
}
