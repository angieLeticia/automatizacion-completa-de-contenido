import { spawnSync } from "node:child_process";

export type Silence = { start: number; end: number };

// Corre ffmpeg silencedetect sobre un archivo de audio y devuelve los
// intervalos de silencio. Se usa para: (a) detectar pausas dramáticas
// deliberadas que sirven como candidatas a corte/tensión, y (b) alinear
// límites de clip a un silencio cercano en vez de cortar a mitad de frase.
// ffmpeg escribe el resultado de silencedetect a stderr y sale con código 0
// (no falla), así que se lee stderr sin importar el exit code.
export const detectSilences = (
  audioPath: string,
  noiseDb = -30,
  minDurationSeconds = 0.4
): Silence[] => {
  const result = spawnSync(
    "ffmpeg",
    ["-i", audioPath, "-af", `silencedetect=noise=${noiseDb}dB:d=${minDurationSeconds}`, "-f", "null", "-"],
    { encoding: "utf-8" }
  );
  const stderr = result.stderr ?? "";

  const silences: Silence[] = [];
  const startRe = /silence_start:\s*([\d.]+)/g;
  const endRe = /silence_end:\s*([\d.]+)/g;
  const starts = [...stderr.matchAll(startRe)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(endRe)].map((m) => Number(m[1]));
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    silences.push({ start: starts[i], end: ends[i] });
  }
  return silences;
};

// La duración de silencio más cercana a `timestamp` (en cualquier dirección),
// hasta `maxDistanceSeconds`. Útil para "empujar" un corte de clip al silencio
// más próximo en vez de partir una palabra a la mitad.
export const nearestSilenceBoundary = (
  silences: Silence[],
  timestamp: number,
  maxDistanceSeconds = 1.5
): number | null => {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const s of silences) {
    const mid = (s.start + s.end) / 2;
    const dist = Math.abs(mid - timestamp);
    if (dist < bestDist && dist <= maxDistanceSeconds) {
      best = mid;
      bestDist = dist;
    }
  }
  return best;
};
