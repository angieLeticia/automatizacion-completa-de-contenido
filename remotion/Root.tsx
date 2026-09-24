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
// FASE 5.10-AQ (Fase 4 — composiciones de ENCIENDE EL CAOS) — registro
// ADITIVO, ver esas dos secciones más abajo para el detalle completo.
import { ChaosNewsMain } from "./ChaosNewsMain";
import { ChaosNewsClip } from "./ChaosNewsClip";
import { chaosMainDurationInFrames, chaosClipDurationInFrames, type ChaosEpisodeConfig, type ChaosClipConfig } from "./lib/chaosEpisode";
import { chaosMainFixture, chaosClipFixture } from "./lib/chaosFixture";
// FASE 9 — arquitectura documental GENÉRICA provisional (LUNA VERDE/OBJETOS
// MALDITOS), ver informe de fase para el detalle completo. Un solo par de
// componentes, registrados dos veces (una por canal) con fixture/tema
// propios — mismo patrón que QuoteVideo.tsx + alzaLaVozVideos.map.
import { GenericDocumentaryMain } from "./GenericDocumentaryMain";
import { GenericDocumentaryClip } from "./GenericDocumentaryClip";
import { documentaryMainDurationInFrames, documentaryClipDurationInFrames, type DocumentaryEpisodeConfig, type DocumentaryClipConfig } from "./lib/documentaryEpisode";
import { lunaVerdeMainFixture, lunaVerdeClipFixture } from "./lib/lunaVerdeFixture";
import { objetosMalditosMainFixture, objetosMalditosClipFixture } from "./lib/objetosMalditosFixture";

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

      {/* FASE 5.10-AQ (Fase 4) — ENCIENDE EL CAOS. A diferencia de
          MainDocumentary/Short-{id}-{n} (un <Composition> por episodio YA
          conocido, leído de remotion/lib/episodes.ts), estas dos
          composiciones se registran UNA SOLA VEZ cada una, con id fijo y
          puramente alfanumérico (sin episode_id embebido — el namespace de
          episodios de Fase 5.10-AI sigue existiendo y aplicará a los
          archivos/assets que un futuro RenderProvider genere por episodio
          real, pero no a este id de composición, que nunca varía). Los
          datos reales de un episodio llegan vía props (defaultProps aquí,
          --props en un render real futuro — mismo mecanismo que Remotion ya
          soporta) — `calculateMetadata` recalcula durationInFrames a partir
          de esos props, igual que ya hace Short-{id}-{n} más arriba.
          `defaultProps` usa el FIXTURE técnico (chaosFixture.ts, sin
          contenido real) solo para que la composición tenga algo válido que
          mostrar en el Studio/al listar composiciones — un render real
          (Fase 5+) SIEMPRE pasará datos reales via --props, nunca depende
          de este fixture. */}
      <Composition
        id="ChaosNewsMain"
        component={ChaosNewsMain}
        fps={FPS}
        width={layout.main.width}
        height={layout.main.height}
        durationInFrames={chaosMainDurationInFrames(chaosMainFixture)}
        defaultProps={{ config: chaosMainFixture }}
        calculateMetadata={async ({ props }) => ({
          durationInFrames: chaosMainDurationInFrames((props as { config: ChaosEpisodeConfig }).config),
        })}
      />

      <Composition
        id="ChaosNewsClip"
        component={ChaosNewsClip}
        fps={FPS}
        width={layout.short.width}
        height={layout.short.height}
        durationInFrames={chaosClipDurationInFrames(chaosClipFixture)}
        defaultProps={{ config: chaosClipFixture }}
        calculateMetadata={async ({ props }) => ({
          durationInFrames: chaosClipDurationInFrames((props as { config: ChaosClipConfig }).config),
        })}
      />

      {/* FASE 9 — LUNA VERDE y OBJETOS MALDITOS, arquitectura documental
          genérica PROVISIONAL (nunca la decisión editorial final). Mismo
          criterio que ChaosNewsMain/ChaosNewsClip arriba: id fijo
          alfanumérico, defaultProps = fixture técnico, datos reales llegan
          vía --props en un render real (chaosNewsRemotionProvider ya probó
          este mecanismo en Fase 6.5/Bloque 1). */}
      <Composition
        id="LunaVerdeMain"
        component={GenericDocumentaryMain}
        fps={FPS}
        width={layout.main.width}
        height={layout.main.height}
        durationInFrames={documentaryMainDurationInFrames(lunaVerdeMainFixture)}
        defaultProps={{ config: lunaVerdeMainFixture }}
        calculateMetadata={async ({ props }) => ({
          durationInFrames: documentaryMainDurationInFrames((props as { config: DocumentaryEpisodeConfig }).config),
        })}
      />
      <Composition
        id="LunaVerdeClip"
        component={GenericDocumentaryClip}
        fps={FPS}
        width={layout.short.width}
        height={layout.short.height}
        durationInFrames={documentaryClipDurationInFrames(lunaVerdeClipFixture)}
        defaultProps={{ config: lunaVerdeClipFixture }}
        calculateMetadata={async ({ props }) => ({
          durationInFrames: documentaryClipDurationInFrames((props as { config: DocumentaryClipConfig }).config),
        })}
      />
      <Composition
        id="ObjetosMalditosMain"
        component={GenericDocumentaryMain}
        fps={FPS}
        width={layout.main.width}
        height={layout.main.height}
        durationInFrames={documentaryMainDurationInFrames(objetosMalditosMainFixture)}
        defaultProps={{ config: objetosMalditosMainFixture }}
        calculateMetadata={async ({ props }) => ({
          durationInFrames: documentaryMainDurationInFrames((props as { config: DocumentaryEpisodeConfig }).config),
        })}
      />
      <Composition
        id="ObjetosMalditosClip"
        component={GenericDocumentaryClip}
        fps={FPS}
        width={layout.short.width}
        height={layout.short.height}
        durationInFrames={documentaryClipDurationInFrames(objetosMalditosClipFixture)}
        defaultProps={{ config: objetosMalditosClipFixture }}
        calculateMetadata={async ({ props }) => ({
          durationInFrames: documentaryClipDurationInFrames((props as { config: DocumentaryClipConfig }).config),
        })}
      />
    </>
  );
};
