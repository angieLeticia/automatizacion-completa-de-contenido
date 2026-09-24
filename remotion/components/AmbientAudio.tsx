import { Audio, Sequence, staticFile } from "remotion";
import { buildMusicBed, blocksInRange, sinExplicacionAmbientAudioConfig, type AmbientAudioConfig } from "../lib/musicBed";
import { fadeEnvelope } from "../lib/envelope";
import { FPS } from "../theme";
import type { Shot } from "../lib/broll";
import { shotsInRange } from "../lib/broll";

type Props = {
  totalFrames: number;
  shots: Shot[];
  rangeStart: number;
  rangeEnd: number;
  // FASE 5.10-AN (Fase 1 — generalización de audio) — `config` es OPCIONAL,
  // por defecto exactamente `sinExplicacionAmbientAudioConfig` (los mismos
  // tracks/volúmenes/timing que este componente ya usaba antes de esta
  // fase, hardcodeados). MainDocumentary/ShortClip (SIN EXPLICACIÓN) NUNCA
  // pasan este prop, así que su comportamiento no cambia ni un frame. Un
  // canal nuevo (ej. ENCIENDE EL CAOS) construye su propio
  // `AmbientAudioConfig` (ver lib/musicBed.ts) y lo pasa aquí — sin ningún
  // `if`/`else` por nombre de canal dentro de este componente.
  config?: AmbientAudioConfig;
};

const DEFAULT_MUSIC_PEAK = 0.14;
const DEFAULT_MUSIC_FADE_FRAMES = 60;
const DEFAULT_TEXTURE_PEAK = 0.22;
const DEFAULT_TEXTURE_SECONDS = 1.8;
const DEFAULT_TEXTURE_FADE_FRAMES = 24;

// Continuous score bed (rotates the channel's music tracks) + a short
// atmosphere texture stinger on every scene cut (rotates the channel's
// texture tracks). Both come from `config` (default: SIN EXPLICACIÓN's real
// config, unchanged) — nunca hardcodeados dentro de este componente.
export const AmbientAudio: React.FC<Props> = ({ totalFrames, shots, rangeStart, rangeEnd, config = sinExplicacionAmbientAudioConfig }) => {
  const musicBlocks = blocksInRange(buildMusicBed(totalFrames, config), rangeStart, rangeEnd);
  const cuts = shotsInRange(shots, rangeStart, rangeEnd);

  const musicPeak = config.music?.peak ?? DEFAULT_MUSIC_PEAK;
  const musicFadeFrames = config.music?.fadeFrames ?? DEFAULT_MUSIC_FADE_FRAMES;
  const texturePeak = config.texture?.peak ?? DEFAULT_TEXTURE_PEAK;
  const textureSeconds = config.texture?.seconds ?? DEFAULT_TEXTURE_SECONDS;
  const textureFadeFrames = config.texture?.fadeFrames ?? DEFAULT_TEXTURE_FADE_FRAMES;
  const textureTracks = config.textureTracks;

  return (
    <>
      {musicBlocks.map((block) => {
        const from = Math.max(block.timelineStart, rangeStart) - rangeStart;
        const durationInFrames = Math.min(block.timelineEnd, rangeEnd) - Math.max(block.timelineStart, rangeStart);
        if (durationInFrames <= 0) return null;
        return (
          <Sequence key={block.key} from={from} durationInFrames={durationInFrames} layout="none">
            <Audio
              src={staticFile(`assets/audio/sfx/${block.file}`)}
              volume={(f) => fadeEnvelope(f, durationInFrames, musicFadeFrames, musicPeak)}
            />
          </Sequence>
        );
      })}

      {textureTracks.length > 0 &&
        cuts.map((shot, i) => {
          const from = Math.max(shot.timelineStart, rangeStart) - rangeStart;
          const durationInFrames = Math.min(Math.round(textureSeconds * FPS), rangeEnd - Math.max(shot.timelineStart, rangeStart));
          if (durationInFrames <= 0) return null;
          const file = textureTracks[i % textureTracks.length];
          return (
            <Sequence key={`${shot.key}-texture`} from={from} durationInFrames={durationInFrames} layout="none">
              <Audio
                src={staticFile(`assets/audio/sfx/${file}`)}
                volume={(f) => fadeEnvelope(f, durationInFrames, textureFadeFrames, texturePeak)}
              />
            </Sequence>
          );
        })}
    </>
  );
};
