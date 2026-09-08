import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { FilmEffects } from "./components/FilmEffects";
import { Watermark } from "./components/Watermark";
import { colors, fonts } from "./theme";
import {
  AUDIO_DURATION_FRAMES,
  LEAD_IN_FRAMES,
  closingDurationInFrames,
  closingLines,
  revealDuration,
  revealStart,
} from "./lib/closingTimeline";

const EDGE_FADE_FRAMES = 12;

const EdgeFade: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, EDGE_FADE_FRAMES, closingDurationInFrames - EDGE_FADE_FRAMES, closingDurationInFrames],
    [1, 0, 0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return <AbsoluteFill style={{ background: "black", opacity, pointerEvents: "none" }} />;
};

const LINE_FADE_FRAMES = 14;

const DareLine: React.FC<{ text: string; duration: number; accent?: boolean; subtext?: string }> = ({
  text,
  duration,
  accent,
  subtext,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, LINE_FADE_FRAMES, Math.max(duration - LINE_FADE_FRAMES, LINE_FADE_FRAMES), duration],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 90px", gap: 22 }}>
      <div
        style={{
          opacity,
          fontFamily: fonts.display,
          fontSize: 84,
          lineHeight: 1.15,
          textAlign: "center",
          textTransform: "uppercase",
          color: accent ? colors.accent : colors.ink,
          textShadow: `0 0 40px ${colors.accentGlow}, 0 6px 20px rgba(0,0,0,0.9)`,
          whiteSpace: "pre-line",
        }}
      >
        {text}
      </div>
      {subtext && (
        <div
          style={{
            opacity,
            fontFamily: fonts.caption,
            fontSize: 40,
            letterSpacing: 1,
            color: colors.ink,
            textShadow: "0 2px 12px rgba(0,0,0,0.9)",
          }}
        >
          {subtext}
        </div>
      )}
    </AbsoluteFill>
  );
};

const FadeIn: React.FC<{ startFrame: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  startFrame,
  children,
  style,
}) => {
  const frame = useCurrentFrame();
  const local = frame - startFrame;
  if (local < 0) return null;
  const opacity = interpolate(local, [0, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <div style={{ ...style, opacity }}>{children}</div>;
};

const LogoFadeIn: React.FC<{ startFrame: number }> = ({ startFrame }) => {
  const frame = useCurrentFrame();
  const local = frame - startFrame;
  if (local < 0) return null;
  const opacity = interpolate(local, [0, 20], [0, 0.92], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale = interpolate(local, [0, 20], [0.9, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Img
      src={staticFile("assets/images/logo-sin-explicacion.png")}
      style={{ width: 340, height: 340, opacity, transform: `scale(${scale})` }}
    />
  );
};

const dareStart = closingLines[1].start; // "Mejor no entres." — the jolt moment
const tickStart = closingLines[2].start; // start of the "if you dare" build
const tickDuration = revealStart - tickStart;

// Reusable closing CTA for the end of every Short/Reel/TikTok: dares the
// viewer ("no entres si no eres curioso"), then points to the YouTube
// channel for the full episode. Pure black + grain, no b-roll, so it works
// after any episode regardless of that video's own footage.
export const ClosingCTA: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <FilmEffects />

      {closingLines.map((line, i) => (
        <Sequence key={i} from={line.start} durationInFrames={line.duration} layout="none">
          <DareLine
            text={line.text}
            duration={line.duration}
            accent={line.accent}
            subtext={i === closingLines.length - 1 ? "@SinExplicación.oficial" : undefined}
          />
        </Sequence>
      ))}

      <Sequence from={revealStart} durationInFrames={revealDuration} layout="none">
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 30 }}>
          {/* The logo art already spells out "SIN EXPLICACIÓN" — no need to
              repeat it as text. Only the @handle, since that's the one thing
              the viewer actually needs to go type into YouTube. */}
          <LogoFadeIn startFrame={revealStart} />
          <FadeIn
            startFrame={revealStart + 18}
            style={{
              fontFamily: fonts.display,
              fontSize: 52,
              letterSpacing: 1,
              color: colors.ink,
              textShadow: `0 0 30px ${colors.accentGlow}, 0 2px 12px rgba(0,0,0,0.9)`,
            }}
          >
            @SinExplicación.oficial
          </FadeIn>
        </AbsoluteFill>
      </Sequence>

      <Sequence from={LEAD_IN_FRAMES} durationInFrames={AUDIO_DURATION_FRAMES} layout="none">
        <Audio src={staticFile("assets/audio/closing-cta.mp3")} />
      </Sequence>

      {/* Continuous eerie bed under the whole card. */}
      <Audio
        src={staticFile("assets/audio/sfx/Musica misteriosa.mp3")}
        volume={(f) =>
          interpolate(f, [0, 40, closingDurationInFrames - 40, closingDurationInFrames], [0, 0.13, 0.13, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        }
      />

      {/* The "ugly/scary" contrast jolt right as the dare lands: creak + lament layered. */}
      <Sequence from={dareStart} durationInFrames={90} layout="none">
        <Audio
          src={staticFile("assets/audio/sfx/Madera crujiendo.wav")}
          volume={(f) => interpolate(f, [0, 6, 70, 90], [0, 0.55, 0.35, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
        />
      </Sequence>
      <Sequence from={dareStart} durationInFrames={90} layout="none">
        <Audio
          src={staticFile("assets/audio/sfx/Trenos.wav")}
          volume={(f) => interpolate(f, [0, 10, 70, 90], [0, 0.4, 0.25, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
        />
      </Sequence>

      {/* Ticking clock builds tension through the "if you dare" lines, cuts right before the reveal. */}
      <Sequence from={tickStart} durationInFrames={tickDuration} layout="none">
        <Audio
          src={staticFile("assets/audio/sfx/Reloj.wav")}
          volume={(f) =>
            interpolate(f, [0, 20, Math.max(tickDuration - 30, 20), tickDuration], [0, 0.22, 0.22, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          }
        />
      </Sequence>

      <Watermark size={100} />

      <EdgeFade />
    </AbsoluteFill>
  );
};
