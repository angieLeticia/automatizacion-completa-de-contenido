import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { FilmEffects } from "./components/FilmEffects";
import { InteractiveText } from "./components/InteractiveText";
import { Watermark } from "./components/Watermark";
import { colors } from "./theme";
import { introCues, introDurationInFrames, revealCue } from "./lib/introTimeline";

const BG_VIDEO_VOLUME = 0.15;
const EDGE_FADE_FRAMES = 12;

// Fades the whole frame from/to black at the very start/end of the intro.
const EdgeFade: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, EDGE_FADE_FRAMES, introDurationInFrames - EDGE_FADE_FRAMES, introDurationInFrames],
    [1, 0, 0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return <AbsoluteFill style={{ background: "black", opacity, pointerEvents: "none" }} />;
};

// "Sin Explicación" intro: muted-down b-roll under narration, narration is
// the protagonist. Each beat = one voice line + a silence, background video
// cuts on the beat so the visual rhythm matches the suspense pacing.
export const Intro: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      {introCues.map((cue, i) => (
        <Sequence key={`video-${i}`} from={cue.videoStart} durationInFrames={cue.videoDurationFrames} layout="none">
          <OffthreadVideo
            src={staticFile(`assets/video/intro/${cue.videoFile}`)}
            volume={BG_VIDEO_VOLUME}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </Sequence>
      ))}

      <FilmEffects />

      {introCues.map((cue, i) => (
        <Sequence key={`voice-${i}`} from={cue.voiceStart} durationInFrames={cue.voiceDurationFrames} layout="none">
          <Audio src={staticFile(`assets/audio/intro/${cue.voiceFile}`)} />
        </Sequence>
      ))}

      <Sequence from={revealCue.voiceStart} durationInFrames={revealCue.videoDurationFrames} layout="none">
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <InteractiveText text="Sin Explicación" type="reveal" fontSize={120} />
        </AbsoluteFill>
      </Sequence>

      <Watermark size={100} />

      <EdgeFade />
    </AbsoluteFill>
  );
};

export { introDurationInFrames };
