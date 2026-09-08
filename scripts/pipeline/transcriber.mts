import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type RawSegment = { start: number; end: number; text: string };

const WHISPER_MODEL = process.env.WHISPER_MODEL || "medium";

// Envuelve el CLI local de whisper (mismo comando que hoy se corre a mano,
// ver remotion/data/README.md) y devuelve los segmentos con timestamps
// reales — la única fuente confiable de timing, el guion NO se usa para esto.
export const transcribeNarration = (audioPath: string): RawSegment[] => {
  const outDir = mkdtempSync(path.join(tmpdir(), "pipeline-whisper-"));
  try {
    execFileSync(
      "whisper",
      [audioPath, "--model", WHISPER_MODEL, "--language", "Spanish", "--output_format", "json", "--output_dir", outDir],
      { stdio: "inherit" }
    );

    const base = path.basename(audioPath, path.extname(audioPath));
    const jsonPath = path.join(outDir, `${base}.json`);
    if (!existsSync(jsonPath)) {
      throw new Error(`whisper no generó ${jsonPath}`);
    }
    const raw = JSON.parse(readFileSync(jsonPath, "utf-8")) as { segments: RawSegment[] };
    return raw.segments.map((seg) => ({
      start: Number(seg.start.toFixed(2)),
      end: Number(seg.end.toFixed(2)),
      text: seg.text.trim(),
    }));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
};
