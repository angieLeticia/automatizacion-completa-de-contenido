import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { FilmEffects } from "./components/FilmEffects";
import { InteractiveText } from "./components/InteractiveText";
import { VideoWall } from "./components/VideoWall";
import { Watermark } from "./components/Watermark";
import { colors } from "./theme";
import { introCues, introDurationInFrames, revealCue, wallBeats } from "./lib/introTimeline";

const AMBIENT_PEAK_VOLUME = 0.12;
const EDGE_FADE_FRAMES = 12;

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

// Same audio/timing as Intro.tsx (both read from lib/introTimeline) — only
// the video framing changes for the horizontal YouTube cut: instead of one
// clip pillarboxed/blurred, a 3-column wall of simultaneous vertical clips
// fills the full 1920x1080 frame edge to edge.
export const IntroLandscape: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      {introCues.map((cue, i) => (
        <Sequence key={`video-${i}`} from={cue.videoStart} durationInFrames={cue.videoDurationFrames} layout="none">
          <VideoWall files={wallBeats[i].map((file) => staticFile(`assets/video/intro/${file}`))} />
        </Sequence>
      ))}

      <FilmEffects />

      <Audio
        src={staticFile("assets/audio/sfx/Musica de tension.mp3")}
        volume={(f) =>
          interpolate(
            f,
            [0, 45, introDurationInFrames - 45, introDurationInFrames],
            [0, AMBIENT_PEAK_VOLUME, AMBIENT_PEAK_VOLUME, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          )
        }
      />

      {introCues.map((cue, i) => (
        <Sequence key={`voice-${i}`} from={cue.voiceStart} durationInFrames={cue.voiceDurationFrames} layout="none">
          <Audio src={staticFile(`assets/audio/intro/${cue.voiceFile}`)} />
        </Sequence>
      ))}

      <Sequence from={revealCue.voiceStart} durationInFrames={revealCue.videoDurationFrames} layout="none">
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <InteractiveText text="Sin Explicación" type="reveal" fontSize={140} />
        </AbsoluteFill>
      </Sequence>

      <Watermark size={120} />

      <EdgeFade />
    </AbsoluteFill>
  );
};
