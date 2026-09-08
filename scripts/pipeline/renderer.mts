import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

// En Windows "npx" es en realidad npx.cmd, que solo puede correr a través de
// cmd.exe (shell: true) — un .cmd no es un ejecutable nativo, así que
// invocarlo sin shell falla con EINVAL. Con shell:true, execFileSync NO
// escapa los argumentos por nosotros (ver DEP0190), así que los citamos acá
// a mano — compositionId/outPath son valores propios (episodeId numérico +
// ruta del repo), no input externo, pero igual se cita por si alguna ruta
// llega a tener espacios.
const quoteArg = (arg: string): string => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg);

const renderComposition = (compositionId: string, outRelPath: string): string => {
  const outPath = path.join(REPO_ROOT, outRelPath);
  const args = ["remotion", "render", "remotion/index.ts", compositionId, outPath].map(quoteArg);
  execFileSync("npx", args, {
    stdio: "inherit",
    cwd: REPO_ROOT,
    shell: true,
  });
  return outPath;
};

// Envuelve exactamente lo que hacen scripts/render-main.mjs y
// scripts/render-shorts.mjs, como funciones reutilizables por el pipeline.
export const renderMain = (episodeId: string): string => renderComposition(`MainDocumentary-${episodeId}`, `out/main-${episodeId}.mp4`);

export const renderShort = (episodeId: string, clipIndex: number): string =>
  renderComposition(`Short-${episodeId}-${clipIndex}`, `out/Short-${episodeId}-${clipIndex}.mp4`);
