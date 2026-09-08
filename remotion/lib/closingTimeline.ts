import { FPS } from "../theme";

// Single source of truth for the closing-CTA card's pacing. Measured with
// ffprobe against public/assets/audio/closing-cta.mp3 (13.4008s) and the
// script's own <break> tags:
//   "Si no eres lo bastante curioso..." <0.6s>
//   "mejor no entres." <1.0s>
//   "Pero si quieres saberlo todo..." <0.7s>
//   "está completo en YouTube:" <0.5s>
//   "Sin Explicación Oficial."
// Per-line start times below are estimated proportionally by character
// count against the measured total — update if the audio is regenerated.

const secToFrames = (s: number) => Math.round(s * FPS);

export const LEAD_IN_FRAMES = secToFrames(0.3);
const TAIL_FRAMES = secToFrames(0.5);
export const AUDIO_DURATION_FRAMES = secToFrames(13.4008);
export const closingDurationInFrames = LEAD_IN_FRAMES + AUDIO_DURATION_FRAMES + TAIL_FRAMES;

export type ClosingLine = { text: string; start: number; duration: number; accent?: boolean };

const lineStartsSeconds = [0, 3.31, 5.585, 8.836, 11.408];
const starts = lineStartsSeconds.map((s) => LEAD_IN_FRAMES + secToFrames(s));
const [l1, l2, l3, l4, l5] = starts;

export const closingLines: ClosingLine[] = [
  { text: "Si no eres lo bastante\ncurioso...", start: l1, duration: l2 - l1 },
  { text: "Mejor no entres.", start: l2, duration: l3 - l2, accent: true },
  { text: "Pero si quieres\nsaberlo todo...", start: l3, duration: l4 - l3 },
  { text: "Está completo en YouTube:", start: l4, duration: l5 - l4 },
];

// "Sin Explicación Oficial" + the @handle ride the last segment through the tail.
export const revealStart = l5;
export const revealDuration = closingDurationInFrames - l5;
