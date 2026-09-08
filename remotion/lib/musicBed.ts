import { FPS } from "../theme";

// The 3 score-style tracks rotate as a continuous low-volume bed under the
// whole documentary. The other 8 sfx files are short atmosphere/foley
// textures used as stingers on scene cuts (see components/AmbientAudio.tsx).
export const musicTracks = ["Musica cinematica.mp3", "Musica de tension.mp3", "Musica misteriosa.mp3"];

export const textureTracks = [
  "viento.wav",
  "Olas de mar.wav",
  "Pasando hojas.wav",
  "Piso de madera.wav",
  "Madera crujiendo.wav",
  "Reloj.wav",
  "Trenos.wav",
  "mixkit-wind-blowing-ambience-2658.wav",
];

export type MusicBlock = {
  key: string;
  file: string;
  timelineStart: number;
  timelineEnd: number;
};

const BLOCK_SECONDS = 100;

export const buildMusicBed = (totalFrames: number): MusicBlock[] => {
  const blocks: MusicBlock[] = [];
  const blockFrames = BLOCK_SECONDS * FPS;
  let t = 0;
  let i = 0;
  while (t < totalFrames) {
    const len = Math.min(blockFrames, totalFrames - t);
    const file = musicTracks[i % musicTracks.length];
    blocks.push({ key: `${file}-${t}`, file, timelineStart: t, timelineEnd: t + len });
    t += len;
    i += 1;
  }
  return blocks;
};

export const blocksInRange = (blocks: MusicBlock[], startFrame: number, endFrame: number): MusicBlock[] =>
  blocks.filter((b) => b.timelineEnd > startFrame && b.timelineStart < endFrame);
