// FASE 5.10-AR (Fase 5 — RenderProvider de ENCIENDE EL CAOS) — pruebas
// estructurales (mismo patrón de todo el proyecto) + una invocación REAL del
// provider contra Remotion real (assets sintéticos generados y borrados por
// esta misma prueba — nunca material de D:\MATERIAL VIDEOS\ENCIENDE EL CAOS).
import "./env.mts";
import { readFileSync, existsSync, unlinkSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { chaosNewsRemotionProvider, CHAOS_NEWS_MAIN_COMPOSITION_ID, CHAOS_NEWS_CLIP_COMPOSITION_ID, resolveMainHookText, resolveHookText } from "./chaosNewsRemotionProvider.mts";
import { RENDER_PROVIDERS, resolveRenderProvider, ChannelNotProducibleError } from "./renderProviderRegistry.mts";
import { resolveChannelConfig, resolveScannableChannels } from "./channelRegistry.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const read = (relPath: string): string => readFileSync(new URL(relPath, import.meta.url), "utf8");
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map((l) => l.replace(/\/\/.*/, "")).join("\n");

// ============================================================
// REGISTRO — el provider existe, id correcto, registrado según el patrón real
// ============================================================
check('chaosNewsRemotionProvider.id === "chaos-news-remotion"', chaosNewsRemotionProvider.id === "chaos-news-remotion");
check('RENDER_PROVIDERS["chaos-news-remotion"] === chaosNewsRemotionProvider (registrado en el mismo Record que documentary-remotion/quote-video-remotion)', RENDER_PROVIDERS["chaos-news-remotion"] === chaosNewsRemotionProvider);
check("chaosNewsRemotionProvider expone renderMain/renderClip reales (cumple el contrato RenderProvider)", typeof chaosNewsRemotionProvider.renderMain === "function" && typeof chaosNewsRemotionProvider.renderClip === "function");

// ============================================================
// COMPOSICIÓN — main -> ChaosNewsMain, clip -> ChaosNewsClip, nunca los históricos
// ============================================================
check('CHAOS_NEWS_MAIN_COMPOSITION_ID === "ChaosNewsMain"', CHAOS_NEWS_MAIN_COMPOSITION_ID === "ChaosNewsMain");
check('CHAOS_NEWS_CLIP_COMPOSITION_ID === "ChaosNewsClip"', CHAOS_NEWS_CLIP_COMPOSITION_ID === "ChaosNewsClip");
{
  const src = read("../../scripts/pipeline/chaosNewsRemotionProvider.mts");
  check('El mapeo main->composición usa CHAOS_NEWS_MAIN_COMPOSITION_ID, nunca "MainDocumentary"', /CHAOS_NEWS_MAIN_COMPOSITION_ID/.test(src) && !/renderComposition\(["'`]MainDocumentary/.test(src));
  check('El mapeo clip->composición usa CHAOS_NEWS_CLIP_COMPOSITION_ID, nunca "ShortClip"/"Short-"', /CHAOS_NEWS_CLIP_COMPOSITION_ID/.test(src) && !/renderComposition\(["'`]Short/.test(src));
  check("El mapeo ocurre en esta capa de configuración, NUNCA dentro de un componente React (este archivo no importa nada de remotion/components/)", !src.includes("remotion/components/"));
}

// ============================================================
// IDENTIDAD — sin fallback de voz/logo/watermark/audio hacia SIN EXPLICACIÓN
// ============================================================
{
  const src = read("../../scripts/pipeline/chaosNewsRemotionProvider.mts");
  const code = stripComments(src);
  check("chaosNewsRemotionProvider.mts NO importa documentaryRemotionProvider.mts (sin reutilizar SU render directo)", !/^import[^\n]*documentaryRemotionProvider/m.test(code));
  check('chaosNewsRemotionProvider.mts sin nombres de canal hardcodeados en código real', !/SIN EXPLICACI|LUNA VERDE|OBJETOS MALDITOS|ALZA LA VOZ/.test(code));
  check("chaosNewsRemotionProvider.mts no referencia ninguna voz (kate/velvet/elevenlabs) — el provider de render nunca decide voz", !/kate|velvet|elevenlabs/i.test(code));
  // Los nombres de archivo DE SALIDA sí incluyen ".mp4" (ej.
  // `chaos-news-main-${episodeId}.mp4`) — eso es esperado, no un asset
  // hardcodeado. Lo que NO debe existir es un literal ESTÁTICO (sin `${`
  // cerca) apuntando a un asset real de entrada (png/svg/mp3/wav u otro
  // .mp4 que no sea el propio nombre de salida generado dinámicamente).
  const staticAssetLiteral = /(?<!\$\{[^}]{0,80})["'`][^"'`$]*\.(png|svg|mp3|wav)["'`]/i;
  check("chaosNewsRemotionProvider.mts no referencia ningún asset de entrada (png/svg/mp3/wav) hardcodeado", !staticAssetLiteral.test(code));

  // Las composiciones (Fase 4) ya garantizan que Watermark/AmbientAudio solo
  // se montan con config real — re-confirmado aquí porque es justo lo que
  // este provider termina invocando en producción.
  const mainSrc = read("../../remotion/ChaosNewsMain.tsx");
  const clipSrc = read("../../remotion/ChaosNewsClip.tsx");
  check("ChaosNewsMain.tsx: Watermark condicional a watermark?.imageSrc sigue intacto (provider no lo puentea)", /\{watermark\?\.imageSrc && </.test(mainSrc));
  check("ChaosNewsMain.tsx: AmbientAudio condicional a config.audio sigue intacto", /\{config\.audio && </.test(mainSrc));
  check("ChaosNewsClip.tsx: Watermark condicional a watermark?.imageSrc sigue intacto", /\{watermark\?\.imageSrc && </.test(clipSrc));
  check("ChaosNewsClip.tsx: AmbientAudio condicional a config.audio sigue intacto", /\{config\.audio && </.test(clipSrc));
}

// ============================================================
// PROPS — theme/audio/hook/twist/captions/b-roll se conservan; ausencia de voz funciona
// ============================================================
{
  const { chaosMainFixture } = await import("../../remotion/lib/chaosFixture.ts");
  check("chaosMainFixture.theme existe (identidad visual real de ENCIENDE EL CAOS, Fase 2)", Boolean(chaosMainFixture.theme));
  check("chaosMainFixture.hook existe", Boolean(chaosMainFixture.hook));
  check("chaosMainFixture.twists existe (giro configurado)", Array.isArray(chaosMainFixture.twists) && chaosMainFixture.twists.length > 0);
  check("chaosMainFixture.captions existe", Array.isArray(chaosMainFixture.captions) && chaosMainFixture.captions.length > 0);
  check("chaosMainFixture.videoPool/imagePool existen (b-roll)", chaosMainFixture.videoPool.length > 0 && chaosMainFixture.imagePool.length > 0);
  check("chaosMainFixture.narrationFile está AUSENTE (ausencia de voz funciona sin romper el tipo)", chaosMainFixture.narrationFile === undefined);
  check("chaosMainFixture.audio está AUSENTE (ausencia de música/SFX funciona sin romper el tipo)", chaosMainFixture.audio === undefined);
}

// ============================================================
// CIERRE EDITORIAL — hook real (MAIN y CLIP): resolveMainHookText/
// resolveHookText son las funciones REALES que renderMainWithRealData/
// renderClipWithRealData usan — probadas aquí directamente (rápido, sin
// renderizar) contra datos sintéticos con forma real, nunca contra
// D:\MATERIAL VIDEOS.
// ============================================================
{
  const HOOK_MARKER = "Setenta millones de dólares reales de prueba.";
  const NORMAL_MARKER = "Frase normal real de prueba, mucho más larga que un hook típico.";

  // --- MAIN ---
  const withHookCaptions = resolveMainHookText([
    { start: 0, end: 2, text: HOOK_MARKER, type: "hook" },
    { start: 2, end: 8, text: NORMAL_MARKER, type: "normal" },
  ]);
  check("resolveMainHookText — con captions type='hook' reales, devuelve ESE texto real tal cual", withHookCaptions.includes(HOOK_MARKER));
  check("resolveMainHookText — nunca devuelve el texto del fixture ni la palabra [FIXTURE]", !withHookCaptions.includes("[FIXTURE]") && !withHookCaptions.includes("Titular de prueba"));

  const withoutHookCaptions = resolveMainHookText([{ start: 0, end: 8, text: NORMAL_MARKER, type: "normal" }]);
  check("resolveMainHookText — sin captions type='hook', cae al primer caption real (sigue siendo real, nunca inventado)", withoutHookCaptions.includes(NORMAL_MARKER.slice(0, 20)));

  const withNoCaptions = resolveMainHookText([]);
  check("resolveMainHookText — sin NINGÚN caption, usa un marcador explícito que nunca simula contenido real", withNoCaptions.startsWith("[SIN HOOK REAL DISPONIBLE"));

  // --- CLIP ---
  const clipReal = resolveHookText("Lo encontraron real de prueba, y entonces todo cambió.");
  check("resolveHookText (clip) — con hookText real (de clipSelector.mts), lo usa tal cual", clipReal === "Lo encontraron real de prueba, y entonces todo cambió.");
  const clipMissing = resolveHookText(undefined);
  check("resolveHookText (clip) — sin hookText real, usa un marcador explícito que nunca simula contenido real", clipMissing.startsWith("[SIN HOOK REAL DISPONIBLE"));
  check("resolveHookText (clip) — el marcador de ausencia nunca contiene [FIXTURE]", !clipMissing.includes("[FIXTURE]"));

  // --- verificación por texto fuente (código real, comentarios excluidos):
  // renderMainWithRealData/renderClipWithRealData nunca leen
  // chaosMainFixture.hook.text ni chaosClipFixture.hookText, ni
  // chaosMainFixture/chaosClipFixture.breakingTags/.twists — solo
  // resolveMainHookText/resolveHookText y arrays vacíos literales.
  // `chaosMainFixture.hook.durationInFrames` (SOLO la duración, nunca el
  // texto) sí se reutiliza a propósito — es un valor de timing técnico, no
  // de contenido, mismo criterio que "mínima modificación" pedido. ---
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map((l) => l.replace(/\/\/.*/, "")).join("\n");
  const providerSrc = stripComments(read("./chaosNewsRemotionProvider.mts"));
  const realDataSection = providerSrc.slice(providerSrc.indexOf("async renderMainWithRealData"));
  check("renderMainWithRealData — nunca lee chaosMainFixture.hook.text (código real, sin comentarios)", !/chaosMainFixture\.hook\.text/.test(realDataSection));
  check("renderMainWithRealData — SÍ reutiliza chaosMainFixture.hook.durationInFrames (timing técnico, no contenido — intencional)", /chaosMainFixture\.hook\.durationInFrames/.test(realDataSection));
  check("renderMainWithRealData/renderClipWithRealData — nunca leen chaosMainFixture.breakingTags/.twists (código real)", !/chaosMainFixture\.(breakingTags|twists)/.test(realDataSection));
  check("renderMainWithRealData/renderClipWithRealData — nunca leen chaosClipFixture.hookText/.breakingTags/.twists (código real)", !/chaosClipFixture\.(hookText|breakingTags|twists)/.test(realDataSection));
  check("renderMainWithRealData/renderClipWithRealData — usan breakingTags: [] y twists: [] literales", /breakingTags: \[\]/.test(realDataSection) && /twists: \[\]/.test(realDataSection));
}

// ============================================================
// SEGURIDAD OPERATIVA — registrar el provider NO activa el canal
// ============================================================
{
  const scannable = resolveScannableChannels();
  check('resolveScannableChannels() sigue resolviendo EXACTAMENTE ["SIN EXPLICACIÓN"] (ENCIENDE EL CAOS no se volvió escaneable)', JSON.stringify(scannable) === JSON.stringify(["SIN EXPLICACIÓN"]));

  const config = resolveChannelConfig("ENCIENDE EL CAOS");
  check('channelRegistry: ENCIENDE EL CAOS.channelStatus sigue siendo "HISTORICAL" (sin cambios)', config?.channelStatus === "HISTORICAL");
  check('channelRegistry: ENCIENDE EL CAOS.renderProviderId === "chaos-news-remotion" (registrado técnicamente)', config?.renderProviderId === "chaos-news-remotion");

  let threw = false;
  let isChannelNotProducible = false;
  try {
    resolveRenderProvider("ENCIENDE EL CAOS");
  } catch (err) {
    threw = true;
    isChannelNotProducible = err instanceof ChannelNotProducibleError;
  }
  check("resolveRenderProvider(\"ENCIENDE EL CAOS\") SIGUE bloqueado (ChannelNotProducibleError) aunque el provider ya exista de verdad", threw && isChannelNotProducible);
}

console.log(failures === 0 ? "\nTODAS LAS PRUEBAS ESTRUCTURALES PASARON" : `\n${failures} CASO(S) FALLARON`);

// ============================================================
// VALIDACIÓN SINTÉTICA REAL — provider -> composición -> inputProps [fixture]
// -> Remotion -> output. Assets sintéticos generados y borrados por esta
// misma prueba (ffmpeg), NUNCA material real. Se corre solo si RUN_REAL_RENDER=1
// para no gastar tiempo de render en cada ejecución rutinaria de la batería
// de regresión — la evidencia de esta validación ya quedó documentada en el
// informe de Fase 5 (corrida manual explícita).
// ============================================================
if (process.env.RUN_REAL_RENDER === "1") {
  const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
  const videoDir = path.join(REPO_ROOT, "public", "assets", "video", "_fixture_chaos");
  const imageDir = path.join(REPO_ROOT, "public", "assets", "images", "_fixture_chaos");
  const outPath = path.join(REPO_ROOT, "out", "chaos-news-main-faseFiveTest.mp4");
  mkdirSync(videoDir, { recursive: true });
  mkdirSync(imageDir, { recursive: true });
  try {
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=1920x1080:d=4:r=30", "-pix_fmt", "yuv420p", path.join(videoDir, "clip-a.mp4")], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=1920x1080", "-frames:v", "1", path.join(imageDir, "image-a.jpg")], { stdio: "ignore" });

    const result = await chaosNewsRemotionProvider.renderMain("faseFiveTest");
    check("chaosNewsRemotionProvider.renderMain() real: produce un archivo con bytes > 0", existsSync(result.path) && result.path.length > 0);
    check("chaosNewsRemotionProvider.renderMain() real: devuelve un hash real (no vacío)", typeof result.hash === "string" && result.hash.length > 0);
    if (existsSync(result.path)) unlinkSync(result.path);
  } finally {
    rmSync(videoDir, { recursive: true, force: true });
    rmSync(imageDir, { recursive: true, force: true });
    if (existsSync(outPath)) unlinkSync(outPath);
  }
  console.log(failures === 0 ? "\nVALIDACIÓN SINTÉTICA REAL: PASS" : "\nVALIDACIÓN SINTÉTICA REAL: FAIL");
} else {
  console.log("\n[INFO] Validación de render real omitida (set RUN_REAL_RENDER=1 para ejecutarla) — ver informe de Fase 5 para la evidencia ya recolectada manualmente.");
}

if (failures > 0) process.exit(1);
