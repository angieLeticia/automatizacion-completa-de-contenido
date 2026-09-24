// Identidad visual REAL y definitiva de OBJETOS MALDITOS (reemplaza el
// placeholder neutro de Fase 9). Implementa el contrato `ChannelVisualTheme`
// (remotion/theme.ts), archivo propio — NUNCA importa ni copia
// sinExplicacionTheme/enciendeElCaosTheme/lunaVerdeTheme.
//
// Concepto aprobado explícitamente por el usuario: canal documental sobre
// objetos malditos — oscuro, antiguo, inquietante, misterioso, sobrio;
// teatral solo en momentos puntuales. Nunca "chisme"/breaking-news (esa es
// la identidad de ENCIENDE EL CAOS), nunca terror gore, nunca infantil,
// nunca una copia de SIN EXPLICACIÓN.
//
// Paleta aprobada (7 colores) — el contrato compartido `ChannelVisualTheme`
// solo tiene 6 slots con nombres/roles fijos (mismo hallazgo ya documentado
// en Fase 2 para ENCIENDE EL CAOS) — NO se amplía el contrato compartido
// solo para este canal. Los 5 colores que SÍ tienen un slot directo van
// abajo; los 2 que no (bloodRed, agedGold) viven en
// `objetosMalditosExtraColors`, fuera del tipo, mismo patrón "Opción A" que
// `enciendeElCaosExtraColors`.
//
//   background      → colors.background (fondo principal)
//   textPrimary     → colors.ink (texto principal)
//   textSecondary   → colors.inkDim (texto/detalle secundario)
//   accentRed       → colors.accent (único rojo "activo": captions, hook, flash — usado con moderación, nunca dominante)
//   deepBackground  → colors.vignette (derivado mecánicamente, ver abajo — nunca se usa "background" para la viñeta, es un negro AÚN más profundo)
//   bloodRed        → objetosMalditosExtraColors.bloodRed (rojo secundario/apagado, fuera del contrato)
//   agedGold        → objetosMalditosExtraColors.agedGold (acento dorado envejecido, NUNCA dominante — solo detalle puntual)
//
// accentGlow/vignette son, como en sinExplicacionTheme/enciendeElCaosTheme,
// el mismo color base con transparencia (nunca un color nuevo): accentGlow =
// accentRed con alpha 0.55; vignette = deepBackground con alpha 0.82.
import { displayFontFamily, montserratFontFamily } from "../../remotion/lib/fonts";
import type { ChannelVisualTheme } from "../../remotion/theme";

export const objetosMalditosTheme: ChannelVisualTheme = {
  colors: {
    background: "#080808", // aprobado
    ink: "#F2F2F2", // aprobado (textPrimary)
    inkDim: "#9A9A9A", // aprobado (textSecondary)
    accent: "#B5121B", // aprobado (accentRed) — único rojo "activo" del contrato; ver objetosMalditosExtraColors.bloodRed para el segundo rojo, más apagado
    accentGlow: "rgba(181, 18, 27, 0.55)", // derivado mecánicamente de accentRed (misma alpha 0.55 que el resto del proyecto)
    vignette: "rgba(3, 3, 3, 0.82)", // derivado mecánicamente de deepBackground (misma alpha 0.82 que el resto del proyecto) — un negro MÁS profundo que colors.background, a propósito
  },
  fonts: {
    // Bebas Neue — YA cargada en el proyecto (remotion/lib/fonts.ts,
    // displayFontFamily) — condensada, exactamente lo pedido, sin agregar
    // ninguna dependencia nueva. Es un loader de fuente COMPARTIDO (igual
    // que Anton/Montserrat para ENCIENDE EL CAOS) — reutilizarlo no es
    // "copiar el theme de SIN EXPLICACIÓN" (SIN EXPLICACIÓN combina esa
    // misma fuente con 'Arial Narrow' y su propio color — aquí es un archivo
    // de identidad totalmente separado).
    display: displayFontFamily,
    // Montserrat — ya cargada, exactamente lo pedido para texto secundario/captions.
    caption: montserratFontFamily,
    // El proyecto no tiene ninguna fuente serif cargada hoy (la única serif
    // histórica, Cormorant Garamond, ya no se usa — ver comentario de
    // fonts.ts). Agregar una nueva dependencia SOLO para "elementos de
    // archivo" está explícitamente descartado por instrucción ("NO agregues
    // una dependencia innecesaria solamente para una fuente"). Mismo
    // criterio ya usado por enciendeElCaosTheme: los dos roles secundarios
    // (caption/subtitle) comparten la misma fuente aprobada, sin inventar
    // una tercera tipografía.
    subtitle: montserratFontFamily,
  },
  timing: {
    // Valores técnicos neutrales — sin cambios de identidad de marca (mismo
    // criterio que sinExplicacionTheme/enciendeElCaosTheme/lunaVerdeTheme).
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
// representar — ver nota de cabecera. Disponibles para que un futuro
// componente propio de OBJETOS MALDITOS (si llegara a necesitarse) los
// importe directamente, sin tocar el contrato compartido. NUNCA usar
// agedGold como color dominante — es acento puntual únicamente (instrucción
// explícita del usuario).
export const objetosMalditosExtraColors = {
  bloodRed: "#8B0000", // rojo secundario/apagado, más profundo que accentRed — distinto del rojo "activo" del contrato
  agedGold: "#C9A227", // dorado envejecido — SOLO acento puntual, nunca dominante
};
