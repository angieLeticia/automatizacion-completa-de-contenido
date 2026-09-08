import { Audio, Sequence, staticFile } from "remotion";
import { buildMusicBed, blocksInRange, textureTracks } from "../lib/musicBed";
import { fadeEnvelope } from "../lib/envelope";
import { FPS } from "../theme";
import type { Shot } from "../lib/broll";
import { shotsInRange } from "../lib/broll";

type Props = {
  totalFrames: number;
  shots: Shot[];
  rangeStart: number;
  rangeEnd: number;
};

const MUSIC_PEAK = 0.14;
const MUSIC_FADE_FRAMES = 60;
const TEXTURE_PEAK = 0.22;
const TEXTURE_SECONDS = 1.8;

// Continuous score bed (rotates the 3 "Musica" tracks) + a short atmosphere
// texture stinger on every scene cut (rotates the other 8 sfx files). Both
// use every file you gave us; volumes stay low so they sit under narration.
export const AmbientAudio: React.FC<Props> = ({ totalFrames, shots, rangeStart, rangeEnd }) => {
  const musicBlocks = blocksInRange(buildMusicBed(totalFrames), rangeStart, rangeEnd);
  const cuts = shotsInRange(shots, rangeStart, rangeEnd);

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
              volume={(f) => fadeEnvelope(f, durationInFrames, MUSIC_FADE_FRAMES, MUSIC_PEAK)}
            />
          </Sequence>
        );
      })}

      {cuts.map((shot, i) => {
        const from = Math.max(shot.timelineStart, rangeStart) - rangeStart;
        const durationInFrames = Math.min(Math.round(TEXTURE_SECONDS * FPS), rangeEnd - Math.max(shot.timelineStart, rangeStart));
        if (durationInFrames <= 0) return null;
        const file = textureTracks[i % textureTracks.length];
        return (
          <Sequence key={`${shot.key}-texture`} from={from} durationInFrames={durationInFrames} layout="none">
            <Audio
              src={staticFile(`assets/audio/sfx/${file}`)}
              volume={(f) => fadeEnvelope(f, durationInFrames, 24, TEXTURE_PEAK)}
            />
          </Sequence>
        );
      })}
    </>
  );
};
