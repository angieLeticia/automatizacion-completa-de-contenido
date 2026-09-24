// FASE 5.10-AO (Fase 2 del plan multicanal — theme de ENCIENDE EL CAOS) —
// prueba de que el nuevo theme (1) existe, (2) implementa correctamente el
// contrato ChannelVisualTheme, (3) contiene exactamente los valores
// aprobados, (4) no depende de/copia sinExplicacionTheme, y (5) que
// sinExplicacionTheme/ALZA LA VOZ no cambiaron.
import { readFileSync } from "node:fs";
import { enciendeElCaosTheme, enciendeElCaosExtraColors } from "../../channels/enciende-el-caos/theme.ts";
import { sinExplicacionTheme, colors, fonts, timing, layout, FPS } from "../../remotion/theme.ts";
import { antonFontFamily, montserratFontFamily, displayFontFamily, captionFontFamily, subtitleFontFamily, quoteFontFamily } from "../../remotion/lib/fonts.ts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

// ---- 1. El theme existe y tiene la forma completa del contrato ----
check("enciendeElCaosTheme existe", Boolean(enciendeElCaosTheme));
for (const key of ["colors", "fonts", "timing", "layout"] as const) {
  check(`enciendeElCaosTheme.${key} existe`, Boolean(enciendeElCaosTheme[key]));
}
for (const key of ["background", "ink", "inkDim", "accent", "accentGlow", "vignette"] as const) {
  check(`enciendeElCaosTheme.colors.${key} es un string no vacío`, typeof enciendeElCaosTheme.colors[key] === "string" && enciendeElCaosTheme.colors[key].length > 0);
}
for (const key of ["display", "caption", "subtitle"] as const) {
  check(`enciendeElCaosTheme.fonts.${key} es un string no vacío`, typeof enciendeElCaosTheme.fonts[key] === "string" && enciendeElCaosTheme.fonts[key].length > 0);
}
for (const key of ["captionFadeFrames", "hookHoldSeconds", "sceneGlitchTransitionFrames"] as const) {
  check(`enciendeElCaosTheme.timing.${key} es un número finito`, typeof enciendeElCaosTheme.timing[key] === "number" && Number.isFinite(enciendeElCaosTheme.timing[key]));
}
check("enciendeElCaosTheme.layout.main = 1920x1080 (16:9, confirmado)", enciendeElCaosTheme.layout.main.width === 1920 && enciendeElCaosTheme.layout.main.height === 1080);
check("enciendeElCaosTheme.layout.short = 1080x1920 (9:16, confirmado)", enciendeElCaosTheme.layout.short.width === 1080 && enciendeElCaosTheme.layout.short.height === 1920);

// ---- 2. Contiene EXACTAMENTE la paleta aprobada (valores textuales, no aproximados) ----
check('colors.background === "#0B0B0F" (fondo principal aprobado)', enciendeElCaosTheme.colors.background === "#0B0B0F");
check('colors.ink === "#FFFFFF" (blanco aprobado)', enciendeElCaosTheme.colors.ink === "#FFFFFF");
check('colors.inkDim === "#A7A7AD" (gris secundario aprobado)', enciendeElCaosTheme.colors.inkDim === "#A7A7AD");
check('colors.accent === "#E5092F" (rojo principal aprobado)', enciendeElCaosTheme.colors.accent === "#E5092F");
check('accentGlow deriva de accent (contiene "229, 9, 47", la forma rgb de #E5092F)', enciendeElCaosTheme.colors.accentGlow.includes("229, 9, 47"));
check('vignette deriva de "negro profundo" #050507 (contiene "5, 5, 7")', enciendeElCaosTheme.colors.vignette.includes("5, 5, 7"));
check('enciendeElCaosExtraColors.redDark === "#8F061F" (rojo oscuro aprobado)', enciendeElCaosExtraColors.redDark === "#8F061F");
check('enciendeElCaosExtraColors.alertYellow === "#FFD21F" (amarillo alerta aprobado)', enciendeElCaosExtraColors.alertYellow === "#FFD21F");

// ---- 3. Tipografías: Anton (headlines) y Montserrat (secundario), ambas aprobadas ----
check("enciendeElCaosTheme.fonts.display === antonFontFamily (Anton real, cargada vía @remotion/google-fonts)", enciendeElCaosTheme.fonts.display === antonFontFamily);
check("enciendeElCaosTheme.fonts.caption === montserratFontFamily (Montserrat real)", enciendeElCaosTheme.fonts.caption === montserratFontFamily);
check("enciendeElCaosTheme.fonts.subtitle === montserratFontFamily (Montserrat real)", enciendeElCaosTheme.fonts.subtitle === montserratFontFamily);
check("antonFontFamily y montserratFontFamily son strings reales no vacíos (fuente sí se resolvió)", typeof antonFontFamily === "string" && antonFontFamily.length > 0 && typeof montserratFontFamily === "string" && montserratFontFamily.length > 0);

// ---- 4. NO depende de/copia sinExplicacionTheme — ningún valor coincide con SIN EXPLICACIÓN ----
check("colors.background de ENCIENDE EL CAOS es DISTINTO al de SIN EXPLICACIÓN", enciendeElCaosTheme.colors.background !== sinExplicacionTheme.colors.background);
check("colors.accent de ENCIENDE EL CAOS es DISTINTO al de SIN EXPLICACIÓN", enciendeElCaosTheme.colors.accent !== sinExplicacionTheme.colors.accent);
check("fonts.display de ENCIENDE EL CAOS es DISTINTO (Anton) al de SIN EXPLICACIÓN (Bebas Neue)", enciendeElCaosTheme.fonts.display !== sinExplicacionTheme.fonts.display);
check("fonts.subtitle de ENCIENDE EL CAOS es DISTINTO (Montserrat) al de SIN EXPLICACIÓN (Inter)", enciendeElCaosTheme.fonts.subtitle !== sinExplicacionTheme.fonts.subtitle);
check("enciendeElCaosTheme completo NO es el mismo objeto que sinExplicacionTheme", enciendeElCaosTheme !== (sinExplicacionTheme as unknown));

// ---- 5. sinExplicacionTheme (identidad histórica de SIN EXPLICACIÓN) SIN CAMBIOS ----
const EXPECTED_SIN_EXPLICACION = {
  colors: { background: "#050505", ink: "#f4f1ea", inkDim: "rgba(244, 241, 234, 0.72)", accent: "#c81e1e", accentGlow: "rgba(200, 30, 30, 0.55)", vignette: "rgba(0, 0, 0, 0.82)" },
  timing: { captionFadeFrames: 14, hookHoldSeconds: 2.6, sceneGlitchTransitionFrames: 12 },
  layout: { main: { width: 1920, height: 1080 }, short: { width: 1080, height: 1920 } },
};
check("sinExplicacionTheme.colors sin cambios exactos", JSON.stringify(sinExplicacionTheme.colors) === JSON.stringify(EXPECTED_SIN_EXPLICACION.colors));
check("sinExplicacionTheme.timing sin cambios exactos", JSON.stringify(sinExplicacionTheme.timing) === JSON.stringify(EXPECTED_SIN_EXPLICACION.timing));
check("sinExplicacionTheme.layout sin cambios exactos", JSON.stringify(sinExplicacionTheme.layout) === JSON.stringify(EXPECTED_SIN_EXPLICACION.layout));
check("Exports históricos colors/fonts/timing/layout siguen === sinExplicacionTheme.*", colors === sinExplicacionTheme.colors && fonts === sinExplicacionTheme.fonts && timing === sinExplicacionTheme.timing && layout === sinExplicacionTheme.layout);
check("FPS global sin cambios (30)", FPS === 30);
check("Las 4 fuentes históricas (display/caption/subtitle/quote de SIN EXPLICACIÓN/ALZA LA VOZ) siguen siendo strings reales no vacíos", [displayFontFamily, captionFontFamily, subtitleFontFamily, quoteFontFamily].every((f) => typeof f === "string" && f.length > 0));

// ---- 6. ALZA LA VOZ (QuoteVideo/channels/alza-la-voz) no fue tocado ----
const quoteVideoSrc = readFileSync(new URL("../../remotion/QuoteVideo.tsx", import.meta.url), "utf8");
check("QuoteVideo.tsx no importa nada de channels/enciende-el-caos", !quoteVideoSrc.includes("enciende-el-caos"));
const alzaVideosSrc = readFileSync(new URL("../../channels/alza-la-voz/videos.ts", import.meta.url), "utf8");
check("channels/alza-la-voz/videos.ts no fue tocado (sin referencias a ENCIENDE EL CAOS)", !alzaVideosSrc.includes("ENCIENDE") && !alzaVideosSrc.includes("enciende-el-caos"));

// ---- 7. Sin if/else por nombre de canal en los archivos compartidos tocados esta fase ----
// OJO: sin "$" al final del patrón — con line endings CRLF (\r\n reales en
// este repo), "$" (sin flag /m) no matchea antes de un "\r" colgante tras el
// split, dejando el comentario sin recortar. "." ya no cruza \r/\n por sí
// solo, así que no hace falta el ancla.
const stripLineComments = (src: string): string => src.split(/\r?\n/).map((l) => l.replace(/\/\/.*/, "")).join("\n");
const fontsSrc = readFileSync(new URL("../../remotion/lib/fonts.ts", import.meta.url), "utf8");
check(
  "remotion/lib/fonts.ts (compartido, tocado esta fase de forma aditiva) no contiene comparaciones de nombre de canal en código real",
  !/SIN EXPLICACI|ENCIENDE|LUNA VERDE|OBJETOS MALDITOS/.test(stripLineComments(fontsSrc))
);
const themeSrc = readFileSync(new URL("../../remotion/theme.ts", import.meta.url), "utf8");
check("remotion/theme.ts (NO tocado esta fase) sigue sin comparaciones de nombre de canal", !/ENCIENDE|LUNA VERDE|OBJETOS MALDITOS/.test(stripLineComments(themeSrc)));

// ---- 8. remotion/theme.ts en sí NO fue modificado en esta fase (misma longitud/contenido que Fase 1 dejó) ----
check("remotion/theme.ts sigue exportando exactamente el mismo contrato ChannelVisualTheme (colors/fonts/timing/layout)", /export type ChannelVisualTheme/.test(themeSrc) && /export const sinExplicacionTheme/.test(themeSrc));

console.log(failures === 0 ? "\nTODAS LAS PRUEBAS PASARON" : `\n${failures} CASO(S) FALLARON`);
if (failures > 0) process.exit(1);
