import { AbsoluteFill, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import type { Shot } from "../lib/broll";
import { shotsInRange } from "../lib/broll";
import { colors, timing } from "../theme";

// Brief glitch flash at a scene cut, skipped on the very first shot of a range.
const CutGlitch: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 2, timing.sceneGlitchTransitionFrames], [0.9, 0.25, 0], {
    extrapolateRight: "clamp",
  });
  if (frame >= timing.sceneGlitchTransitionFrames) return null;
  return (
    <AbsoluteFill
      style={{ background: colors.ink, opacity, mixBlendMode: "difference", pointerEvents: "none" }}
    />
  );
};

// Slow zoom/pan on a still image. Variant picks the direction so repeated
// images in the reel don't all move the same way.
const KenBurnsImage: React.FC<{ src: string; variant: number; durationInFrames: number }> = ({
  src,
  variant,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const zoomIn = variant % 2 === 0;
  const scale = interpolate(frame, [0, durationInFrames], zoomIn ? [1, 1.15] : [1.15, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const panX = variant < 2 ? interpolate(frame, [0, durationInFrames], [0, -3]) : 0;
  const panY = variant >= 2 ? interpolate(frame, [0, durationInFrames], [0, 3]) : 0;

  return (
    <Img
      src={src}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: `scale(${scale}) translate(${panX}%, ${panY}%)`,
      }}
    />
  );
};

type Props = {
  shots: Shot[];
  rangeStart: number;
  rangeEnd: number;
  objectPosition?: string;
};

// Renders whichever B-roll shots (video or still) fall inside [rangeStart,
// rangeEnd) of the main timeline. Used by both MainDocumentary (rangeStart=0)
// and every ShortClip so the two never diverge.
export const BrollReel: React.FC<Props> = ({ shots, rangeStart, rangeEnd, objectPosition = "50% 50%" }) => {
  const visible = shotsInRange(shots, rangeStart, rangeEnd);

  return (
    <>
      {visible.map((shot) => {
        const from = Math.max(shot.timelineStart, rangeStart) - rangeStart;
        const durationInFrames = Math.min(shot.timelineEnd, rangeEnd) - Math.max(shot.timelineStart, rangeStart);
        if (durationInFrames <= 0) return null;

        return (
          <Sequence key={shot.key} from={from} durationInFrames={durationInFrames} layout="none">
            <AbsoluteFill>
              {shot.kind === "video" ? (
                <OffthreadVideo
                  src={staticFile(`assets/video/${shot.file}`)}
                  startFrom={shot.sourceStartFrom + (Math.max(shot.timelineStart, rangeStart) - shot.timelineStart)}
                  muted
                  style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition }}
                />
              ) : (
                <KenBurnsImage
                  src={staticFile(`assets/images/${shot.file}`)}
                  variant={shot.kenBurnsVariant}
                  durationInFrames={shot.timelineEnd - shot.timelineStart}
                />
              )}
              {shot.timelineStart > rangeStart && <CutGlitch />}
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </>
  );
};
