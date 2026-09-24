import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { buildReel } from "./lib/broll";
import { BrollReel } from "./components/BrollReel";
import { ChaosCaptions } from "./components/ChaosCaptions";
import { AudioCues } from "./components/AudioCues";
import { AmbientAudio } from "./components/AmbientAudio";
import { ChaosFilmEffects } from "./components/ChaosFilmEffects";
import { HookCard } from "./components/HookCard";
import { ChannelBumper } from "./components/ChannelBumper";
import { BreakingTag } from "./components/BreakingTag";
import { TwistCard } from "./components/TwistCard";
import { Watermark } from "./components/Watermark";
import type { ChaosEpisodeConfig } from "./lib/chaosEpisode";

// FASE 5.10-AQ (Fase 4) — composición NUEVA, independiente de
// MainDocumentary.tsx (nunca "copiar y cambiar colores" — arquitectura
// propia, ver informe de fase para el detalle). Estructura: Hook ->
// ChannelBumper -> Desarrollo (B-roll + captions + narración + SFX + tags
// ocasionales + giros) -> Cierre opcional. Identidad 100% inyectada vía
// `ChaosEpisodeConfig` (theme/extraColors/audio/watermark) — este archivo
// nunca importa remotion/theme.ts ni ningún dato de ningún canal.
//
// Todos los frames de `breakingTags`/`twists`/`closing` son ABSOLUTOS
// (relativos al frame 0 de esta composición completa, no al inicio del
// desarrollo) — mismo criterio que usan BreakingTag/TwistCard para su
// propio `startFrame` (relativo al Sequence que los envuelve), que aquí es
// la raíz de la composición.
export const ChaosNewsMain: React.FC<{ config: ChaosEpisodeConfig }> = ({ config }) => {
  const { theme, hook, bumper, breakingTags = [], twists = [], closing, captions, videoPool, imagePool, reelOptions, narrationFile, watermark } = config;

  const FPS_LOCAL = 30;
  const secToFrames = (s: number) => Math.round(s * FPS_LOCAL);
  const captionsEnd = captions.length === 0 ? 0 : Math.max(...captions.map((c) => secToFrames(c.end)));
  const developmentDuration = Math.max(secToFrames(config.narrationDurationSeconds), captionsEnd);
  const shots = config.shots ?? buildReel({ videoPool, imagePool }, developmentDuration, reelOptions);

  const hookStart = 0;
  const bumperStart = hook.durationInFrames;
  const developmentStart = hook.durationInFrames + bumper.durationInFrames;
  const closingStart = developmentStart + developmentDuration;

  // cutFrames para ChaosFilmEffects: el inicio de cada shot dentro del
  // desarrollo, desplazado al frame ABSOLUTO de la composición (ver nota de
  // cabecera) — nunca se reutiliza el CutGlitch interno de BrollReel (ese
  // sigue existiendo tal cual, sin tocar, y sigue usando colors.ink de SIN
  // EXPLICACIÓN — ver informe de fase, "hallazgo menor aceptado").
  const cutFrames = shots.map((s) => developmentStart + s.timelineStart);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.background }}>
      <Sequence from={hookStart} durationInFrames={hook.durationInFrames} layout="none">
        <HookCard text={hook.text} durationInFrames={hook.durationInFrames} fontFamily={theme.fonts.display} color={theme.colors.ink} accentColor={theme.colors.accent} imageSrc={hook.imageSrc} />
      </Sequence>

      <Sequence from={bumperStart} durationInFrames={bumper.durationInFrames} layout="none">
        <ChannelBumper
          channelName={bumper.channelName}
          durationInFrames={bumper.durationInFrames}
          logoSrc={bumper.logoSrc}
          accentColor={theme.colors.accent}
          backgroundColor={theme.colors.background}
          textColor={theme.colors.ink}
          fontFamily={theme.fonts.display}
        />
      </Sequence>

      <Sequence from={developmentStart} durationInFrames={developmentDuration} layout="none">
        <BrollReel shots={shots} rangeStart={0} rangeEnd={developmentDuration} />
        <ChaosCaptions captions={captions} rangeStart={0} rangeEnd={developmentDuration} fontFamily={theme.fonts.subtitle} color={theme.colors.ink} accentColor={theme.colors.accent} variant="main" />
        <AudioCues captions={captions} rangeStart={0} rangeEnd={developmentDuration} />
        {narrationFile && <Audio src={staticFile(`assets/audio/${narrationFile}`)} />}
        {/* FASE 5.10-AQ — CRÍTICO, mismo hallazgo que Watermark (ver más
            abajo): AmbientAudio.tsx (Fase 1) cae a `sinExplicacionAmbientAudioConfig`
            (los archivos REALES de música de SIN EXPLICACIÓN) en cuanto
            `config` es `undefined` — pasar `config.audio` directo sin
            verificar habría reproducido música de SIN EXPLICACIÓN en
            ENCIENDE EL CAOS por accidente. Sin audio config real todavía
            (PASO 7: "no inventes una selección definitiva de música/SFX"),
            la composición no monta <AmbientAudio> en absoluto. */}
        {config.audio && <AmbientAudio totalFrames={developmentDuration} shots={shots} rangeStart={0} rangeEnd={developmentDuration} config={config.audio} />}
      </Sequence>

      <ChaosFilmEffects vignetteColor={theme.colors.vignette} vignetteIntensity={0.5} cutFrames={cutFrames} flashColor={theme.colors.ink} />

      {breakingTags.map((tag, i) => (
        <BreakingTag
          key={`${tag.text}-${tag.startFrame}-${i}`}
          text={tag.text}
          startFrame={tag.startFrame}
          durationInFrames={tag.durationInFrames}
          position={tag.position}
          variant={tag.variant}
          color={tag.color ?? theme.colors.ink}
          backgroundColor={tag.backgroundColor ?? theme.colors.accent}
          fontFamily={theme.fonts.caption}
        />
      ))}

      {twists.map((twist, i) => (
        <TwistCard
          key={`${twist.title}-${twist.startFrame}-${i}`}
          title={twist.title}
          text={twist.text}
          startFrame={twist.startFrame}
          durationInFrames={twist.durationInFrames}
          displayMode={twist.displayMode}
          variant={twist.variant}
          accentColor={theme.colors.accent}
          backgroundColor={theme.colors.background}
          textColor={theme.colors.ink}
          titleFontFamily={theme.fonts.display}
          textFontFamily={theme.fonts.subtitle}
        />
      ))}

      {closing && (
        <Sequence from={closingStart} durationInFrames={closing.durationInFrames} layout="none">
          <TwistCard
            title={closing.title}
            text={closing.text}
            startFrame={0}
            durationInFrames={closing.durationInFrames}
            displayMode="fullscreen"
            variant="update"
            accentColor={theme.colors.accent}
            backgroundColor={theme.colors.background}
            textColor={theme.colors.ink}
            titleFontFamily={theme.fonts.display}
            textFontFamily={theme.fonts.subtitle}
          />
        </Sequence>
      )}

      {/* FASE 5.10-AQ — CRÍTICO: Watermark.tsx (Fase 3) cae a su propio
          default histórico (el logo REAL de SIN EXPLICACIÓN) en cuanto
          `imageSrc` es `undefined` — pasarle `watermark?.imageSrc` sin
          verificar primero habría renderizado el logo de SIN EXPLICACIÓN
          en ENCIENDE EL CAOS por accidente. Por eso <Watermark> solo se
          monta si config.watermark.imageSrc existe de verdad — sin logo
          real todavía, la composición funciona sin ningún watermark. */}
      {watermark?.imageSrc && <Watermark imageSrc={watermark.imageSrc} size={watermark.size} opacity={watermark.opacity} margin={watermark.margin} />}
    </AbsoluteFill>
  );
};
