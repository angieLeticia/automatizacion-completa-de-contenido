import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { buildReel } from "./lib/broll";
import { BrollReel } from "./components/BrollReel";
import { ChaosCaptions } from "./components/ChaosCaptions";
import { AudioCues } from "./components/AudioCues";
import { AmbientAudio } from "./components/AmbientAudio";
import { ChaosFilmEffects } from "./components/ChaosFilmEffects";
import { HookCard } from "./components/HookCard";
import { Watermark } from "./components/Watermark";
import { documentaryClipDurationInFrames, type DocumentaryClipConfig } from "./lib/documentaryEpisode";

// FASE 9 — clip vertical 9:16, contraparte de GenericDocumentaryMain.tsx.
// Mismo criterio que ChaosNewsClip.tsx (Fase 4): sin bumper, hook corto al
// inicio (HookCard, ya genérico) + el tramo [startFrame, endFrame) del
// desarrollo — igual que ShortClip.tsx (SIN EXPLICACIÓN real) ya hace con su
// propio HookCard local. HOOK_HOLD_FRAMES es una constante local propia
// (nunca theme.timing.hookHoldSeconds de SIN EXPLICACIÓN).
const HOOK_HOLD_FRAMES = 78; // ~2.6s @ 30fps, mismo orden de magnitud que el resto del proyecto

export const GenericDocumentaryClip: React.FC<{ config: DocumentaryClipConfig }> = ({ config }) => {
  const { theme, startFrame, endFrame, hookText, objectPosition, captions, videoPool, imagePool, reelOptions, narrationFile, watermark } = config;
  const shots = config.shots ?? buildReel({ videoPool, imagePool }, endFrame, reelOptions);
  const durationInFrames = documentaryClipDurationInFrames(config);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.background }}>
      <BrollReel shots={shots} rangeStart={startFrame} rangeEnd={endFrame} objectPosition={objectPosition} />
      <ChaosCaptions captions={captions} rangeStart={startFrame} rangeEnd={endFrame} fontFamily={theme.fonts.subtitle} color={theme.colors.ink} accentColor={theme.colors.accent} variant="clip" />

      <Sequence from={0} durationInFrames={Math.min(HOOK_HOLD_FRAMES, durationInFrames)} layout="none">
        <HookCard text={hookText} durationInFrames={Math.min(HOOK_HOLD_FRAMES, durationInFrames)} fontFamily={theme.fonts.display} color={theme.colors.ink} accentColor={theme.colors.accent} />
      </Sequence>

      {narrationFile && <Audio src={staticFile(`assets/audio/${narrationFile}`)} startFrom={startFrame} endAt={endFrame} />}
      <AudioCues captions={captions} rangeStart={startFrame} rangeEnd={endFrame} />
      {config.audio && <AmbientAudio totalFrames={endFrame} shots={shots} rangeStart={startFrame} rangeEnd={endFrame} config={config.audio} />}
      <ChaosFilmEffects vignetteColor={theme.colors.vignette} vignetteIntensity={0.5} />
      {watermark?.imageSrc && <Watermark imageSrc={watermark.imageSrc} size={watermark.size} opacity={watermark.opacity} margin={watermark.margin} />}
    </AbsoluteFill>
  );
};
