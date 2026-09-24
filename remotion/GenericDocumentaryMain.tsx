import { AbsoluteFill, Audio, staticFile } from "remotion";
import { buildReel } from "./lib/broll";
import { BrollReel } from "./components/BrollReel";
import { ChaosCaptions } from "./components/ChaosCaptions";
import { AudioCues } from "./components/AudioCues";
import { AmbientAudio } from "./components/AmbientAudio";
import { ChaosFilmEffects } from "./components/ChaosFilmEffects";
import { Watermark } from "./components/Watermark";
import { documentaryMainDurationInFrames, type DocumentaryEpisodeConfig } from "./lib/documentaryEpisode";

// FASE 9 — composición documental GENÉRICA, arquitectura PROVISIONAL para
// LUNA VERDE y OBJETOS MALDITOS (instrucción explícita: "usa MainDocumentary
// como base, con identidad propia" — NO es la decisión editorial final).
// Deliberadamente NO copia remotion/MainDocumentary.tsx (que está acoplado a
// remotion/lib/episodes.ts, el catálogo REAL y COMPARTIDO de SIN
// EXPLICACIÓN) — reutiliza en cambio las piezas ya genéricas y verificadas
// sin acoplamiento de tema (mismo criterio de Fase 4):
//   - BrollReel: genérico ya (nota: su transición CutGlitch interna importa
//     colors.ink de SIN EXPLICACIÓN — deuda técnica YA aceptada en Fase 4
//     para ChaosNewsMain, se hereda igual aquí, no se corrige ahora).
//   - ChaosCaptions/ChaosFilmEffects: pese al nombre, son 100% genéricos
//     (nunca importan theme.ts, toda su identidad llega por props) — Fase 4
//     ya los construyó así a propósito. Se reutilizan tal cual, sin copiarlos.
//   - AmbientAudio/Watermark: generalizados en Fase 1/3, config opcional.
// Un ÚNICO componente, registrado en Root.tsx una vez por canal (mismo
// patrón que QuoteVideo.tsx con alzaLaVozVideos.map) — nunca una copia de
// archivo por canal.
export const GenericDocumentaryMain: React.FC<{ config: DocumentaryEpisodeConfig }> = ({ config }) => {
  const { theme, captions, videoPool, imagePool, reelOptions, narrationFile, watermark } = config;
  const durationInFrames = documentaryMainDurationInFrames(config);
  const shots = config.shots ?? buildReel({ videoPool, imagePool }, durationInFrames, reelOptions);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.background }}>
      <BrollReel shots={shots} rangeStart={0} rangeEnd={durationInFrames} />
      <ChaosFilmEffects vignetteColor={theme.colors.vignette} vignetteIntensity={0.5} />
      <ChaosCaptions captions={captions} rangeStart={0} rangeEnd={durationInFrames} fontFamily={theme.fonts.subtitle} color={theme.colors.ink} accentColor={theme.colors.accent} variant="main" />
      {/* CRÍTICO (mismo hallazgo que ChaosNewsMain.tsx, Fase 4): AmbientAudio
          cae a la música REAL de SIN EXPLICACIÓN si `config` es `undefined` —
          nunca pasar config.audio sin verificar primero. */}
      {narrationFile && <Audio src={staticFile(`assets/audio/${narrationFile}`)} />}
      <AudioCues captions={captions} rangeStart={0} rangeEnd={durationInFrames} />
      {config.audio && <AmbientAudio totalFrames={durationInFrames} shots={shots} rangeStart={0} rangeEnd={durationInFrames} config={config.audio} />}
      {/* CRÍTICO (mismo hallazgo que ChaosNewsMain.tsx): Watermark cae a su
          logo REAL de SIN EXPLICACIÓN si imageSrc es undefined. */}
      {watermark?.imageSrc && <Watermark imageSrc={watermark.imageSrc} size={watermark.size} opacity={watermark.opacity} margin={watermark.margin} />}
    </AbsoluteFill>
  );
};
