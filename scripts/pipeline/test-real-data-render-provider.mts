// Bloque 1 (post-Fase 6.5) — pruebas estructurales del mecanismo GENÉRICO que
// conecta processOne.mts con datos reales de episodio: isRealDataRenderProvider()
// (renderProvider.mts) y su uso en processOne.mts. Nunca prueba un canal por
// nombre — el punto entero de este bloque es que la detección es por
// capacidad (duck typing), no por "if (channel === ...)".
import "./env.mts";
import { readFileSync } from "node:fs";
import { isRealDataRenderProvider } from "./renderProvider.mts";
import { documentaryRemotionProvider } from "./documentaryRemotionProvider.mts";
import { quoteVideoProvider } from "./quoteVideoProvider.mts";
import { chaosNewsRemotionProvider } from "./chaosNewsRemotionProvider.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

// ============================================================
// isRealDataRenderProvider() — capacidad, nunca nombre de canal
// ============================================================
check("isRealDataRenderProvider(documentaryRemotionProvider) === false (SIN EXPLICACIÓN no implementa la capacidad, ni tiene por qué)", isRealDataRenderProvider(documentaryRemotionProvider) === false);
check("isRealDataRenderProvider(quoteVideoProvider) === false (ALZA LA VOZ tampoco la implementa)", isRealDataRenderProvider(quoteVideoProvider) === false);
check("isRealDataRenderProvider(chaosNewsRemotionProvider) === true (único provider que la implementa hoy)", isRealDataRenderProvider(chaosNewsRemotionProvider) === true);

// Doble verificación por texto — documentaryRemotionProvider.mts/quoteVideoProvider.mts
// NUNCA deben haber ganado renderMainWithRealData/renderClipWithRealData
// (si algún día alguien los agrega ahí "para que funcione", esto lo detecta).
{
  const docSrc = readFileSync(new URL("./documentaryRemotionProvider.mts", import.meta.url), "utf-8");
  const quoteSrc = readFileSync(new URL("./quoteVideoProvider.mts", import.meta.url), "utf-8");
  check("documentaryRemotionProvider.mts no define renderMainWithRealData/renderClipWithRealData", !/renderMainWithRealData|renderClipWithRealData/.test(docSrc));
  check("quoteVideoProvider.mts no define renderMainWithRealData/renderClipWithRealData", !/renderMainWithRealData|renderClipWithRealData/.test(quoteSrc));
}

// ============================================================
// chaosNewsRemotionProvider — implementa la capacidad de verdad, expone
// las 4 funciones reales (renderMain/renderClip sin cambios de Fase 5/6.5,
// más las 2 nuevas)
// ============================================================
{
  const p = chaosNewsRemotionProvider;
  check("chaosNewsRemotionProvider.renderMain sigue siendo función (sin cambios)", typeof p.renderMain === "function");
  check("chaosNewsRemotionProvider.renderClip sigue siendo función (sin cambios)", typeof p.renderClip === "function");
  check("chaosNewsRemotionProvider.renderMainWithProps sigue siendo función (Fase 6.5, sin cambios)", typeof p.renderMainWithProps === "function");
  check("chaosNewsRemotionProvider.renderClipWithProps sigue siendo función (Fase 6.5, sin cambios)", typeof p.renderClipWithProps === "function");
  check("chaosNewsRemotionProvider.renderMainWithRealData es función nueva de Bloque 1", typeof p.renderMainWithRealData === "function");
  check("chaosNewsRemotionProvider.renderClipWithRealData es función nueva de Bloque 1", typeof p.renderClipWithRealData === "function");
}

// ============================================================
// processOne.mts — verificación de que la rama SIN capacidad (else) es
// EXACTAMENTE la llamada histórica (documentary-remotion/quote-video-remotion
// no ven ningún comportamiento nuevo) — comprobación por texto, ya que
// ejercitar processOne.mts real de punta a punta contra SIN EXPLICACIÓN
// tomaría ~30-40 min de whisper y ya está cubierto por la batería de
// regresión existente (machine:test/provider:test).
// ============================================================
{
  const src = readFileSync(new URL("./processOne.mts", import.meta.url), "utf-8");
  check(
    'processOne.mts — rama SIN capacidad para MAIN es exactamente "renderProvider.renderMain(compositionEpisodeId, context)"',
    /await renderProvider\.renderMain\(compositionEpisodeId, context\)/.test(src)
  );
  check(
    'processOne.mts — rama SIN capacidad para CLIP es exactamente "renderProvider.renderClip(compositionEpisodeId, i, context)"',
    /await renderProvider\.renderClip\(compositionEpisodeId, i, context\)/.test(src)
  );
  check("processOne.mts — el despacho usa isRealDataRenderProvider(renderProvider), nunca un nombre de canal literal", /isRealDataRenderProvider\(renderProvider\)/.test(src) && !/account === "ENCIENDE EL CAOS"|account === "LUNA VERDE"|account === "OBJETOS MALDITOS"/.test(src));
  check("processOne.mts — el objeto realEpisodeData reutiliza variables YA calculadas (captions/videoItems/imageItems/shots/narrationRelPath/narrationDurationSeconds/reelOptions), no una fuente de datos nueva", /captions,\s*\n\s*videoPool: videoItems,\s*\n\s*imagePool: imageItems,\s*\n\s*shots,\s*\n\s*narrationFile: narrationRelPath,\s*\n\s*narrationDurationSeconds,\s*\n\s*reelOptions,/.test(src));
}

console.log(`\n${failures === 0 ? "TODOS LOS CASOS PASARON" : `${failures} CASO(S) FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
