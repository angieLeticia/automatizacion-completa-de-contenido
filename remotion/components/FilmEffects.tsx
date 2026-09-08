import { AbsoluteFill } from "remotion";
import { colors } from "../theme";

// Vignette + procedural film grain (SVG feTurbulence — no noise.png asset needed).
// A single static overlay; the grain is a still texture rather than animated per
// frame to avoid a new noise seed flickering on every render.
export const FilmEffects: React.FC = () => {
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, ${colors.vignette} 115%)`,
        }}
      />
      <svg width="0" height="0">
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </svg>
      <AbsoluteFill
        style={{
          filter: "url(#grain)",
          opacity: 0.05,
          mixBlendMode: "overlay",
        }}
      />
    </AbsoluteFill>
  );
};
