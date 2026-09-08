import { FPS } from "../theme";

// Single source of truth for the intro's audio pacing. Each "beat" is one
// generated voice line (public/assets/audio/intro/voz-0N.mp3) followed by a
// silence before the next line starts — the silences are the suspense.
// Durations measured with ffprobe against the actual mp3s; keep in sync if
// the voice files are regenerated.

const secToFrames = (s: number) => Math.round(s * FPS);

const LEAD_IN_SECONDS = 0.3;
const TAIL_SECONDS = 0.5;

export type IntroBeat = {
  voiceFile: string;
  voiceDurationFrames: number;
  gapAfterFrames: number;
  /** Background b-roll clip that plays under this beat + its gap. */
  videoFile: string;
};

export const introBeats: IntroBeat[] = [
  { voiceFile: "voz-01.mp3", voiceDurationFrames: secToFrames(2.873), gapAfterFrames: secToFrames(0.8), videoFile: "block-1.mp4" },
  { voiceFile: "voz-02.mp3", voiceDurationFrames: secToFrames(2.403), gapAfterFrames: secToFrames(1.0), videoFile: "block-2.mp4" },
  { voiceFile: "voz-03.mp3", voiceDurationFrames: secToFrames(3.291), gapAfterFrames: secToFrames(1.8), videoFile: "block-3.mp4" },
  { voiceFile: "voz-04.mp3", voiceDurationFrames: secToFrames(1.254), gapAfterFrames: secToFrames(1.5), videoFile: "block-4.mp4" },
  { voiceFile: "voz-05.mp3", voiceDurationFrames: secToFrames(1.437), gapAfterFrames: secToFrames(TAIL_SECONDS), videoFile: "block-5.mp4" },
];

const leadInFrames = secToFrames(LEAD_IN_SECONDS);

export type IntroCue = IntroBeat & {
  /** Frame (relative to the Intro composition) the voice line starts. */
  voiceStart: number;
  /** Frame the background video block for this beat starts (== voiceStart, block covers voice + its gap). */
  videoStart: number;
  /** Length in frames of this beat's video block (voice + gap). */
  videoDurationFrames: number;
};

export const introCues: IntroCue[] = (() => {
  let cursor = leadInFrames;
  return introBeats.map((beat) => {
    const videoStart = cursor;
    const videoDurationFrames = beat.voiceDurationFrames + beat.gapAfterFrames;
    const cue: IntroCue = { ...beat, voiceStart: videoStart, videoStart, videoDurationFrames };
    cursor += videoDurationFrames;
    return cue;
  });
})();

export const introDurationInFrames = introCues.reduce((acc, cue) => acc + cue.videoDurationFrames, leadInFrames);

// The reveal title ("SIN EXPLICACIÓN") rides on the last beat, starting
// together with its voice line.
export const revealCue = introCues[introCues.length - 1];

// For the landscape (YouTube) cut: a 3-column "wall" of simultaneous clips
// per beat instead of one clip pillarboxed/blurred. The beat's own video
// (same one used in the vertical cut) always sits in the center column;
// the side columns borrow from the other clips so every beat reshuffles and
// all 6 source clips get used somewhere.
export const wallBeats: string[][] = [
  ["block-2.mp4", "block-1.mp4", "block-4.mp4"],
  ["block-3.mp4", "block-2.mp4", "block-5.mp4"],
  ["block-1.mp4", "block-3.mp4", "extra-reserve.mp4"],
  ["block-5.mp4", "block-4.mp4", "block-2.mp4"],
  ["block-3.mp4", "block-5.mp4", "block-1.mp4"],
];
