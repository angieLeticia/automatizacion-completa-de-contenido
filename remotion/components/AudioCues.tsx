import { Audio, Sequence, staticFile } from "remotion";
import { captionsInRange, secToFrames } from "../lib/captions";
import { fadeEnvelope } from "../lib/envelope";
import type { Caption } from "../lib/captions";

type Props = {
  captions: Caption[];
  rangeStart: number;
  rangeEnd: number;
};

// Plays whichever sfx cues were manually attached to captions.json entries
// (caption.sfx) that fall inside [rangeStart, rangeEnd), with a fade in/out
// volume curve. No cue plays unless the user assigned one on that caption.
export const AudioCues: React.FC<Props> = ({ captions, rangeStart, rangeEnd }) => {
  const active = captionsInRange(captions, rangeStart, rangeEnd).filter((c) => c.sfx);

  return (
    <>
      {active.map((caption) => {
        const cue = caption.sfx!;
        const cStart = secToFrames(caption.start);
        const cEnd = secToFrames(caption.end);
        const from = Math.max(cStart, rangeStart) - rangeStart;
        const durationInFrames = Math.min(cEnd, rangeEnd) - Math.max(cStart, rangeStart);
        if (durationInFrames <= 0) return null;

        const peak = cue.volume ?? 0.6;
        const fadeIn = cue.fadeInFrames ?? 10;
        const fadeOut = cue.fadeOutFrames ?? 20;

        return (
          <Sequence key={`${cStart}-${cue.file}`} from={from} durationInFrames={durationInFrames} layout="none">
            <Audio
              src={staticFile(`assets/audio/sfx/${cue.file}`)}
              volume={(f) => fadeEnvelope(f, durationInFrames, Math.max(fadeIn, fadeOut), peak)}
            />
          </Sequence>
        );
      })}
    </>
  );
};
