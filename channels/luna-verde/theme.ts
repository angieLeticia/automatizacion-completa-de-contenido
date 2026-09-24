// Identidad visual REAL y definitiva de LUNA VERDE (reemplaza el placeholder
// neutro de Fase 9). Implementa el contrato `ChannelVisualTheme`
// (remotion/theme.ts), archivo propio — NUNCA importa ni copia
// sinExplicacionTheme/enciendeElCaosTheme/objetosMalditosTheme.
//
// Concepto aprobado explícitamente por el usuario: "un espacio nocturno para
// detenerse, escuchar y conectar" — espiritual, nocturno, contemplativo,
// misterioso, elegante, tranquilo, cósmico, íntimo. Nunca horóscopo barato,
// nunca terror, nunca noticias, nunca una copia de SIN EXPLICACIÓN ni de
// OBJETOS MALDITOS (que comparte la misma arquitectura de composición pero
// es oscuro/documental/rojo — LUNA VERDE es verde/dorado/calmo).
//
// Paleta aprobada (7 colores) — mismo hallazgo ya documentado para
// ENCIENDE EL CAOS/OBJETOS MALDITOS: el contrato compartido
// `ChannelVisualTheme` solo tiene 6 slots con nombres/roles fijos — NO se
// amplía el contrato compartido solo para este canal. Los 5 colores que SÍ
// tienen un slot directo van abajo; los 2 que no (deepEmerald, moonGold)
// viven en `lunaVerdeExtraColors`, fuera del tipo, mismo patrón "Opción A".
//
//   background    → colors.background (fondo principal)
//   textPrimary   → colors.ink (texto principal)
//   textSecondary → colors.inkDim (texto/detalle secundario)
//   emerald       → colors.accent (el verde es el color de identidad — único
//                   acento "activo" del contrato: captions, hook, flash —
//                   usado con moderación, nunca satura toda la pantalla)
//   deepBackground→ colors.vignette (derivado mecánicamente, ver abajo —
//                   un negro/verde AÚN más profundo que colors.background)
//   deepEmerald   → lunaVerdeExtraColors.deepEmerald (verde secundario más
//                   apagado, fuera del contrato)
//   moonGold      → lunaVerdeExtraColors.moonGold (dorado luna/energía —
//                   SOLO acento puntual, nunca dominante, instrucción
//                   explícita del usuario)
//
// accentGlow/vignette son, como en el resto de los themes del proyecto, el
// mismo color base con transparencia (nunca un color nuevo): accentGlow =
// emerald con alpha 0.55; vignette = deepBackground con alpha 0.82.
import { quoteFontFamily, montserratFontFamily } from "../../remotion/lib/fonts";
import type { ChannelVisualTheme } from "../../remotion/theme";

export const lunaVerdeTheme: ChannelVisualTheme = {
  colors: {
    background: "#07110D", // aprobado
    ink: "#F1F0E8", // aprobado (textPrimary)
    inkDim: "#A9B0AA", // aprobado (textSecondary)
    accent: "#1F8A70", // aprobado (emerald) — el verde es el color de identidad, usado con moderación (nunca "toda la interfaz en verde brillante", instrucción explícita)
    accentGlow: "rgba(31, 138, 112, 0.55)", // derivado mecánicamente de emerald (misma alpha 0.55 que el resto del proyecto)
    vignette: "rgba(3, 7, 6, 0.82)", // derivado mecánicamente de deepBackground (misma alpha 0.82 que el resto del proyecto)
  },
  fonts: {
    // El proyecto no tiene ninguna fuente serif cargada hoy (ver misma nota
    // en channels/objetos-malditos/theme.ts — la única serif histórica,
    // Cormorant Garamond, ya no se usa) — agregar una dependencia nueva
    // solo para esta fuente está explícitamente descartado por instrucción.
    // De las fuentes YA cargadas (remotion/lib/fonts.ts), Poppins
    // (quoteFontFamily) es la alternativa más cercana a "editorial +
    // espiritual + elegante": geométrica, de trazo cálido/redondeado, ya
    // usada para contenido reflexivo/inspiracional (QuoteVideo/Alza la Voz)
    // — deliberadamente DISTINTA de Bebas Neue (ya identidad de OBJETOS
    // MALDITOS) y de Anton (ya identidad de ENCIENDE EL CAOS), para que los
    // 3 canales nuevos no compartan tipografía de título entre sí.
    display: quoteFontFamily,
    // Montserrat — ya cargada, exactamente lo pedido para texto secundario.
    caption: montserratFontFamily,
    // Mismo criterio que ENCIENDE EL CAOS/OBJETOS MALDITOS: los dos roles
    // secundarios (caption/subtitle) comparten la fuente aprobada, sin
    // inventar una tercera tipografía.
    subtitle: montserratFontFamily,
  },
  timing: {
    // Valores técnicos neutrales — sin cambios de identidad de marca (mismo
    // criterio que el resto de los themes del proyecto).
    captionFadeFrames: 14,
    hookHoldSeconds: 2.6,
    sceneGlitchTransitionFrames: 12,
  },
  layout: {
    main: { width: 1920, height: 1080 },
    short: { width: 1080, height: 1920 },
  },
};

// Colores aprobados que ChannelVisualTheme.colors no tiene espacio para
// representar — ver nota de cabecera. NUNCA usar moonGold como color
// dominante — es acento puntual únicamente (instrucción explícita del
// usuario: "el dorado representa la luna/energía y debe utilizarse
// solamente como acento").
export const lunaVerdeExtraColors = {
  deepEmerald: "#0D4F40", // verde secundario/apagado, más profundo que el accent
  moonGold: "#C8A96B", // dorado luna/energía — SOLO acento puntual, nunca dominante
};
