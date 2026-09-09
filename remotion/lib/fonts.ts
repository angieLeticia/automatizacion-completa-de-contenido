import { loadFont as loadBebasNeue } from "@remotion/google-fonts/BebasNeue";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";

const bebas = loadBebasNeue();
const oswald = loadOswald("normal", { weights: ["400", "500", "600", "700"] });
// Sans-serif limpia para los subtítulos de narración — más legible en
// video/móvil que la serif fina que se usaba antes (Cormorant Garamond).
const inter = loadInter("normal", { weights: ["400", "500", "600"] });
// Fase 5.1 — migrado de QuoteVideo.tsx (ex-repositorio Alza-la-Voz): mismo
// patrón centralizado de esta misma tabla, en vez de un loadFont() propio
// suelto dentro del componente.
const poppins = loadPoppins("normal", { weights: ["600"], subsets: ["latin"] });

export const displayFontFamily = bebas.fontFamily;
export const captionFontFamily = oswald.fontFamily;
export const subtitleFontFamily = inter.fontFamily;
export const quoteFontFamily = poppins.fontFamily;

export const ensureFontsLoaded = async () => {
  await Promise.all([bebas.waitUntilDone(), oswald.waitUntilDone(), inter.waitUntilDone(), poppins.waitUntilDone()]);
};
