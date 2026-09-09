import { Composition } from "remotion";
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
// Fase 5.1 — QuoteVideo migrado desde el repositorio independiente de ALZA
// LA VOZ (0 commits reales, ver informe de Fase 5.1) — template genérico,
// parametrizado por VideoDef, sin ningún dato de canal hardcodeado.
import { QuoteVideo } from "./QuoteVideo";
import { videos as alzaLaVozVideos, durationInFrames as quoteDurationInFrames } from "../channels/alza-la-voz/videos";

const QUOTE_FORMATS = [
  { id: "vertical", width: 1080, height: 1920 },
  { id: "square", width: 1080, height: 1080 },
] as const;

// NOTA (Fase 4.1 — adaptación standalone): este Root.tsx registraba también
// StarDust, PremiosJuventud2026 (EntertainmentVideo) y OutfitShowcase — piezas
// de una sola vez / de e-commerce, deliberadamente excluidas del snapshot de
// agentes (ver docs/operational-status.md y el historial de Fase 3.4/3.6). No
// se reconstruyen aquí. Este archivo solo registra el pipeline reutilizable
// (MainDocumentary/ShortClip), que es lo que scripts/render-main.mjs y
// scripts/render-shorts.mjs invocan realmente.

export const RemotionRoot: React.FC = () => {
  return (
    <>
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

      {alzaLaVozVideos.map((video) =>
        QUOTE_FORMATS.map((format) => (
          <Composition
            key={`Quote-alza-la-voz-${video.id}-${format.id}`}
            id={`Quote-alza-la-voz-${video.id}-${format.id}`}
            component={QuoteVideo}
            durationInFrames={quoteDurationInFrames(video, FPS)}
            fps={FPS}
            width={format.width}
            height={format.height}
            defaultProps={{ video, channelBrand: "Alza la Voz" }}
          />
        )),
      )}
    </>
  );
};
