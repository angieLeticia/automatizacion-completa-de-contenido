import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Caption } from "../../remotion/lib/captions.ts";
import type { ReelOptions, Shot } from "../../remotion/lib/broll.ts";
import type { PoolItem } from "./visualAssigner.mts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const EPISODES_TS = path.join(REPO_ROOT, "remotion", "lib", "episodes.ts");
const DATA_DIR = path.join(REPO_ROOT, "remotion", "data");
const PUBLIC_VIDEO = path.join(REPO_ROOT, "public", "assets", "video");
const PUBLIC_IMAGES = path.join(REPO_ROOT, "public", "assets", "images");
const PUBLIC_AUDIO = path.join(REPO_ROOT, "public", "assets", "audio");

const ensureDir = (dir: string) => mkdirSync(dir, { recursive: true });

// Copia el material elegido a public/assets/{video,images}/{id}/ y la
// narración a public/assets/audio/narracion-{id}.mp3, siguiendo exactamente
// la convención que ya usan los episodios existentes (ver episodes.ts).
export const copyEpisodeAssets = (
  episodeId: string,
  videoFiles: string[],
  imageFiles: string[],
  narrationFile: string
): { narrationRelPath: string } => {
  const videoDir = path.join(PUBLIC_VIDEO, episodeId);
  const imageDir = path.join(PUBLIC_IMAGES, episodeId);
  ensureDir(videoDir);
  ensureDir(imageDir);
  ensureDir(PUBLIC_AUDIO);

  for (const v of videoFiles) copyFileSync(v, path.join(videoDir, path.basename(v)));
  for (const im of imageFiles) copyFileSync(im, path.join(imageDir, path.basename(im)));

  const narrationRelPath = `narracion-${episodeId}.mp3`;
  copyFileSync(narrationFile, path.join(PUBLIC_AUDIO, narrationRelPath));

  return { narrationRelPath };
};

export const writeCaptions = (episodeId: string, captions: Caption[]) => {
  ensureDir(DATA_DIR);
  writeFileSync(path.join(DATA_DIR, `captions-${episodeId}.json`), JSON.stringify(captions, null, 2) + "\n");
};

// clips-{id}.json debe existir (aunque vacío) antes del primer render del
// video largo, porque episodes.ts lo importa estáticamente como JSON.
export const ensureEmptyClips = (episodeId: string) => {
  const p = path.join(DATA_DIR, `clips-${episodeId}.json`);
  if (!existsSync(p)) writeFileSync(p, "[]\n");
};

export const writeClips = (episodeId: string, clips: unknown[]) => {
  writeFileSync(path.join(DATA_DIR, `clips-${episodeId}.json`), JSON.stringify(clips, null, 2) + "\n");
};

export const writeShots = (episodeId: string, shots: Shot[]) => {
  ensureDir(DATA_DIR);
  writeFileSync(path.join(DATA_DIR, `shots-${episodeId}.json`), JSON.stringify(shots, null, 2) + "\n");
};

const IMPORT_ANCHOR_RE = /(import rawClips\d+ from "\.\.\/data\/clips-\d+\.json";\r?\n)(?!import rawClips)/;
const EXPORT_LINE_RE = /export const episodes: EpisodeConfig\[\] = \[([^\]]*)\];/;

// Inserta (o actualiza, si ya existe) una entrada en remotion/lib/episodes.ts
// por texto, anclado a los mismos patrones que ya usan los episodios
// existentes — no reescribe el archivo completo, para no arriesgar el resto
// de entradas manuales. Actualizar es necesario cuando llega material nuevo
// (ej. imágenes) para un episodio que ya se había registrado antes.
export const registerEpisode = (params: {
  episodeId: string;
  chapterNumber: number;
  narrationRelPath: string;
  narrationDurationSeconds: number;
  videoPool: PoolItem[];
  imagePool: PoolItem[];
  reelOptions?: ReelOptions;
  hasShots?: boolean; // true si ya se corrió writeShots() para este episodio
  episodesFile?: string; // solo para pruebas — por defecto, el episodes.ts real
}): "inserted" | "updated" => {
  const {
    episodeId,
    chapterNumber,
    narrationRelPath,
    narrationDurationSeconds,
    videoPool,
    imagePool,
    reelOptions,
    hasShots = false,
    episodesFile = EPISODES_TS,
  } = params;

  let src = readFileSync(episodesFile, "utf-8");
  const alreadyRegistered = src.includes(`id: "${episodeId}"`);

  const importBlock =
    (src.includes(`rawCaptions${episodeId} from`) ? "" : `import rawCaptions${episodeId} from "../data/captions-${episodeId}.json";\n`) +
    (src.includes(`rawClips${episodeId} from`) ? "" : `import rawClips${episodeId} from "../data/clips-${episodeId}.json";\n`) +
    (hasShots && !src.includes(`rawShots${episodeId} from`)
      ? `import rawShots${episodeId} from "../data/shots-${episodeId}.json";\n`
      : "");

  if (importBlock) {
    if (!IMPORT_ANCHOR_RE.test(src)) {
      throw new Error("No se encontró el ancla de imports en episodes.ts — revisar el archivo a mano.");
    }
    src = src.replace(IMPORT_ANCHOR_RE, `$1${importBlock}`);
  }

  const poolEntry = (item: PoolItem) =>
    item.kind === "video"
      ? `    { kind: "video", file: "${item.file}", durationSec: ${item.durationSec.toFixed(2)}, width: ${item.width}, height: ${item.height} },`
      : `    { kind: "image", file: "${item.file}", width: ${item.width}, height: ${item.height} },`;

  const reelOptionsEntries = reelOptions
    ? Object.entries(reelOptions)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")
    : "";
  const reelOptionsLine = reelOptions ? `\n  reelOptions: { ${reelOptionsEntries} },` : "";

  const poolBlock = (items: PoolItem[]) => (items.length === 0 ? "" : `\n${items.map(poolEntry).join("\n")}\n  `);
  const shotsLine = hasShots ? `\n  shots: rawShots${episodeId} as Shot[],` : "";

  // Al actualizar un episodio ya registrado, el chapterNumber se conserva del
  // bloque existente en vez de usar el que calculó el llamador (que asume que
  // es un episodio nuevo) — si no, cada actualización lo correría de más.
  let effectiveChapterNumber = chapterNumber;
  if (alreadyRegistered) {
    const existingMatch = src.match(new RegExp(`const episode${episodeId}: EpisodeConfig = \\{[\\s\\S]*?chapterNumber: (\\d+),`));
    if (existingMatch) effectiveChapterNumber = Number(existingMatch[1]);
  }

  const episodeBlock = `
const episode${episodeId}: EpisodeConfig = {
  id: "${episodeId}",
  chapterNumber: ${effectiveChapterNumber},
  narrationFile: "${narrationRelPath}",
  narrationDurationSeconds: ${narrationDurationSeconds},
  captions: normalizeCaptions(rawCaptions${episodeId} as Caption[]),
  clips: rawClips${episodeId} as ClipMark[],
  videoPool: [${poolBlock(videoPool)}],
  imagePool: [${poolBlock(imagePool)}],${reelOptionsLine}${shotsLine}
};
`;

  if (alreadyRegistered) {
    // Reemplaza el bloque `const episodeXXX: EpisodeConfig = { ... };` existente
    // completo — el cierre `};` al inicio de línea solo aparece ahí (los arrays
    // internos cierran con `],`), así que el match no ambigua con nada más.
    const blockRe = new RegExp(`const episode${episodeId}: EpisodeConfig = \\{[\\s\\S]*?\\r?\\n\\};\\r?\\n`);
    if (!blockRe.test(src)) {
      throw new Error(
        `episodes.ts tiene "id: \\"${episodeId}\\"" pero no se encontró el bloque \`const episode${episodeId}\` para reemplazarlo — revisar el archivo a mano.`
      );
    }
    src = src.replace(blockRe, `${episodeBlock.trimStart()}\n`);
    writeFileSync(episodesFile, src);
    return "updated";
  }

  if (!EXPORT_LINE_RE.test(src)) {
    throw new Error("No se encontró `export const episodes = [...]` en episodes.ts — revisar el archivo a mano.");
  }
  src = src.replace(EXPORT_LINE_RE, (_m, inner: string) => {
    const trimmed = inner.trim();
    const newInner = trimmed ? `${trimmed}, episode${episodeId}` : `episode${episodeId}`;
    return `${episodeBlock}\nexport const episodes: EpisodeConfig[] = [${newInner}];`;
  });

  writeFileSync(episodesFile, src);
  return "inserted";
};
