import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts, timing } from "../theme";
import type { CaptionType } from "../lib/captions";

type Props = {
  text: string;
  type: CaptionType;
  // Frame (relative to this component's own Sequence) when the text starts appearing.
  startFrame?: number;
  fontSize?: number;
};

// A big, clean "emerges from the center" title card: letters start pinned
// tight and the whole block punches up from a small scale with one dramatic
// spring overshoot, spreading open as it lands. No flicker, no RGB split —
// those read as noisy. The mystery comes from the red bloom behind the type
// and the thin rules that open with it, not from visual noise.
const GlitchText: React.FC<{ text: string; localFrame: number; fontSize: number }> = ({
  text,
  localFrame,
  fontSize,
}) => {
  const entrance = spring({ frame: localFrame, fps: 30, config: { damping: 11, stiffness: 80, mass: 0.9 } });
  const scale = interpolate(entrance, [0, 1], [0.55, 1]);
  const opacity = interpolate(localFrame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const letterSpacing = interpolate(entrance, [0, 1], [-4, 6]);
  const lineWidth = interpolate(localFrame, [4, 26], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const glowOpacity = interpolate(localFrame, [0, 14, 40], [0, 0.9, 0.55], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20,
        maxWidth: "88%",
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "-40% -20%",
          background: `radial-gradient(ellipse at center, ${colors.accentGlow} 0%, rgba(200,30,30,0) 70%)`,
          opacity: glowOpacity,
          filter: "blur(4px)",
          pointerEvents: "none",
        }}
      />
      <div style={{ width: `${lineWidth}%`, height: 3, background: colors.accent, boxShadow: `0 0 14px ${colors.accentGlow}` }} />
      <span
        style={{
          position: "relative",
          color: colors.ink,
          fontFamily: fonts.display,
          fontSize,
          letterSpacing,
          textTransform: "uppercase",
          textAlign: "center",
          whiteSpace: "pre-wrap",
          lineHeight: 1.05,
          textShadow: `0 0 46px ${colors.accentGlow}, 0 6px 20px rgba(0,0,0,0.95)`,
        }}
      >
        {text}
      </span>
      <div style={{ width: `${lineWidth}%`, height: 3, background: colors.accent, boxShadow: `0 0 14px ${colors.accentGlow}` }} />
    </div>
  );
};

export const InteractiveText: React.FC<Props> = ({ text, type, startFrame = 0, fontSize }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const localFrame = frame - startFrame;

  if (localFrame < 0) return null;

  const defaultSize = type === "normal" ? Math.round(width * 0.032) : Math.round(width * 0.05);
  const size = fontSize ?? defaultSize;

  if (type === "reveal") {
    return <GlitchText text={text} localFrame={localFrame} fontSize={size} />;
  }

  if (type === "hook") {
    const scale = spring({ frame: localFrame, fps: 30, config: { damping: 14, stiffness: 160 } });
    return (
      <div
        style={{
          fontFamily: fonts.display,
          fontSize: size,
          color: colors.ink,
          letterSpacing: 2,
          textTransform: "uppercase",
          textAlign: "center",
          textShadow: `0 4px 30px ${colors.accentGlow}, 0 2px 8px rgba(0,0,0,0.9)`,
          transform: `scale(${scale})`,
        }}
      >
        {text}
      </div>
    );
  }

  // Gentle fade + rise — a full-block reveal reads far easier than a
  // character-by-character typewriter when captions change every few seconds.
  // Delicate serif, regular weight: reads as documentary editorial rather
  // than a bold/loud sans caption.
  const opacity = interpolate(localFrame, [0, timing.captionFadeFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const translateY = interpolate(localFrame, [0, timing.captionFadeFrames], [10, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        fontFamily: fonts.subtitle,
        fontSize: size,
        fontWeight: 400,
        fontStyle: "normal",
        color: colors.ink,
        letterSpacing: 0.4,
        lineHeight: 1.45,
        textShadow: "0 1px 3px rgba(0,0,0,0.95), 0 2px 14px rgba(0,0,0,0.85)",
        whiteSpace: "pre-wrap",
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      {text}
    </div>
  );
};
