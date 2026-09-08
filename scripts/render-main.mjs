import { execFileSync } from "node:child_process";

const episodeId = process.argv[2];
if (!episodeId) {
  console.error("Usage: node scripts/render-main.mjs <episodeId>  (e.g. 002)");
  process.exit(1);
}

const id = `MainDocumentary-${episodeId}`;
const out = `out/main-${episodeId}.mp4`;
console.log(`Rendering ${id} -> ${out}`);
execFileSync("npx", ["remotion", "render", "remotion/index.ts", id, out], { stdio: "inherit", shell: true });
