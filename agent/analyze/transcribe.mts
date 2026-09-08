// Envuelve el CLI local de Whisper (ya instalado en esta PC, mismo binario que usa
// scripts/pipeline, pero esta es una implementacion propia e independiente - la
// Fase 3 no importa nada de scripts/pipeline).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { WHISPER_MODEL, MIN_TRANSCRIPT_CHARS_FOR_SPEECH } from "./config.mts";

export type TranscribeErrorCode =
  | "whisper_not_installed"
  | "whisper_process_error"
  | "whisper_output_missing"
  | "whisper_output_invalid";

export class TranscribeError extends Error {
  constructor(public code: TranscribeErrorCode, message: string) {
    super(message);
  }
}

export interface TranscribeResult {
  transcript: string;
  hasSpeech: boolean;
}

interface WhisperSegment {
  text: string;
}
interface WhisperJson {
  text?: string;
  segments?: WhisperSegment[];
}

export function transcribeAudio(wavPath: string, outDir: string): TranscribeResult {
  try {
    execFileSync(
      "whisper",
      [
        wavPath,
        "--model", WHISPER_MODEL,
        "--language", "Spanish",
        "--verbose", "False", // evita el volcado de progreso por segmento (puede saturar el buffer en videos largos)
        "--output_format", "json",
        "--output_dir", outDir,
      ],
      {
        // Todo ignorado a proposito: el CLI de whisper puede imprimir caracteres no
        // representables en la codepage de la consola de Windows (cp1252) y lanzar
        // un UnicodeEncodeError al escribir esa salida - no queremos que eso tumbe
        // la transcripcion. PYTHONIOENCODING=utf-8 ademas evita el problema de raiz.
        stdio: ["ignore", "ignore", "ignore"],
        encoding: "utf-8",
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isMissing = /ENOENT/.test(message);
    throw new TranscribeError(
      isMissing ? "whisper_not_installed" : "whisper_process_error",
      isMissing
        ? "El ejecutable 'whisper' no esta disponible en el PATH"
        : `El proceso de whisper termino con error: ${message}`
    );
  }

  const base = path.basename(wavPath, path.extname(wavPath));
  const jsonPath = path.join(outDir, `${base}.json`);
  if (!existsSync(jsonPath)) {
    throw new TranscribeError("whisper_output_missing", `whisper no genero el archivo de salida esperado: ${jsonPath}`);
  }

  let parsed: WhisperJson;
  try {
    parsed = JSON.parse(readFileSync(jsonPath, "utf-8")) as WhisperJson;
  } catch (err) {
    throw new TranscribeError(
      "whisper_output_invalid",
      `La salida de whisper no es JSON valido: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const transcript = (parsed.text ?? parsed.segments?.map((s) => s.text).join(" ") ?? "").trim();
  const hasSpeech = transcript.length >= MIN_TRANSCRIPT_CHARS_FOR_SPEECH;

  return { transcript, hasSpeech };
}
