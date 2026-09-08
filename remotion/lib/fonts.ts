import { loadFont as loadBebasNeue } from "@remotion/google-fonts/BebasNeue";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

const bebas = loadBebasNeue();
const oswald = loadOswald("normal", { weights: ["400", "500", "600", "700"] });
// Sans-serif limpia para los subtítulos de narración — más legible en
// video/móvil que la serif fina que se usaba antes (Cormorant Garamond).
const inter = loadInter("normal", { weights: ["400", "500", "600"] });

export const displayFontFamily = bebas.fontFamily;
export const captionFontFamily = oswald.fontFamily;
export const subtitleFontFamily = inter.fontFamily;

export const ensureFontsLoaded = async () => {
  await Promise.all([bebas.waitUntilDone(), oswald.waitUntilDone(), inter.waitUntilDone()]);
};
