import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { buildReel, shotsInRange } from "./lib/broll";
import { BrollReel } from "./components/BrollReel";
import { ChaosCaptions } from "./components/ChaosCaptions";
import { AudioCues } from "./components/AudioCues";
import { AmbientAudio } from "./components/AmbientAudio";
import { ChaosFilmEffects } from "./components/ChaosFilmEffects";
import { HookCard } from "./components/HookCard";
import { BreakingTag } from "./components/BreakingTag";
import { Watermark } from "./components/Watermark";
import type { ChaosClipConfig } from "./lib/chaosEpisode";

// FASE 5.10-AQ (Fase 4) — clip vertical 9:16, composición NUEVA e
// independiente de ShortClip.tsx. Mismo criterio de identidad 100%
// inyectada que ChaosNewsMain.tsx — ver ese archivo para el detalle
// completo (namespace, watermark condicional, captions propias, etc).
//
// A diferencia de ChaosNewsMain, aquí NO hay bumper (los clips van directo
// al hook, mismo criterio que ShortClip.tsx ya usa para SIN EXPLICACIÓN) —
// el desarrollo es directamente el tramo [startFrame, endFrame) del B-roll
// y las captions del episodio completo, igual que ClipMark/ShortClip.
const HOOK_HOLD_FRAMES = 78; // ~2.6s @ 30fps — mismo orden de magnitud que timing.hookHoldSeconds histórico, aquí como constante local propia (ver informe de fase: no se importa theme.ts de SIN EXPLICACIÓN)

export const ChaosNewsClip: React.FC<{ config: ChaosClipConfig }> = ({ config }) => {
  const { theme, startFrame, endFrame, hookText, objectPosition, breakingTags = [], captions, videoPool, imagePool, reelOptions, narrationFile, watermark } = config;
  const shots = config.shots ?? buildReel({ videoPool, imagePool }, endFrame, reelOptions);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.background }}>
      <BrollReel shots={shots} rangeStart={startFrame} rangeEnd={endFrame} objectPosition={objectPosition} />
      <ChaosCaptions captions={captions} rangeStart={startFrame} rangeEnd={endFrame} fontFamily={theme.fonts.subtitle} color={theme.colors.ink} accentColor={theme.colors.accent} variant="clip" />

      <Sequence from={0} durationInFrames={HOOK_HOLD_FRAMES} layout="none">
        <HookCard text={hookText} durationInFrames={HOOK_HOLD_FRAMES} fontFamily={theme.fonts.display} color={theme.colors.ink} accentColor={theme.colors.accent} />
      </Sequence>

      {narrationFile && <Audio src={staticFile(`assets/audio/${narrationFile}`)} startFrom={startFrame} endAt={endFrame} />}
      <AudioCues captions={captions} rangeStart={startFrame} rangeEnd={endFrame} />
      {/* Ver ChaosNewsMain.tsx para el porqué de este condicional — sin él,
          AmbientAudio.tsx cae silenciosamente a la música real de SIN
          EXPLICACIÓN. */}
      {config.audio && <AmbientAudio totalFrames={endFrame} shots={shots} rangeStart={startFrame} rangeEnd={endFrame} config={config.audio} />}

      <ChaosFilmEffects
        vignetteColor={theme.colors.vignette}
        vignetteIntensity={0.5}
        cutFrames={shotsInRange(shots, startFrame, endFrame).map((s) => Math.max(s.timelineStart, startFrame) - startFrame)}
        flashColor={theme.colors.ink}
      />

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

      {/* Ver ChaosNewsMain.tsx para el porqué de este condicional — nunca
          pasar `watermark?.imageSrc` directo, o Watermark.tsx cae a su
          default histórico (el logo de SIN EXPLICACIÓN). */}
      {watermark?.imageSrc && <Watermark imageSrc={watermark.imageSrc} size={watermark.size} opacity={watermark.opacity} margin={watermark.margin} />}
    </AbsoluteFill>
  );
};
