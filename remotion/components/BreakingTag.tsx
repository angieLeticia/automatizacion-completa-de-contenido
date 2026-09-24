import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

// FASE 5.10-AP (Fase 3) — etiqueta reutilizable ("ÚLTIMA HORA", "EXCLUSIVO",
// etc.). El texto es SIEMPRE un dato (prop), nunca una lista incrustada en
// el componente — los 8 textos de ejemplo del encargo (ÚLTIMA HORA,
// EXCLUSIVO, SE ENCENDIÓ EL CAOS, ATENCIÓN, LO QUE SE SABE, PERO HAY MÁS...,
// ¿QUÉ PASÓ?, NUEVO GIRO) NO están hardcodeados en ningún lado de este
// archivo — los pasa quien use el componente (Fase 4).

export type BreakingTagPosition = "top-left" | "top-right" | "top-center" | "bottom-left" | "bottom-right" | "bottom-center";
export type BreakingTagVariant = "solid" | "outline";

export type BreakingTagProps = {
  text: string;
  color?: string; // color del texto (variant="solid") o del texto+borde (variant="outline"). Default blanco neutro.
  backgroundColor?: string; // solo aplica a variant="solid". Default rojo genérico neutro — el llamador pasa el color real del theme.
  fontFamily?: string; // sin default de marca — si se omite, hereda la fuente del sistema
  position?: BreakingTagPosition;
  variant?: BreakingTagVariant;
  fontSize?: number;
  // Frame relativo de entrada.
  startFrame?: number;
  // Si se define, la etiqueta hace fade/slide de salida al llegar a este frame relativo — si se omite, queda visible indefinidamente una vez entra.
  durationInFrames?: number;
};

const POSITION_STYLE: Record<BreakingTagPosition, React.CSSProperties> = {
  "top-left": { top: 48, left: 48, alignItems: "flex-start" },
  "top-right": { top: 48, right: 48, alignItems: "flex-end" },
  "top-center": { top: 48, left: 0, right: 0, alignItems: "center" },
  "bottom-left": { bottom: 48, left: 48, alignItems: "flex-start" },
  "bottom-right": { bottom: 48, right: 48, alignItems: "flex-end" },
  "bottom-center": { bottom: 48, left: 0, right: 0, alignItems: "center" },
};

const DEFAULT_COLOR = "#FFFFFF";
const DEFAULT_BACKGROUND = "#B00020"; // rojo genérico neutro — NO el rojo aprobado de ningún canal, solo un fallback funcional

const SLIDE_FRAMES = 10;

export const BreakingTag: React.FC<BreakingTagProps> = ({
  text,
  color = DEFAULT_COLOR,
  backgroundColor = DEFAULT_BACKGROUND,
  fontFamily,
  position = "top-left",
  variant = "solid",
  fontSize = 28,
  startFrame = 0,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - startFrame;
  if (localFrame < 0) return null;
  if (durationInFrames !== undefined && localFrame >= durationInFrames) return null;

  const isLeft = position.includes("left");
  const isRight = position.includes("right");
  const slideFrom = isLeft ? -60 : isRight ? 60 : 0;

  const entryProgress = interpolate(localFrame, [0, SLIDE_FRAMES], [0, 1], { extrapolateRight: "clamp" });
  const exitProgress =
    durationInFrames !== undefined
      ? interpolate(localFrame, [Math.max(durationInFrames - SLIDE_FRAMES, 0), durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : 1;
  const progress = Math.min(entryProgress, exitProgress);

  const translateX = interpolate(progress, [0, 1], [slideFrom, 0]);
  const opacity = interpolate(progress, [0, 1], [0, 1]);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", display: "flex", flexDirection: "column", ...POSITION_STYLE[position] }}>
        <div
          style={{
            opacity,
            transform: `translateX(${translateX}px)`,
            padding: "10px 22px",
            borderRadius: 4,
            backgroundColor: variant === "solid" ? backgroundColor : "transparent",
            border: variant === "outline" ? `2px solid ${color}` : "none",
          }}
        >
          <span
            style={{
              color,
              fontFamily,
              fontSize,
              fontWeight: 800,
              letterSpacing: 2,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            {text}
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
