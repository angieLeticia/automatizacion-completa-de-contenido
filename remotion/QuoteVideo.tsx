// Fase 5.1 — template migrado desde el repositorio independiente
// D:\MATERIAL VIDEOS\ALZA LA VOZ\Alza-la-Voz\remotion\QuoteVideo.tsx (0
// commits reales en ese repo — todo vivía sin respaldo en disco local). Cero
// cambios de lógica/animación respecto al original — solo se adaptó el
// import de fuente para reusar remotion/lib/fonts.ts (mismo patrón centralizado
// que ya usan MainDocumentary/ShortClip) en vez de un loadFont() propio suelto.
// Genérico a propósito: no tiene ningún dato de "Alza la Voz" hardcodeado —
// recibe un VideoDef completo por props (ver channels/alza-la-voz/videos.ts).
import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { quoteFontFamily } from "./lib/fonts";
import { SECONDS_PER_PHRASE, type VideoDef } from "../channels/alza-la-voz/videos";

const PhraseSlide: React.FC<{
  image: string;
  text: string;
  accentColor: string;
  durationInFrames: number;
  index: number;
}> = ({ image, text, accentColor, durationInFrames, index }) => {
  const frame = useCurrentFrame();

  // Ken Burns: alterna dirección de zoom-in/zoom-out por slide.
  const zoomOut = index % 2 === 0;
  const scale = zoomOut
    ? interpolate(frame, [0, durationInFrames], [1.15, 1], { extrapolateRight: "clamp" })
    : interpolate(frame, [0, durationInFrames], [1, 1.15], { extrapolateRight: "clamp" });

  const drift = interpolate(frame, [0, durationInFrames], [0, index % 2 === 0 ? -20 : 20], {
    extrapolateRight: "clamp",
  });

  const fadeIn = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(fadeIn, fadeOut);

  const textRise = interpolate(frame, [0, 25], [30, 0], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ opacity }}>
      <AbsoluteFill style={{ transform: `scale(${scale}) translateX(${drift}px)` }}>
        <Img src={staticFile(`assets/alza-la-voz/${image}`)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          background: "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.75) 100%)",
        }}
      />

      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", padding: "8% 7% 14%" }}>
        <div
          style={{
            width: 56,
            height: 5,
            borderRadius: 3,
            backgroundColor: accentColor,
            marginBottom: 28,
            transform: `translateY(${textRise}px)`,
          }}
        />
        <div
          style={{
            fontFamily: quoteFontFamily,
            fontWeight: 600,
            fontSize: 58,
            lineHeight: 1.25,
            textAlign: "center",
            color: "#FFFFFF",
            textShadow: "0 4px 24px rgba(0,0,0,0.5)",
            transform: `translateY(${textRise}px)`,
          }}
        >
          {text}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const QuoteVideo: React.FC<{ video: VideoDef; channelBrand: string }> = ({ video, channelBrand }) => {
  const { fps } = useVideoConfig();
  const slideDuration = SECONDS_PER_PHRASE * fps;
  const frame = useCurrentFrame();
  const totalDuration = video.phrases.length * slideDuration;

  const musicFadeOutStart = totalDuration - fps * 1.5;
  const musicVolume = interpolate(frame, [0, fps, musicFadeOutStart, totalDuration], [0, 0.55, 0.55, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Audio src={staticFile(`assets/alza-la-voz/${video.music}`)} volume={musicVolume} />
      {video.phrases.map((phrase, i) => (
        <Sequence key={i} from={i * slideDuration} durationInFrames={slideDuration}>
          <PhraseSlide image={phrase.image} text={phrase.text} accentColor={video.accentColor} durationInFrames={slideDuration} index={i} />
        </Sequence>
      ))}

      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", padding: "6% 0 0", pointerEvents: "none" }}>
        <div
          style={{
            fontFamily: quoteFontFamily,
            fontWeight: 600,
            fontSize: 26,
            letterSpacing: 4,
            color: "rgba(255,255,255,0.85)",
            textTransform: "uppercase",
            textShadow: "0 2px 12px rgba(0,0,0,0.6)",
          }}
        >
          {channelBrand}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
