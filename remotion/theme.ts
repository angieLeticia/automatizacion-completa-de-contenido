// Single source of truth for the "Sin Explicación" documentary identity.
// MainDocumentary and every Short-{i} import from here so the long-form
// video and its clips share one visual/timing language.
//
// FASE 5.10-AI — se extrajo el tipo `ChannelVisualTheme` (el CONTRATO que
// cualquier identidad visual de canal debe cumplir) sin tocar ni un solo
// valor real ni ningún import existente: `colors`/`fonts`/`timing`/`layout`/
// `FPS` siguen exportados EXACTAMENTE igual que antes (MainDocumentary.tsx,
// ShortClip.tsx, ChapterCard.tsx, Intro.tsx, IntroLandscape.tsx, Root.tsx
// siguen importando de "./theme" sin ningún cambio, cero riesgo de
// regresión). `sinExplicacionTheme` es el mismo objeto de siempre, solo con
// nombre explícito — es la identidad visual REAL y completa de este canal,
// no un ejemplo. Ningún otro canal tiene todavía un objeto equivalente (ver
// channelRegistry.mts::ChannelConfig.visualIdentityStatus — los 3 canales
// restantes quedan "PENDING" a propósito, sin inventar branding).
//
// El patrón a seguir para una identidad visual nueva NO es "copiar este
// archivo" — es más parecido a remotion/QuoteVideo.tsx (recibe su
// configuración de marca vía PROPS, nunca importando un theme.ts fijo). Ver
// auditoría FASE 5.10-AI, Parte B, para el detalle completo de por qué ese
// es el patrón reutilizable y este archivo (theme.ts) es, en cambio, la
// implementación concreta y específica de UN canal.

import { captionFontFamily, displayFontFamily, subtitleFontFamily } from "./lib/fonts";

export const FPS = 30;

export type ChannelVisualTheme = {
  colors: {
    background: string;
    ink: string;
    inkDim: string;
    accent: string;
    accentGlow: string;
    vignette: string;
  };
  fonts: {
    display: string;
    caption: string;
    subtitle: string;
  };
  timing: {
    captionFadeFrames: number;
    hookHoldSeconds: number;
    sceneGlitchTransitionFrames: number;
  };
  layout: {
    main: { width: number; height: number };
    short: { width: number; height: number };
  };
};

export const sinExplicacionTheme: ChannelVisualTheme = {
  colors: {
    background: "#050505",
    ink: "#f4f1ea",
    inkDim: "rgba(244, 241, 234, 0.72)",
    accent: "#c81e1e", // reveal / glitch accent
    accentGlow: "rgba(200, 30, 30, 0.55)",
    vignette: "rgba(0, 0, 0, 0.82)",
  },
  fonts: {
    // Condensed, high-contrast display face for hook / reveal moments.
    display: `${displayFontFamily}, 'Arial Narrow', sans-serif`,
    // Condensed sans for small kicker/label text ("Capítulo 1", the year, etc).
    caption: `${captionFontFamily}, 'Arial Narrow', sans-serif`,
    // Delicate serif for the narration subtitles themselves — thin, editorial,
    // documentary-style rather than a bold sans.
    subtitle: `${subtitleFontFamily}, Georgia, 'Times New Roman', serif`,
  },
  timing: {
    captionFadeFrames: 14,
    hookHoldSeconds: 2.6,
    sceneGlitchTransitionFrames: 12,
  },
  layout: {
    main: { width: 1920, height: 1080 },
    short: { width: 1080, height: 1920 },
  },
};

// --- Exports históricos, sin cambios de valor ni de forma — todo lo que ya
// importaba { colors, fonts, timing, layout } de "./theme" sigue funcionando
// idéntico, byte a byte. ---
export const colors = sinExplicacionTheme.colors;
export const fonts = sinExplicacionTheme.fonts;
export const timing = sinExplicacionTheme.timing;
export const layout = sinExplicacionTheme.layout;
