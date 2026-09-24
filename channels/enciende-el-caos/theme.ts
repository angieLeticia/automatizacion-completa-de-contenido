// FASE 5.10-AO (Fase 2 del plan multicanal) — identidad visual TÉCNICA de
// ENCIENDE EL CAOS: chisme de espectáculos + breaking news + "caos
// controlado" (la edición se siente caótica, el mensaje nunca es confuso).
// Implementa el contrato `ChannelVisualTheme` (remotion/theme.ts) — NO copia
// ni modifica `sinExplicacionTheme`, vive en su propio archivo, mismo patrón
// de "datos de canal separados del componente" que ya usa
// channels/alza-la-voz/videos.ts.
//
// Paleta y tipografías: EXACTAMENTE las aprobadas explícitamente por el
// usuario en esta fase — ningún valor fue inventado. Dos excepciones
// documentadas abajo, ninguna es una decisión creativa nueva:
//
// 1) `accentGlow`/`vignette` — el contrato ChannelVisualTheme.colors los
//    define como valores rgba() derivados de otro color con transparencia
//    (así los usa sinExplicacionTheme: accentGlow = accent con alpha 0.55,
//    vignette = negro con alpha 0.82). Se aplicó la MISMA transformación
//    mecánica a los colores aprobados de este canal (rojo principal /
//    negro profundo) — no son colores nuevos, son los mismos aprobados con
//    una conversión de formato.
//
// 2) `timing` (captionFadeFrames/hookHoldSeconds/sceneGlitchTransitionFrames)
//    — son parámetros de ANIMACIÓN para componentes que todavía NO existen
//    (Fase 3: ChaosInteractiveText, BreakingTag, etc.), no identidad de
//    marca. Se dejan en los mismos valores neutrales que ya usa
//    sinExplicacionTheme como placeholder técnico, documentado como
//    PENDIENTE de ajuste real en Fase 3 — ver el informe de esta fase,
//    sección "riesgos/decisiones pendientes", para el detalle completo,
//    incluido el hallazgo de que `sceneGlitchTransitionFrames` es un
//    nombre heredado del contrato compartido que presupone un efecto
//    "glitch" que ESTE canal explícitamente no va a usar.
import { antonFontFamily, montserratFontFamily } from "../../remotion/lib/fonts";
import type { ChannelVisualTheme } from "../../remotion/theme";

export const enciendeElCaosTheme: ChannelVisualTheme = {
  colors: {
    background: "#0B0B0F", // fondo principal — aprobado
    ink: "#FFFFFF", // blanco — aprobado, texto principal
    inkDim: "#A7A7AD", // gris secundario — aprobado, texto/detalle secundario
    accent: "#E5092F", // rojo principal — aprobado
    accentGlow: "rgba(229, 9, 47, 0.55)", // derivado mecánicamente de accent (misma alpha 0.55 que sinExplicacionTheme) — nunca satura toda la pantalla, solo glow puntual
    vignette: "rgba(5, 5, 7, 0.82)", // derivado mecánicamente de "negro profundo" #050507 (misma alpha 0.82 que sinExplicacionTheme)
  },
  fonts: {
    // El usuario aprobó 2 tipografías (Anton para headlines, Montserrat
    // para texto secundario/apoyo) — el contrato tiene 3 slots de fuente.
    // `caption` y `subtitle` son ambos roles de "texto secundario/apoyo"
    // (kicker corto vs. subtítulo de narración) — se les asigna la misma
    // fuente aprobada, sin inventar una tercera tipografía.
    display: antonFontFamily, // headlines — aprobado
    caption: montserratFontFamily, // texto secundario/apoyo — aprobado
    subtitle: montserratFontFamily, // texto secundario/apoyo — aprobado
  },
  timing: {
    // PLACEHOLDER TÉCNICO — ver nota de cabecera, punto 2. Mismos valores
    // neutrales que sinExplicacionTheme, pendientes de definirse en Fase 3.
    captionFadeFrames: 14,
    hookHoldSeconds: 2.6,
    sceneGlitchTransitionFrames: 12,
  },
  layout: {
    main: { width: 1920, height: 1080 }, // video largo 16:9 — confirmado por el usuario
    short: { width: 1080, height: 1920 }, // clips 9:16 — confirmado por el usuario
  },
};

// FASE 5.10-AO — colores aprobados que el contrato compartido
// `ChannelVisualTheme.colors` NO tiene espacio para representar (tiene 6
// slots con nombres/roles específicos de SIN EXPLICACIÓN — ver informe de
// esta fase, "hallazgo sobre abstracción compartida"). Se decidió NO
// modificar remotion/theme.ts para esto sin tu confirmación explícita —
// estos 2 colores quedan disponibles aquí, fuera del contrato tipado, para
// que los componentes de Fase 3 (BreakingTag, ChaosInteractiveText, etc.)
// los importen directamente. Son los valores REALES aprobados, no
// inventados — solo no encajan en la forma actual de ChannelVisualTheme.
export const enciendeElCaosExtraColors = {
  redDark: "#8F061F", // rojo oscuro — aprobado
  alertYellow: "#FFD21F", // amarillo de alerta/acento — aprobado
};
