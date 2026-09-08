import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { FilmEffects } from "./components/FilmEffects";
import { InteractiveText } from "./components/InteractiveText";
import { Watermark } from "./components/Watermark";
import { colors, fonts, FPS } from "./theme";
import type { ChapterMark } from "./lib/chapters";

const LEAD_IN_FRAMES = Math.round(0.3 * FPS);
const TAIL_FRAMES = Math.round(0.5 * FPS);
const EDGE_FADE_FRAMES = 12;

export const chapterCardDurationInFrames = (chapter: ChapterMark) =>
  LEAD_IN_FRAMES + Math.round(chapter.audioDurationSeconds * FPS) + TAIL_FRAMES;

const EdgeFade: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, EDGE_FADE_FRAMES, durationInFrames - EDGE_FADE_FRAMES, durationInFrames],
    [1, 0, 0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return <AbsoluteFill style={{ background: "black", opacity, pointerEvents: "none" }} />;
};

const FadeIn: React.FC<{ startFrame: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  startFrame,
  children,
  style,
}) => {
  const frame = useCurrentFrame();
  const local = frame - startFrame;
  if (local < 0) return null;
  const opacity = interpolate(local, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <div style={{ ...style, opacity }}>{children}</div>;
};

// Interstitial between the Intro and each episode's MainDocumentary: kicker
// ("Capítulo N"), the chapter title (reusing the same glitch reveal as the
// Intro's payoff so every piece feels like one visual system), and the year
// — timed to that chapter's own narrated audio pauses (see data/chapters.json).
export const ChapterCard: React.FC<ChapterMark> = ({
  number,
  title,
  year,
  audioFile,
  audioDurationSeconds,
  titleRevealSeconds,
  yearRevealSeconds,
}) => {
  const audioDurationFrames = Math.round(audioDurationSeconds * FPS);
  const durationInFrames = LEAD_IN_FRAMES + audioDurationFrames + TAIL_FRAMES;
  const titleRevealFrames = Math.round(titleRevealSeconds * FPS);
  const yearRevealFrames = Math.round(yearRevealSeconds * FPS);

  return (
    <AbsoluteFill
      style={{ backgroundColor: colors.background, justifyContent: "center", alignItems: "center", gap: 28 }}
    >
      <FilmEffects />

      <FadeIn
        startFrame={LEAD_IN_FRAMES}
        style={{
          fontFamily: fonts.caption,
          fontSize: 34,
          letterSpacing: 10,
          color: colors.accent,
          textTransform: "uppercase",
        }}
      >
        {`Capítulo ${number}`}
      </FadeIn>

      <InteractiveText text={title} type="reveal" startFrame={LEAD_IN_FRAMES + titleRevealFrames} fontSize={92} />

      <FadeIn
        startFrame={LEAD_IN_FRAMES + yearRevealFrames}
        style={{ fontFamily: fonts.caption, fontSize: 30, letterSpacing: 6, color: colors.inkDim }}
      >
        {year}
      </FadeIn>

      <Sequence from={LEAD_IN_FRAMES} durationInFrames={audioDurationFrames} layout="none">
        <Audio src={staticFile(`assets/audio/${audioFile}`)} />
      </Sequence>

      <Watermark size={110} />
      <EdgeFade durationInFrames={durationInFrames} />
    </AbsoluteFill>
  );
};
