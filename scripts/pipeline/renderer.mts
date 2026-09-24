import { execFileSync } from "node:child_process";
import path from "node:path";
import type { PipelineExecutionContext } from "./pipelineExecutionContext.mts";
import { writePropsTempFile } from "./renderProps.mts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

// En Windows "npx" es en realidad npx.cmd, que solo puede correr a través de
// cmd.exe (shell: true) — un .cmd no es un ejecutable nativo, así que
// invocarlo sin shell falla con EINVAL. Con shell:true, execFileSync NO
// escapa los argumentos por nosotros (ver DEP0190), así que los citamos acá
// a mano — compositionId/outPath son valores propios (episodeId numérico +
// ruta del repo), no input externo, pero igual se cita por si alguna ruta
// llega a tener espacios.
const quoteArg = (arg: string): string => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg);

// `timeoutMs` es opcional y no lo usa ningún llamador existente (renderMain/
// renderShort no lo pasan, así que su comportamiento no cambia) — se agrega
// en Fase 4.5 únicamente para que agent/machine/renderBridge.mts pueda acotar
// la espera sin duplicar esta invocación de `npx remotion render`.
//
// Fase 1.5.3 — `context` opcional: SIN él (producción real, comportamiento
// EXACTO de siempre), `outPath` sigue siendo `REPO_ROOT/outRelPath` y no se
// agrega ninguna variable de entorno al hijo. CON contexto, (a) el output se
// resuelve contra `context.outputRoot` en vez de `REPO_ROOT`, y (b) se agregan
// SOLO DOS variables de entorno — REMOTION_TEST_EPISODES_CATALOG y
// REMOTION_TEST_PUBLIC_DIR — al proceso hijo de `npx remotion render`; esas
// variables las lee `remotion.config.ts` (Bloque F) para decidir si aplica un
// alias de webpack/publicDir alternativo — el comando de Remotion en sí
// (`remotion/index.ts`, compositionId, argumentos) NO cambia en absoluto.
// Fase 6.5 — `props` opcional: SIN él (TODOS los callers existentes hoy —
// documentaryRemotionProvider/quoteVideoProvider/chaosNewsRemotionProvider.
// renderMain/renderClip), comportamiento histórico EXACTO — nunca se agrega
// "--props" al comando ni se crea ningún archivo temporal. CON él, se
// serializa a un archivo JSON temporal (nunca interpolado directo en el
// comando — ver renderProps.mts) y se pasa como "--props=<archivo>", el
// mecanismo NATIVO de Remotion (el mismo que Root.tsx ya usa vía
// defaultProps, ahora inyectable por llamada real). El archivo temporal se
// limpia SIEMPRE — éxito o error — en el finally de abajo, para no repetir
// el bug de limpieza real encontrado en Fase 6 (ahí el problema fue un
// try/finally FALTANTE alrededor de todo el flujo, no de esta función).
export const renderComposition = (
  compositionId: string,
  outRelPath: string,
  opts?: { timeoutMs?: number; context?: PipelineExecutionContext; props?: unknown }
): string => {
  const outRoot = opts?.context?.outputRoot ?? REPO_ROOT;
  const outPath = path.join(outRoot, outRelPath);
  const propsFile = opts?.props !== undefined ? writePropsTempFile(opts.props) : null;
  try {
    const argsRaw = ["remotion", "render", "remotion/index.ts", compositionId, outPath];
    if (propsFile) argsRaw.push(`--props=${propsFile.propsFilePath}`);
    const args = argsRaw.map(quoteArg);
    // Fase 1.5.5 — corrección real encontrada por la prueba E2E (404 sirviendo
    // assets): Config.setPublicDir() espera el equivalente a "public/" (el
    // PADRE de "assets/"), porque staticFile("assets/video/...") siempre se
    // resuelve como <publicDir>/assets/video/... — igual que en producción real
    // (publicDir real = REPO_ROOT/public, un nivel arriba de
    // REPO_ROOT/public/assets = PUBLIC_VIDEO/IMAGES/AUDIO). Por eso se pasa el
    // PADRE de context.publicAssetsRoot, no el valor tal cual.
    const extraEnv = opts?.context
      ? {
          REMOTION_TEST_EPISODES_CATALOG: opts.context.episodesFile,
          REMOTION_TEST_PUBLIC_DIR: path.dirname(opts.context.publicAssetsRoot),
        }
      : {};
    execFileSync("npx", args, {
      stdio: "inherit",
      cwd: REPO_ROOT,
      shell: true,
      env: { ...process.env, ...extraEnv },
      ...(opts?.timeoutMs ? { timeout: opts.timeoutMs } : {}),
    });
    return outPath;
  } finally {
    propsFile?.cleanup();
  }
};

// Envuelve exactamente lo que hacen scripts/render-main.mjs y
// scripts/render-shorts.mjs, como funciones reutilizables por el pipeline.
export const renderMain = (episodeId: string): string => renderComposition(`MainDocumentary-${episodeId}`, `out/main-${episodeId}.mp4`);

export const renderShort = (episodeId: string, clipIndex: number): string =>
  renderComposition(`Short-${episodeId}-${clipIndex}`, `out/Short-${episodeId}-${clipIndex}.mp4`);
