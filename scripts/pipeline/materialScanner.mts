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

// FASE 9/10 — tolerancia GENÉRICA y segura de nombre de carpeta: algunos
// episodios reales (ej. ENCIENDE EL CAOS/003, verificado con lectura real)
// organizan el guion dentro de una subcarpeta "Voz y Guion/" en vez de la
// raíz del episodio — mismo archivo real, misma convención de nombre
// (SCRIPT_FILE_RE), solo un nivel más profundo. Se busca ahí SOLO si no se
// encontró nada en la raíz (nunca "además de" — si algún día dos guiones
// coexistieran, la raíz sigue ganando, sin ambigüedad). Nunca afecta a SIN
// EXPLICACIÓN (sus guiones reales están siempre en la raíz, confirmado).
//
// NOTA: se evaluó y se descartó una tolerancia equivalente para
// "Videos_Referencia/" (vista en varios episodios de ENCIENDE EL CAOS/
// OBJETOS MALDITOS) — evidencia real (fuentes-material.md de esos mismos
// episodios) confirma que esa carpeta contiene enlaces/inspiración de tono,
// EXPLÍCITAMENTE "no descargado", nunca b-roll real utilizable. Tratarla
// como equivalente a "Videos/" habría sido un error, no una generalización
// segura — se documenta la decisión, no se implementa.
const SCRIPT_SUBFOLDER = "Voz y Guion";

export const scanEpisode = (account: string, episodeId: string): EpisodeFiles => {
  const folder = path.join(MATERIAL_ROOT, account, episodeId);
  const rootFiles = listFiles(folder);

  const findScript = (files: string[]) => files.find((f) => SCRIPT_FILE_RE.test(path.basename(f)) && path.extname(f) === ".md");
  const scriptFile = findScript(rootFiles) ?? findScript(listFiles(path.join(folder, SCRIPT_SUBFOLDER))) ?? null;
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
