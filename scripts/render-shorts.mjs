import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const episodeId = process.argv[2];
if (!episodeId) {
  console.error("Usage: node scripts/render-shorts.mjs <episodeId>  (e.g. 002)");
  process.exit(1);
}

const clips = JSON.parse(readFileSync(new URL(`../remotion/data/clips-${episodeId}.json`, import.meta.url)));

if (clips.length === 0) {
  console.log(`remotion/data/clips-${episodeId}.json is empty — mark your clips before rendering shorts.`);
  process.exit(0);
}

clips.forEach((_clip, i) => {
  const id = `Short-${episodeId}-${i}`;
  const out = `out/${id}.mp4`;
  console.log(`Rendering ${id} -> ${out}`);
  execFileSync("npx", ["remotion", "render", "remotion/index.ts", id, out], { stdio: "inherit", shell: true });
});
