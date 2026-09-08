import { buildReel } from "../../remotion/lib/broll.ts";
import type { ReelOptions, Shot, SourceImage, SourceVideo, VisualPool } from "../../remotion/lib/broll.ts";
import { FPS } from "../../remotion/theme.ts";
import type { Caption } from "../../remotion/lib/captions.ts";
import { contentWords } from "./textUtils.mts";

export type PoolItem = (SourceVideo | SourceImage) & { keywords: string[] };

const MATCH_THRESHOLD = 0.2;
const REPEAT_PENALTY = 0.15;

// Reemplaza, tramo por tramo, la rotación por defecto de buildReel() cuando
// el nombre de archivo de algún recurso del pool coincide fuertemente con lo
// que se está narrando en ese momento (ver mediaCatalog.ts para las keywords
// extraídas del nombre). Si no hay match suficientemente fuerte, se deja la
// rotación existente tal cual — nunca se inventa contenido.
export const assignVisuals = (
  captions: Caption[],
  pool: VisualPool,
  totalFrames: number,
  videoItems: PoolItem[],
  imageItems: PoolItem[],
  reelOptions?: ReelOptions
): Shot[] => {
  const baseline = buildReel(pool, totalFrames, reelOptions);
  const allItems = [...videoItems, ...imageItems];
  const usageCount = new Map<string, number>();

  return baseline.map((shot) => {
    const shotStartSec = shot.timelineStart / FPS;
    const shotEndSec = shot.timelineEnd / FPS;
    const words = captions
      .filter((c) => c.end > shotStartSec && c.start < shotEndSec)
      .flatMap((c) => contentWords(c.text));
    if (words.length === 0) return shot;

    const wordSet = new Set(words);
    let best: PoolItem | null = null;
    let bestScore = 0;
    for (const item of allItems) {
      if (item.keywords.length === 0) continue;
      const overlap = item.keywords.filter((k) => wordSet.has(k)).length;
      if (overlap === 0) continue;
      const score = overlap / item.keywords.length - (usageCount.get(item.file) ?? 0) * REPEAT_PENALTY;
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    if (!best || bestScore < MATCH_THRESHOLD) return shot;

    const uses = (usageCount.get(best.file) ?? 0) + 1;
    usageCount.set(best.file, uses);

    if (best.kind === "video") {
      return {
        kind: "video",
        key: `${best.file}-${shot.timelineStart}`,
        file: best.file,
        timelineStart: shot.timelineStart,
        timelineEnd: shot.timelineEnd,
        sourceStartFrom: 0,
      };
    }
    return {
      kind: "image",
      key: `${best.file}-${shot.timelineStart}`,
      file: best.file,
      timelineStart: shot.timelineStart,
      timelineEnd: shot.timelineEnd,
      kenBurnsVariant: (uses - 1) % 4,
    };
  });
};
