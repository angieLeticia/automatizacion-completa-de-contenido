import { FPS } from "../theme";

export type CaptionType = "normal" | "hook" | "reveal";

export type SfxCue = {
  file: string; // filename inside /public/assets/audio/sfx
  volume?: number; // peak volume, 0-1 (default 0.6)
  fadeInFrames?: number;
  fadeOutFrames?: number;
};

export type Caption = {
  start: number; // seconds
  end: number; // seconds
  text: string;
  type: CaptionType;
  // Manually assigned per caption when a sting/drone should play under this line.
  sfx?: SfxCue;
};

export const normalizeCaptions = (raw: Caption[]): Caption[] =>
  raw.map((c) => ({ ...c, type: c.type ?? "normal" }));

export const secToFrames = (sec: number) => Math.round(sec * FPS);

export const totalDurationFromCaptions = (captions: Caption[]): number => {
  if (captions.length === 0) return 0;
  return Math.max(...captions.map((c) => c.end));
};

// Captions overlapping the given absolute frame range [startFrame, endFrame).
export const captionsInRange = (captions: Caption[], startFrame: number, endFrame: number): Caption[] => {
  return captions.filter((c) => {
    const cStart = secToFrames(c.start);
    const cEnd = secToFrames(c.end);
    return cEnd > startFrame && cStart < endFrame;
  });
};
