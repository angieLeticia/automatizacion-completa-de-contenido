import { AbsoluteFill, Img, staticFile } from "remotion";

type Props = {
  size?: number;
  opacity?: number;
  margin?: number;
  // FASE 5.10-AP (Fase 3) — antes, la imagen estaba hardcodeada a
  // "assets/images/logo-sin-explicacion.png" sin ningún prop para
  // cambiarla. `imageSrc` es OPCIONAL con ese mismo valor exacto como
  // default (vía staticFile(), igual que antes) — todo llamador existente
  // (Intro.tsx, IntroLandscape.tsx, ChapterCard.tsx, ClosingCTA.tsx,
  // MainDocumentary.tsx/ShortClip.tsx a través de sus composiciones) sigue
  // sin pasar este prop, así que el comportamiento de SIN EXPLICACIÓN no
  // cambia ni un píxel. Ningún `if (channel === ...)` — el componente sigue
  // sin saber qué canal lo usa, solo recibe (o no) una ruta.
  imageSrc?: string;
};

// Persistent channel watermark, bottom-right, subtle enough not to compete
// with the reveal title. Sits above the footage, below the edge-fade so it
// still fades to black at the very start/end like everything else.
const DEFAULT_LOGO_SRC = staticFile("assets/images/logo-sin-explicacion.png");

export const Watermark: React.FC<Props> = ({ size = 100, opacity = 0.6, margin = 36, imageSrc = DEFAULT_LOGO_SRC }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <Img
      src={imageSrc}
      style={{ position: "absolute", right: margin, bottom: margin, width: size, height: size, opacity }}
    />
  </AbsoluteFill>
);
