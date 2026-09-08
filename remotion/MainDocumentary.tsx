import { AbsoluteFill, Audio, staticFile } from "remotion";
import { buildReel } from "./lib/broll";
import { BrollReel } from "./components/BrollReel";
import { Captions } from "./components/Captions";
import { AudioCues } from "./components/AudioCues";
import { AmbientAudio } from "./components/AmbientAudio";
import { FilmEffects } from "./components/FilmEffects";
import { getEpisode, mainDurationInFrames } from "./lib/episodes";
import { colors } from "./theme";

// No title card here — the dedicated Intro/IntroLandscape composition and
// that chapter's ChapterCard already carry the reveal before this plays, so
// the documentary itself cuts straight into the story.
export const MainDocumentary: React.FC<{ episodeId: string }> = ({ episodeId }) => {
  const episode = getEpisode(episodeId);
  const durationInFrames = mainDurationInFrames(episode);
  const shots = episode.shots ?? buildReel(episode, durationInFrames, episode.reelOptions);

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <BrollReel shots={shots} rangeStart={0} rangeEnd={durationInFrames} />
      <FilmEffects />
      <Captions captions={episode.captions} rangeStart={0} rangeEnd={durationInFrames} variant="documentary" />
      <Audio src={staticFile(`assets/audio/${episode.narrationFile}`)} />
      <AudioCues captions={episode.captions} rangeStart={0} rangeEnd={durationInFrames} />
      <AmbientAudio totalFrames={durationInFrames} shots={shots} rangeStart={0} rangeEnd={durationInFrames} />
    </AbsoluteFill>
  );
};
