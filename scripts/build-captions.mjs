import { readFileSync, writeFileSync } from "node:fs";

// Converts a raw Whisper transcription (segments with real start/end
// timestamps from that episode's narration file) into
// remotion/data/captions-{episodeId}.json. Run once after whisper finishes;
// re-run if the narration audio changes.
const [whisperJsonPath, episodeId] = process.argv.slice(2);
if (!whisperJsonPath || !episodeId) {
  console.error("Usage: node scripts/build-captions.mjs <path-to-whisper-output.json> <episodeId>");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(whisperJsonPath, "utf-8"));

const captions = raw.segments.map((seg) => ({
  start: Number(seg.start.toFixed(2)),
  end: Number(seg.end.toFixed(2)),
  text: seg.text.trim(),
  type: "normal",
}));

const outPath = new URL(`../remotion/data/captions-${episodeId}.json`, import.meta.url);
writeFileSync(outPath, JSON.stringify(captions, null, 2) + "\n");
console.log(`Wrote ${captions.length} captions to ${outPath.pathname}`);
