import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  ACCOUNTS,
  AUDIO_EXT,
  EPISODE_FOLDER_RE,
  IMAGE_EXT,
  MATERIAL_ROOT,
  NARRATION_FILE_RE,
  OUTPUT_FOLDER_NAMES,
  SCRIPT_FILE_RE,
  VIDEO_EXT,
} from "./config.mts";
import type { EpisodeFiles } from "./types.mts";

const listDirs = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
};

const listFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
};

export const listAccounts = (): string[] =>
  listDirs(MATERIAL_ROOT).filter((name) => (ACCOUNTS as readonly string[]).includes(name));

export const listEpisodeFolders = (account: string): string[] =>
  listDirs(path.join(MATERIAL_ROOT, account))
    .filter((name) => EPISODE_FOLDER_RE.test(name) && !OUTPUT_FOLDER_NAMES.includes(name));

const byExt = (files: string[], allowed: Set<string>) =>
  files.filter((f) => allowed.has(path.extname(f).toLowerCase()));

export const scanEpisode = (account: string, episodeId: string): EpisodeFiles => {
  const folder = path.join(MATERIAL_ROOT, account, episodeId);
  const rootFiles = listFiles(folder);

  const scriptFile = rootFiles.find((f) => SCRIPT_FILE_RE.test(path.basename(f)) && path.extname(f) === ".md") ?? null;
  const narrationFile =
    rootFiles.find((f) => NARRATION_FILE_RE.test(path.basename(f)) && AUDIO_EXT.has(path.extname(f).toLowerCase())) ??
    null;

  const videoFiles = byExt(listFiles(path.join(folder, "Videos")), VIDEO_EXT);
  const imageFiles = byExt(listFiles(path.join(folder, "Imagenes")), IMAGE_EXT);
  const soundFiles = byExt(listFiles(path.join(folder, "Sonidos")), AUDIO_EXT);

  return { account, episodeId, folder, scriptFile, narrationFile, videoFiles, imageFiles, soundFiles };
};

export const scanAllEpisodes = (): EpisodeFiles[] =>
  listAccounts().flatMap((account) => listEpisodeFolders(account).map((id) => scanEpisode(account, id)));

// Todas las rutas de material de un episodio en una sola lista plana — un
// único punto para "cuáles son los archivos de este proyecto", reusado tanto
// para detección/hash (agent.mts) como para el gate de autorización
// (authorization.mts) y el guard de processProject() (processOne.mts).
export const allMaterialFiles = (ep: EpisodeFiles): string[] =>
  [ep.scriptFile, ep.narrationFile, ...ep.videoFiles, ...ep.imageFiles, ...ep.soundFiles].filter(
    (f): f is string => Boolean(f)
  );

// Un archivo se considera "asentado" (no se sigue copiando) si su tamaño no
// cambia entre dos lecturas separadas por stabilityMs.
export const isFileStable = async (filePath: string, stabilityMs: number): Promise<boolean> => {
  const sizeA = statSync(filePath).size;
  await new Promise((r) => setTimeout(r, stabilityMs));
  try {
    const sizeB = statSync(filePath).size;
    return sizeA === sizeB;
  } catch {
    return false; // el archivo desapareció entre medias
  }
};
