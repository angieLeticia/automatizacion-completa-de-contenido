import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { MATERIAL_ROOT } from "./config.mts";

const ensureDir = (dir: string) => mkdirSync(dir, { recursive: true });

// Copia el .mp4 final a Material Videos\{cuenta}\Videos YouTube Completos\ o
// \Clips\ — el destino que pidió la usuaria, separado de la carpeta de
// entrada del episodio (nunca se vuelve a escanear como material nuevo,
// ver config.OUTPUT_FOLDER_NAMES). El nombre lidera con el número de carpeta
// del episodio (ej. "008") — así el archivo final se identifica igual que
// su carpeta de origen, sin depender de un título largo/truncado.
export const exportMainVideo = (account: string, episodeId: string, _title: string, renderedPath: string): string => {
  const dir = path.join(MATERIAL_ROOT, account, "Videos YouTube Completos");
  ensureDir(dir);
  const dest = path.join(dir, `${episodeId} - Video Completo.mp4`);
  copyFileSync(renderedPath, dest);
  return dest;
};

// `label` distingue el origen del clip en el nombre del archivo: "Clip" para
// los mejores momentos elegidos editorialmente, "Parte" para el corte
// secuencial de cobertura completa (ver clipSelector.mts).
export const exportClip = (
  account: string,
  episodeId: string,
  _title: string,
  index: number,
  renderedPath: string,
  label: string = "Clip"
): string => {
  const dir = path.join(MATERIAL_ROOT, account, "Clips");
  ensureDir(dir);
  const dest = path.join(dir, `${episodeId} - ${label} ${index + 1}.mp4`);
  copyFileSync(renderedPath, dest);
  return dest;
};
