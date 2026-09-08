// Single source of truth for the "Sin Explicación" documentary identity.
// MainDocumentary and every Short-{i} import from here so the long-form
// video and its clips share one visual/timing language.

import { captionFontFamily, displayFontFamily, subtitleFontFamily } from "./lib/fonts";

export const FPS = 30;

export const colors = {
  background: "#050505",
  ink: "#f4f1ea",
  inkDim: "rgba(244, 241, 234, 0.72)",
  accent: "#c81e1e", // reveal / glitch accent
  accentGlow: "rgba(200, 30, 30, 0.55)",
  vignette: "rgba(0, 0, 0, 0.82)",
};

export const fonts = {
  // Condensed, high-contrast display face for hook / reveal moments.
  display: `${displayFontFamily}, 'Arial Narrow', sans-serif`,
  // Condensed sans for small kicker/label text ("Capítulo 1", the year, etc).
  caption: `${captionFontFamily}, 'Arial Narrow', sans-serif`,
  // Delicate serif for the narration subtitles themselves — thin, editorial,
  // documentary-style rather than a bold sans.
  subtitle: `${subtitleFontFamily}, Georgia, 'Times New Roman', serif`,
};

export const timing = {
  captionFadeFrames: 14,
  hookHoldSeconds: 2.6,
  sceneGlitchTransitionFrames: 12,
};

export const layout = {
  main: { width: 1920, height: 1080 },
  short: { width: 1080, height: 1920 },
};
