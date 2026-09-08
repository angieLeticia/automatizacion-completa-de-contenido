import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { buildReel } from "./lib/broll";
import { getEpisode, mainDurationInFrames } from "./lib/episodes";
import { BrollReel } from "./components/BrollReel";
import { Captions } from "./components/Captions";
import { AudioCues } from "./components/AudioCues";
import { AmbientAudio } from "./components/AmbientAudio";
import { FilmEffects } from "./components/FilmEffects";
import { InteractiveText } from "./components/InteractiveText";
import { colors, timing, FPS } from "./theme";
import type { ClipMark } from "./lib/clips";

const HOOK_FADE_OUT_FRAMES = 15;

// Big, but shorter hooks get to go even bigger — keeps every card feeling
// equally "wow" instead of the longest line setting a small size for all.
const hookFontSize = (text: string) => {
  if (text.length <= 24) return 156;
  if (text.length <= 34) return 130;
  return 110;
};

// Fades the whole title block out gracefully instead of snapping off when its
// Sequence ends, and dims the footage behind it so the title always reads.
const HookCard: React.FC<{ text: string; durationInFrames: number }> = ({ text, durationInFrames }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, durationInFrames - HOOK_FADE_OUT_FRAMES, durationInFrames],
    [1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ opacity, pointerEvents: "none" }}>
      <AbsoluteFill
        style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0) 100%)" }}
      />
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 120 }}>
        <InteractiveText text={text} type="reveal" startFrame={0} fontSize={hookFontSize(text)} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

type Props = ClipMark & { episodeId: string };

export const ShortClip: React.FC<Props> = ({ episodeId, startFrame, endFrame, hookText, objectPosition }) => {
  const episode = getEpisode(episodeId);
  const shots = episode.shots ?? buildReel(episode, mainDurationInFrames(episode), episode.reelOptions);
  const hookFrames = timing.hookHoldSeconds * FPS;

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <BrollReel shots={shots} rangeStart={startFrame} rangeEnd={endFrame} objectPosition={objectPosition} />
      <FilmEffects />
      <Captions captions={episode.captions} rangeStart={startFrame} rangeEnd={endFrame} variant="short" />

      <Sequence from={0} durationInFrames={hookFrames} layout="none">
        <HookCard text={hookText} durationInFrames={hookFrames} />
      </Sequence>

      <Audio src={staticFile(`assets/audio/${episode.narrationFile}`)} startFrom={startFrame} endAt={endFrame} />
      <AudioCues captions={episode.captions} rangeStart={startFrame} rangeEnd={endFrame} />
      <AmbientAudio totalFrames={mainDurationInFrames(episode)} shots={shots} rangeStart={startFrame} rangeEnd={endFrame} />
    </AbsoluteFill>
  );
};
