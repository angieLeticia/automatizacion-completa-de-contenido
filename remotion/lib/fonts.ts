import { loadFont as loadBebasNeue } from "@remotion/google-fonts/BebasNeue";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";
// FASE 5.10-AO (Fase 2 — theme de ENCIENDE EL CAOS) — mismo patrón
// centralizado que las 4 fuentes de arriba. Cambio puramente ADITIVO: no
// toca ninguna fuente/export existente, no cambia ningún comportamiento de
// SIN EXPLICACIÓN ni ALZA LA VOZ. Verificado antes de agregarlas (no
// supuesto): ambos paquetes existen instalados en este repo
// (node_modules/@remotion/google-fonts/dist/esm/Anton.mjs y Montserrat.mjs).
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";

const bebas = loadBebasNeue();
const oswald = loadOswald("normal", { weights: ["400", "500", "600", "700"] });
// Sans-serif limpia para los subtítulos de narración — más legible en
// video/móvil que la serif fina que se usaba antes (Cormorant Garamond).
const inter = loadInter("normal", { weights: ["400", "500", "600"] });
// Fase 5.1 — migrado de QuoteVideo.tsx (ex-repositorio Alza-la-Voz): mismo
// patrón centralizado de esta misma tabla, en vez de un loadFont() propio
// suelto dentro del componente.
const poppins = loadPoppins("normal", { weights: ["600"], subsets: ["latin"] });
// Fase 5.10-AO — Anton (headlines) y Montserrat (texto secundario/apoyo)
// para ENCIENDE EL CAOS, valores aprobados explícitamente por el usuario.
// Anton solo tiene el peso 400 real en Google Fonts (es una familia
// "display" de un solo grosor) — no se pide un weight inexistente.
const anton = loadAnton("normal", { weights: ["400"] });
const montserrat = loadMontserrat("normal", { weights: ["400", "500", "600", "700"] });

export const displayFontFamily = bebas.fontFamily;
export const captionFontFamily = oswald.fontFamily;
export const subtitleFontFamily = inter.fontFamily;
export const quoteFontFamily = poppins.fontFamily;
export const antonFontFamily = anton.fontFamily;
export const montserratFontFamily = montserrat.fontFamily;

export const ensureFontsLoaded = async () => {
  await Promise.all([
    bebas.waitUntilDone(),
    oswald.waitUntilDone(),
    inter.waitUntilDone(),
    poppins.waitUntilDone(),
    anton.waitUntilDone(),
    montserrat.waitUntilDone(),
  ]);
};
