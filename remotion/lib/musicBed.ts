import { FPS } from "../theme";

// FASE 5.10-AN (Fase 1 — generalización de audio) — antes, `musicTracks`/
// `textureTracks` eran arrays fijos a nivel de módulo, hardcodeados a los
// archivos reales de SIN EXPLICACIÓN, y `buildMusicBed()` los usaba
// directamente sin ningún parámetro — imposible de reutilizar para otro
// canal sin editar este archivo compartido (lo que habría afectado a SIN
// EXPLICACIÓN). Ahora es un CONTRATO (`AmbientAudioConfig`) + una
// configuración concreta (`sinExplicacionAmbientAudioConfig`) que preserva
// los mismos archivos/timing/comportamiento de siempre. Cero `if`/`else`
// por nombre de canal en ningún lado — cada canal simplemente construye su
// propio `AmbientAudioConfig` y lo pasa como dato (ver
// components/AmbientAudio.tsx).
export type AmbientAudioConfig = {
  // Los 3 (o los que sean) tracks de música continua que rotan como cama de
  // fondo, relativos a public/assets/audio/sfx/.
  musicTracks: string[];
  // Los stingers de atmósfera/foley cortos que suenan en cada corte de
  // escena, relativos a public/assets/audio/sfx/.
  textureTracks: string[];
  // Segundos que dura cada bloque de música antes de rotar al siguiente
  // track. Default: 100 (mismo valor que SIN EXPLICACIÓN siempre usó).
  blockSeconds?: number;
  music?: {
    peak?: number; // volumen pico 0-1. Default: 0.14
    fadeFrames?: number; // frames de fade in/out. Default: 60
  };
  texture?: {
    peak?: number; // volumen pico 0-1. Default: 0.22
    seconds?: number; // duración del stinger en segundos. Default: 1.8
    fadeFrames?: number; // frames de fade in/out. Default: 24
  };
};

// Configuración REAL y completa de SIN EXPLICACIÓN — mismos 3 tracks de
// música y mismos 8 archivos de textura que este archivo tenía hardcodeados
// antes de esta fase, sin ningún cambio de nombre, orden ni valor.
export const sinExplicacionAmbientAudioConfig: AmbientAudioConfig = {
  musicTracks: ["Musica cinematica.mp3", "Musica de tension.mp3", "Musica misteriosa.mp3"],
  textureTracks: [
    "viento.wav",
    "Olas de mar.wav",
    "Pasando hojas.wav",
    "Piso de madera.wav",
    "Madera crujiendo.wav",
    "Reloj.wav",
    "Trenos.wav",
    "mixkit-wind-blowing-ambience-2658.wav",
  ],
};

// Exports históricos, sin cambios de valor — cualquier código que todavía
// importe estos dos nombres directamente sigue viendo exactamente los
// mismos arrays de siempre.
export const musicTracks = sinExplicacionAmbientAudioConfig.musicTracks;
export const textureTracks = sinExplicacionAmbientAudioConfig.textureTracks;

const DEFAULT_BLOCK_SECONDS = 100;

export type MusicBlock = {
  key: string;
  file: string;
  timelineStart: number;
  timelineEnd: number;
};

// `config` es OPCIONAL y por defecto es exactamente la configuración de SIN
// EXPLICACIÓN — sin pasarlo (todos los llamadores reales de hoy),
// buildMusicBed() se comporta byte a byte igual que antes de esta fase.
export const buildMusicBed = (totalFrames: number, config: AmbientAudioConfig = sinExplicacionAmbientAudioConfig): MusicBlock[] => {
  const tracks = config.musicTracks;
  if (tracks.length === 0) return []; // un canal sin tracks de música simplemente no tiene cama de fondo — nunca crashea por división/módulo por cero
  const blocks: MusicBlock[] = [];
  const blockFrames = (config.blockSeconds ?? DEFAULT_BLOCK_SECONDS) * FPS;
  let t = 0;
  let i = 0;
  while (t < totalFrames) {
    const len = Math.min(blockFrames, totalFrames - t);
    const file = tracks[i % tracks.length];
    blocks.push({ key: `${file}-${t}`, file, timelineStart: t, timelineEnd: t + len });
    t += len;
    i += 1;
  }
  return blocks;
};

export const blocksInRange = (blocks: MusicBlock[], startFrame: number, endFrame: number): MusicBlock[] =>
  blocks.filter((b) => b.timelineEnd > startFrame && b.timelineStart < endFrame);
