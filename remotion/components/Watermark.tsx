import { AbsoluteFill, Img, staticFile } from "remotion";

type Props = {
  size?: number;
  opacity?: number;
  margin?: number;
};

// Persistent channel watermark, bottom-right, subtle enough not to compete
// with the reveal title. Sits above the footage, below the edge-fade so it
// still fades to black at the very start/end like everything else.
export const Watermark: React.FC<Props> = ({ size = 100, opacity = 0.6, margin = 36 }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <Img
      src={staticFile("assets/images/logo-sin-explicacion.png")}
      style={{ position: "absolute", right: margin, bottom: margin, width: size, height: size, opacity }}
    />
  </AbsoluteFill>
);
