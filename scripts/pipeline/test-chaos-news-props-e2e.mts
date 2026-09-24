// FASE 6.5 (PASO 8/9) — prueba REAL (no mock) de que renderer.mts ya puede
// inyectar inputProps reales en una composición Remotion real, y de que
// chaosNewsRemotionProvider.renderMainWithProps() (Fase 6.5) los reenvía sin
// perderlos:
//
//   chaosNewsRemotionProvider.renderMainWithProps()
//     -> render.renderComposition({..., props})
//     -> renderer.mts (props -> --props=<archivo temporal>)
//     -> npx remotion render (proceso real)
//     -> ChaosNewsMain (composición real de Fase 4)
//     -> inputProps.config REALMENTE recibido
//
// Evidencia usada: NUNCA se puede "leer" el pixel-texto de un frame sin
// herramientas de OCR/visión que este proyecto no tiene, así que — igual
// que ya hizo Fase 6 — la prueba usa una duración EXACTA, matemáticamente
// derivada de los props sintéticos vía la misma función pura
// chaosMainDurationInFrames() que la propia composición usa para su
// calculateMetadata. Esa duración (7.0s) es imposible de obtener
// renderizando chaosMainFixture (12.5s, el fixture fijo de Root.tsx) — si
// Remotion hubiera ignorado --props y caído de nuevo al fixture (el
// bloqueo original de Fase 5), la duración medida sería 12.5s, no 7.0s.
//
// Material: 100% sintético, generado y borrado por esta misma prueba
// (ffmpeg), en una carpeta propia "_fixture_chaos65" — nunca reutiliza ni
// toca los fixtures de Fase 4/5/6 ni D:\MATERIAL VIDEOS\ENCIENDE EL CAOS.
import "./env.mts";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chaosNewsRemotionProvider } from "./chaosNewsRemotionProvider.mts";
import { chaosMainDurationInFrames, type ChaosEpisodeConfig } from "../../remotion/lib/chaosEpisode.ts";
import { chaosMainFixture } from "../../remotion/lib/chaosFixture.ts";
import { enciendeElCaosTheme, enciendeElCaosExtraColors } from "../../channels/enciende-el-caos/theme.ts";
import { resolveChannelConfig, resolveScannableChannels } from "./channelRegistry.mts";
import { resolveRenderProvider, ChannelNotProducibleError } from "./renderProviderRegistry.mts";
import type { PipelineExecutionContext } from "./pipelineExecutionContext.mts";

let failures = 0;
const check = (label: string, cond: boolean, extra = "") => {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${extra ? " — " + extra : ""}`);
};

const FPS = 30;

// Props sintéticos, deliberadamente distintos de chaosMainFixture (duración
// distinta y verificable): hook 30f + bumper 30f + max(narración 5s=150f,
// captions hasta 4s=120f) = 210f = 7.0s exactos @ 30fps. chaosMainFixture da
// 375f = 12.5s — imposible de confundir por coincidencia.
function buildSyntheticProps(): ChaosEpisodeConfig {
  return {
    theme: enciendeElCaosTheme,
    extraColors: enciendeElCaosExtraColors,
    hook: { text: "[FASE 6.5] CHAOS_PROPS_TEST — fase65RealProps", durationInFrames: 30 },
    bumper: { channelName: "ENCIENDE EL CAOS", durationInFrames: 30 },
    captions: [
      { start: 0, end: 2, text: "[FASE 6.5] CHAOS_PROPS_TEST caption uno.", type: "hook" },
      { start: 2, end: 4, text: "[FASE 6.5] CHAOS_PROPS_TEST caption dos.", type: "normal" },
    ],
    videoPool: [{ kind: "video", file: "_fixture_chaos65/clip-props.mp4", durationSec: 4, width: 1920, height: 1080 }],
    imagePool: [{ kind: "image", file: "_fixture_chaos65/image-props.jpg", width: 1920, height: 1080 }],
    narrationDurationSeconds: 5,
  };
}

function buildSandboxContext(): PipelineExecutionContext {
  const testRoot = mkdtempSync(path.join(tmpdir(), "chaos-props-fase65-"));
  const libDir = path.join(testRoot, "lib");
  const dataRoot = path.join(testRoot, "data");
  const publicAssetsRoot = path.join(testRoot, "public", "assets");
  const outputRoot = path.join(testRoot, "out");
  mkdirSync(libDir, { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(publicAssetsRoot, { recursive: true });
  mkdirSync(outputRoot, { recursive: true });

  // ChaosNewsMain/ChaosNewsClip nunca leen este catálogo (Fase 4 — reciben
  // su config vía props, no vía getEpisode()) — existe solo para que
  // remotion.config.ts tenga un alias válido si REMOTION_TEST_EPISODES_CATALOG
  // llega a resolverse (no se ejercita en este flujo, pero debe ser un
  // archivo real y legible).
  const episodesFile = path.join(libDir, "episodes.ts");
  writeFileSync(episodesFile, `export const episodes = [];\nexport const mainDurationInFrames = () => 0;\n`);

  const videoDir = path.join(publicAssetsRoot, "video", "_fixture_chaos65");
  const imageDir = path.join(publicAssetsRoot, "images", "_fixture_chaos65");
  mkdirSync(videoDir, { recursive: true });
  mkdirSync(imageDir, { recursive: true });
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=green:s=1920x1080:d=4:r=30", "-pix_fmt", "yuv420p", path.join(videoDir, "clip-props.mp4")], { stdio: "ignore" });
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=yellow:s=1920x1080", "-frames:v", "1", path.join(imageDir, "image-props.jpg")], { stdio: "ignore" });

  return { episodesFile, dataRoot, publicAssetsRoot, outputRoot };
}

function checkChannelStateUnaffected(momentLabel: string) {
  const scannable = resolveScannableChannels();
  check(`[${momentLabel}] resolveScannableChannels() === ["SIN EXPLICACIÓN"]`, JSON.stringify(scannable) === JSON.stringify(["SIN EXPLICACIÓN"]));
  const config = resolveChannelConfig("ENCIENDE EL CAOS");
  check(`[${momentLabel}] ENCIENDE EL CAOS.channelStatus === "HISTORICAL"`, config?.channelStatus === "HISTORICAL");
  let threw = false;
  let isChannelNotProducible = false;
  try {
    resolveRenderProvider("ENCIENDE EL CAOS");
  } catch (err) {
    threw = true;
    isChannelNotProducible = err instanceof ChannelNotProducibleError;
  }
  check(`[${momentLabel}] resolveRenderProvider("ENCIENDE EL CAOS") sigue rechazando con ChannelNotProducibleError`, threw && isChannelNotProducible);
}

async function main() {
  console.log("=== ESTADO DEL CANAL ANTES ===");
  checkChannelStateUnaffected("antes");

  const syntheticProps = buildSyntheticProps();
  const expectedFrames = chaosMainDurationInFrames(syntheticProps);
  const expectedSeconds = expectedFrames / FPS;
  const fixtureFrames = chaosMainDurationInFrames(chaosMainFixture);
  check("(sanity) los props sintéticos de esta prueba dan una duración DISTINTA a chaosMainFixture (si coincidieran, la prueba no probaría nada)", expectedFrames !== fixtureFrames, `sintético=${expectedFrames}f (${expectedSeconds}s) vs fixture=${fixtureFrames}f`);

  console.log(`\n=== SETUP: sandbox propio + assets sintéticos (_fixture_chaos65) ===`);
  const context = buildSandboxContext();

  try {
    console.log("\n=== RENDER REAL: chaosNewsRemotionProvider.renderMainWithProps() ===");
    // Remotion mezcla --props con defaultProps de forma SUPERFICIAL a nivel
    // de las claves del objeto raíz (no un merge profundo) — Root.tsx registra
    // ChaosNewsMain con `defaultProps={{config: chaosMainFixture}}`, así que el
    // componente espera `props.config`, nunca el ChaosEpisodeConfig "pelado".
    // Pasar el objeto sin envolver (hallazgo real de esta prueba, primera
    // corrida) deja `config` intacto = chaosMainFixture, sin ningún error
    // visible hasta que un asset referenciado por el fixture (no por esta
    // prueba) falta en el sandbox — ver informe de Fase 6.5 §14.
    const result = await chaosNewsRemotionProvider.renderMainWithProps("fase65RealProps", { config: syntheticProps }, context);
    check("renderMainWithProps() — produce un archivo real", existsSync(result.path));
    check('renderMainWithProps() — nombre de archivo distintivo "chaos-news-main-fase65RealProps.mp4"', result.path.endsWith("chaos-news-main-fase65RealProps.mp4"));

    if (existsSync(result.path)) {
      const size = statSync(result.path).size;
      check("output > 100KB (no vacío/corrupto)", size > 100_000, `${size} bytes`);

      const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", result.path], { encoding: "utf-8" });
      const durationSec = probe.status === 0 ? Number(JSON.parse(probe.stdout).format?.duration) : NaN;
      check(
        `duración del render === ${expectedSeconds}s ± 0.3s (derivada de LOS PROPS SINTÉTICOS pasados por --props, prueba de que Remotion los recibió de verdad)`,
        Number.isFinite(durationSec) && Math.abs(durationSec - expectedSeconds) < 0.3,
        `medida=${durationSec}s`
      );
      check(
        "duración del render NO es la del fixture de Root.tsx (12.5s) — si lo fuera, --props se habría ignorado (el bloqueo original de Fase 5)",
        Number.isFinite(durationSec) && Math.abs(durationSec - 12.5) > 1,
        `medida=${durationSec}s`
      );

      const dims = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", result.path], { encoding: "utf-8" });
      const parsedDims = dims.status === 0 ? JSON.parse(dims.stdout).streams?.[0] : null;
      check("dimensiones === 1920x1080 (formato de ChaosNewsMain)", parsedDims?.width === 1920 && parsedDims?.height === 1080, JSON.stringify(parsedDims));

      rmSync(result.path, { force: true });
    }

    console.log("\n=== IDENTIDAD ===");
    check('chaosNewsRemotionProvider.id === "chaos-news-remotion"', chaosNewsRemotionProvider.id === "chaos-news-remotion");
    check("enciendeElCaosTheme.colors.accent === #E5092F (no el rojo de SIN EXPLICACIÓN)", enciendeElCaosTheme.colors.accent === "#E5092F");
  } finally {
    console.log("\n=== LIMPIEZA ===");
    rmSync(path.dirname(context.dataRoot), { recursive: true, force: true });
    console.log("  sandbox y assets sintéticos eliminados.");
  }

  console.log("\n=== ESTADO DEL CANAL DESPUÉS (sin cambios) ===");
  checkChannelStateUnaffected("después");

  console.log(`\n=== ${failures === 0 ? "TODO PASS" : `${failures} FALLO(S)`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Error ejecutando la prueba de props reales de FASE 6.5:", err);
  process.exit(1);
});
