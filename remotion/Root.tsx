import { Composition } from "remotion";
import { OutfitShowcase } from "./Composition";
import { MainDocumentary } from "./MainDocumentary";
import { ShortClip } from "./ShortClip";
import { Intro } from "./Intro";
import { IntroLandscape } from "./IntroLandscape";
import { ChapterCard, chapterCardDurationInFrames } from "./ChapterCard";
import { ClosingCTA } from "./ClosingCTA";
import { closingDurationInFrames } from "./lib/closingTimeline";
import { introDurationInFrames } from "./lib/introTimeline";
import { episodes, mainDurationInFrames } from "./lib/episodes";
import { chapters } from "./lib/chapters";
import { layout, FPS } from "./theme";
import { StarDust, STAR_DUST_DURATION_IN_FRAMES } from "./star-dust/compositions/StarDust";
import {
  EntertainmentVideo,
  ENTERTAINMENT_VIDEO_DURATION_IN_FRAMES,
} from "./entertainment/compositions/EntertainmentVideo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="StarDust"
        component={StarDust}
        durationInFrames={STAR_DUST_DURATION_IN_FRAMES}
        fps={30}
        width={1920}
        height={1080}
      />

      <Composition
        id="PremiosJuventud2026"
        component={EntertainmentVideo}
        durationInFrames={ENTERTAINMENT_VIDEO_DURATION_IN_FRAMES}
        fps={30}
        width={1920}
        height={1080}
      />

      <Composition
        id="OutfitShowcase"
        component={OutfitShowcase}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          title: "Visteapy",
          imageUrl: "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1080",
        }}
      />

      {episodes.map((episode) => (
        <Composition
          key={`MainDocumentary-${episode.id}`}
          id={`MainDocumentary-${episode.id}`}
          component={MainDocumentary}
          durationInFrames={mainDurationInFrames(episode)}
          fps={FPS}
          width={layout.main.width}
          height={layout.main.height}
          defaultProps={{ episodeId: episode.id }}
        />
      ))}

      <Composition
        id="Intro"
        component={Intro}
        durationInFrames={introDurationInFrames}
        fps={FPS}
        width={layout.short.width}
        height={layout.short.height}
      />

      <Composition
        id="IntroLandscape"
        component={IntroLandscape}
        durationInFrames={introDurationInFrames}
        fps={FPS}
        width={layout.main.width}
        height={layout.main.height}
      />

      {chapters.map((chapter) => (
        <Composition
          key={`Chapter-${chapter.number}`}
          id={`Chapter-${chapter.number}`}
          component={ChapterCard}
          fps={FPS}
          width={layout.main.width}
          height={layout.main.height}
          durationInFrames={chapterCardDurationInFrames(chapter)}
          defaultProps={chapter}
        />
      ))}

      <Composition
        id="ClosingCTA"
        component={ClosingCTA}
        durationInFrames={closingDurationInFrames}
        fps={FPS}
        width={layout.short.width}
        height={layout.short.height}
      />

      {episodes.map((episode) =>
        episode.clips.map((clip, i) => (
          <Composition
            key={`Short-${episode.id}-${i}`}
            id={`Short-${episode.id}-${i}`}
            component={ShortClip}
            fps={FPS}
            width={layout.short.width}
            height={layout.short.height}
            durationInFrames={Math.max(clip.endFrame - clip.startFrame, 1)}
            defaultProps={{ ...clip, episodeId: episode.id }}
            calculateMetadata={async ({ props }) => ({
              durationInFrames: Math.max(props.endFrame - props.startFrame, 1),
            })}
          />
        )),
      )}
    </>
  );
};
