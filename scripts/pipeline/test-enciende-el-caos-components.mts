// FASE 5.10-AP (Fase 3 — componentes visuales de ENCIENDE EL CAOS) — pruebas
// estructurales (mismo patrón ya usado en todo este proyecto para
// remotion/*.tsx, que no tiene infraestructura de render/testing de React —
// nunca se hizo render real, como exige esta fase): inspección de código
// real para confirmar (1) que cada componente existe y exporta lo esperado,
// (2) que sus props principales existen con los defaults correctos, (3) que
// ninguno depende del nombre de un canal ni de la identidad de SIN
// EXPLICACIÓN/ALZA LA VOZ, y (4) que Watermark.tsx preserva exactamente su
// comportamiento histórico.
import { readFileSync } from "node:fs";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const read = (relPath: string): string => readFileSync(new URL(relPath, import.meta.url), "utf8");
// Sin "$" al final del patrón (ver hallazgo real de Fase 2: con CRLF real de
// este repo, "$" sin /m no matchea antes de un "\r" colgante tras el split).
const stripLineComments = (src: string): string => src.split(/\r?\n/).map((l) => l.replace(/\/\/.*/, "")).join("\n");
const noChannelNameCoupling = (src: string, label: string) =>
  check(`${label}: sin comparaciones de nombre de canal en código real (sin comentarios)`, !/SIN EXPLICACI|ENCIENDE EL CAOS|LUNA VERDE|OBJETOS MALDITOS|ALZA LA VOZ/.test(stripLineComments(src)));

// ============================================================
// 1. ChaosInteractiveText
// ============================================================
{
  const src = read("../../remotion/components/ChaosInteractiveText.tsx");
  check("ChaosInteractiveText: exporta el componente", /export const ChaosInteractiveText/.test(src));
  check("ChaosInteractiveText: exporta el tipo de variante", /export type ChaosTextVariant/.test(src));
  for (const prop of ["text:", "variant?:", "fontFamily:", "color?:", "accentColor?:", "fontSize?:", "fontWeight?:", "align?:", "startFrame?:", "intensity?:"]) {
    check(`ChaosInteractiveText: prop "${prop.replace(/[?:]/g, "")}" declarada`, src.includes(prop));
  }
  check("ChaosInteractiveText: fontFamily es OBLIGATORIO (sin '?'), nunca asume la fuente de un canal", /fontFamily: string;/.test(src) && !/fontFamily\?: string/.test(src));
  check(
    "ChaosInteractiveText: NO importa GlitchText ni InteractiveText.tsx (identidad propia, no copiada) — mención en comentario explicando el porqué SÍ es válida",
    !/^import[^\n]*InteractiveText/m.test(stripLineComments(src)) && !/^import[^\n]*GlitchText/m.test(stripLineComments(src))
  );
  check("ChaosInteractiveText: NO importa remotion/theme.ts", !src.includes('from "../theme"') && !src.includes("from \"./theme\""));
  noChannelNameCoupling(src, "ChaosInteractiveText");
}

// ============================================================
// 2. BreakingTag
// ============================================================
{
  const src = read("../../remotion/components/BreakingTag.tsx");
  check("BreakingTag: exporta el componente", /export const BreakingTag/.test(src));
  check("BreakingTag: exporta tipos de posición y variante", /export type BreakingTagPosition/.test(src) && /export type BreakingTagVariant/.test(src));
  check('BreakingTag: "text" es un prop dinámico, NUNCA una lista fija de textos incrustada', /text: string;/.test(src));
  // Se permite MENCIONAR los textos de ejemplo en comentarios (documentación
  // de para qué sirve el componente) — lo que NO debe existir es una lista
  // de esos textos EN CÓDIGO real (un array/enum/const que el componente
  // use para restringir o generar el texto). Por eso se revisa el código
  // sin comentarios.
  const breakingTagCode = stripLineComments(src);
  for (const forbidden of ["ÚLTIMA HORA", "EXCLUSIVO", "SE ENCENDIÓ EL CAOS", "ATENCIÓN", "LO QUE SE SABE", "PERO HAY MÁS", "¿QUÉ PASÓ?", "NUEVO GIRO"]) {
    check(`BreakingTag: NO contiene el texto de ejemplo "${forbidden}" incrustado en código real (comentarios de documentación sí pueden mencionarlo)`, !breakingTagCode.includes(forbidden));
  }
  check('BreakingTag: soporta variant "solid" y "outline"', src.includes('"solid"') && src.includes('"outline"'));
  check("BreakingTag: color y backgroundColor son props configurables", /color\?: string/.test(src) && /backgroundColor\?: string/.test(src));
  check("BreakingTag: posición es configurable (6 posiciones)", ["top-left", "top-right", "top-center", "bottom-left", "bottom-right", "bottom-center"].every((p) => src.includes(p)));
  noChannelNameCoupling(src, "BreakingTag");
}

// ============================================================
// 3. ChannelBumper
// ============================================================
{
  const src = read("../../remotion/components/ChannelBumper.tsx");
  check("ChannelBumper: exporta el componente", /export const ChannelBumper/.test(src));
  check("ChannelBumper: durationInFrames es OBLIGATORIO (sin '?', sin duración creativa por defecto)", /durationInFrames: number;/.test(src) && !/durationInFrames\?: number/.test(src));
  check("ChannelBumper: logoSrc es OPCIONAL (sin logo real todavía)", /logoSrc\?: string/.test(src));
  check("ChannelBumper: NO hay ningún literal de ruta de imagen (png/svg/jpg) hardcodeado", !/\.(png|svg|jpe?g)["']/.test(src));
  check("ChannelBumper: el logo solo se renderiza si logoSrc está presente (condicional, nunca placeholder gráfico inventado)", /\{logoSrc && /.test(src));
  noChannelNameCoupling(src, "ChannelBumper");
}

// ============================================================
// 4. TwistCard
// ============================================================
{
  const src = read("../../remotion/components/TwistCard.tsx");
  check("TwistCard: exporta el componente", /export const TwistCard/.test(src));
  check("TwistCard: exporta el tipo de displayMode", /export type TwistCardDisplayMode/.test(src));
  check('TwistCard: soporta displayMode "fullscreen" Y "overlay" (implementado, no solo documentado)', src.includes('"fullscreen"') && src.includes('"overlay"'));
  check("TwistCard: tiene una rama de código distinta para displayMode==='fullscreen'", /displayMode === "fullscreen"/.test(src));
  check('TwistCard: "title" es el único texto obligatorio, "text" es opcional (sin copy obligatorio)', /title: string;/.test(src) && /text\?: string;/.test(src));
  check("TwistCard: durationInFrames es OBLIGATORIO (sin duración por defecto)", /durationInFrames: number;/.test(src) && !/durationInFrames\?: number/.test(src));
  noChannelNameCoupling(src, "TwistCard");
}

// ============================================================
// 5. ChaosFilmEffects
// ============================================================
{
  const src = read("../../remotion/components/ChaosFilmEffects.tsx");
  check("ChaosFilmEffects: exporta el componente", /export const ChaosFilmEffects/.test(src));
  check(
    "ChaosFilmEffects: NO importa el FilmEffects histórico de SIN EXPLICACIÓN — mención en comentario explicando el porqué SÍ es válida",
    !/^import[^\n]*FilmEffects/m.test(stripLineComments(src))
  );
  check("ChaosFilmEffects: NO importa remotion/theme.ts (sin dependencia de la identidad de SIN EXPLICACIÓN)", !src.includes('from "../theme"'));
  check("ChaosFilmEffects: vignetteIntensity por defecto es 0 (sin viñeta salvo que se pida explícitamente)", /vignetteIntensity = 0/.test(src));
  check("ChaosFilmEffects: cutFrames por defecto es [] (sin flashes salvo que se pidan explícitamente — nunca ruido constante)", /cutFrames = \[\]/.test(src));
  check("ChaosFilmEffects: flashDurationFrames es corto por defecto (5 frames — un golpe puntual, no un fundido largo)", /DEFAULT_FLASH_DURATION = 5/.test(src));
  check('ChaosFilmEffects: no usa ningún filtro SVG feTurbulence en código real (sin grano fílmico fijo heredado)', !stripLineComments(src).includes("feTurbulence"));
  noChannelNameCoupling(src, "ChaosFilmEffects");
}

// ============================================================
// 6. HookCard
// ============================================================
{
  const src = read("../../remotion/components/HookCard.tsx");
  check("HookCard: exporta el componente", /export const HookCard/.test(src));
  check("HookCard: text llega por props (sin contenido de episodio real hardcodeado)", /text: string;/.test(src));
  check("HookCard: durationInFrames es OBLIGATORIO (sin default)", /durationInFrames: number;/.test(src) && !/durationInFrames\?: number/.test(src));
  check("HookCard: imageSrc es OPCIONAL (sin imagen real todavía)", /imageSrc\?: string/.test(src));
  check(
    "HookCard: NO importa el HookCard/InteractiveText/GlitchText de ShortClip.tsx — mención en comentario explicando el porqué SÍ es válida",
    !/^import[^\n]*from ["']\.\.\/ShortClip/m.test(stripLineComments(src)) && !/^import[^\n]*InteractiveText/m.test(stripLineComments(src))
  );
  noChannelNameCoupling(src, "HookCard");
}

// ============================================================
// 7. Watermark — comportamiento histórico preservado
// ============================================================
{
  const src = read("../../remotion/components/Watermark.tsx");
  check("Watermark: imageSrc es OPCIONAL", /imageSrc\?: string/.test(src));
  check(
    'Watermark: el default de imageSrc sigue siendo EXACTAMENTE staticFile("assets/images/logo-sin-explicacion.png")',
    /DEFAULT_LOGO_SRC = staticFile\("assets\/images\/logo-sin-explicacion\.png"\)/.test(src) && /imageSrc = DEFAULT_LOGO_SRC/.test(src)
  );
  check("Watermark: size/opacity/margin conservan exactamente sus defaults históricos (100/0.6/36)", /size = 100, opacity = 0\.6, margin = 36/.test(src));
  check(
    "Watermark: sin ningún if/else por nombre de canal (sigue sin saber qué canal lo usa)",
    !/if\s*\(.*(channel|canal)/i.test(stripLineComments(src))
  );

  // Ningún llamador real existente pasa `imageSrc` todavía — confirma que
  // Intro/IntroLandscape/ChapterCard/ClosingCTA (los únicos 4 que usan
  // <Watermark>) siguen cayendo en el default histórico sin cambios.
  const callers = ["../../remotion/Intro.tsx", "../../remotion/IntroLandscape.tsx", "../../remotion/ChapterCard.tsx", "../../remotion/ClosingCTA.tsx"];
  for (const callerPath of callers) {
    const callerSrc = read(callerPath);
    const usesWatermark = /<Watermark/.test(callerSrc);
    check(`${callerPath.split("/").pop()}: usa <Watermark> sin pasar imageSrc (cae al default histórico)`, usesWatermark && !/<Watermark[^>]*imageSrc/.test(callerSrc));
  }
}

// ============================================================
// 8. Regresión — SIN EXPLICACIÓN y ALZA LA VOZ intactos
// ============================================================
{
  const mainDocSrc = read("../../remotion/MainDocumentary.tsx");
  const shortClipSrc = read("../../remotion/ShortClip.tsx");
  check("MainDocumentary.tsx no fue tocado (sigue sin importar ningún componente Chaos*)", !mainDocSrc.includes("Chaos") && !mainDocSrc.includes("BreakingTag") && !mainDocSrc.includes("TwistCard"));
  check("ShortClip.tsx no fue tocado (sigue sin importar ningún componente Chaos*/BreakingTag/TwistCard/ChannelBumper)", !shortClipSrc.includes("Chaos") && !shortClipSrc.includes("BreakingTag") && !shortClipSrc.includes("TwistCard") && !shortClipSrc.includes("ChannelBumper"));
  const quoteVideoSrc = read("../../remotion/QuoteVideo.tsx");
  check("QuoteVideo.tsx (ALZA LA VOZ) no fue tocado", !quoteVideoSrc.includes("Chaos") && !quoteVideoSrc.includes("BreakingTag") && !quoteVideoSrc.includes("TwistCard"));
  const filmEffectsSrc = read("../../remotion/components/FilmEffects.tsx");
  check("FilmEffects.tsx histórico no fue modificado (sigue usando colors.vignette de theme.ts, sin cambios)", /colors\.vignette/.test(filmEffectsSrc));
  const interactiveTextSrc = read("../../remotion/components/InteractiveText.tsx");
  check("InteractiveText.tsx (con GlitchText) histórico no fue modificado", /const GlitchText/.test(interactiveTextSrc));
}

// ============================================================
// 9. Root.tsx / composiciones — Fase 4 (ChaosNewsMain/ChaosNewsClip) ya
// fue aprobada y cerrada después de esta prueba (Fase 3). Esta sección
// original verificaba su AUSENCIA como límite de alcance de Fase 3 — esa
// aserción quedó obsoleta a propósito en cuanto Fase 4 se autorizó. El
// detalle completo de la integración real (registro en Root.tsx, contrato,
// identidad) se prueba en test-enciende-el-caos-compositions.mts, no aquí
// — esta prueba (Fase 3) se limita a re-confirmar que los 6 componentes
// que SÍ le pertenecen siguen intactos, sin duplicar esa cobertura.
// ============================================================

console.log(failures === 0 ? "\nTODAS LAS PRUEBAS PASARON" : `\n${failures} CASO(S) FALLARON`);
if (failures > 0) process.exit(1);
