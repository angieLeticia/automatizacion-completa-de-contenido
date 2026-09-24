import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame } from "remotion";

// FASE 5.10-AP (Fase 3) — tarjeta de hook inicial de ENCIENDE EL CAOS.
// Independiente del `HookCard` privado (no exportado) que ya vive dentro de
// remotion/ShortClip.tsx — ese usa InteractiveText/GlitchText (identidad de
// SIN EXPLICACIÓN) y un fade simple; este es un componente propio,
// exportado y reutilizable, con su propia entrada (spring rápido, mismo
// lenguaje que ChaosInteractiveText) y capaz de recibir una imagen de fondo
// opcional cuando exista material real (`imageSrc`, sin valor por defecto —
// nunca se inventa una imagen).
//
// El contenido del hook (la frase de impacto) SIEMPRE llega por props —
// este archivo no contiene ningún hook de episodio real.

export type HookCardProps = {
  text: string;
  durationInFrames: number; // obligatorio — el hold real depende del guion/episodio, no se inventa aquí
  fontFamily?: string;
  color?: string;
  backgroundColor?: string; // fondo sólido si no hay imageSrc
  accentColor?: string;
  imageSrc?: string; // opcional — sin imagen real todavía, se omite
  startFrame?: number;
};

const DEFAULT_COLOR = "#FFFFFF";
const DEFAULT_BACKGROUND = "#000000";
const ENTER_FRAMES = 10;

export const HookCard: React.FC<HookCardProps> = ({
  text,
  durationInFrames,
  fontFamily,
  color = DEFAULT_COLOR,
  backgroundColor = DEFAULT_BACKGROUND,
  accentColor,
  imageSrc,
  startFrame = 0,
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - startFrame;
  if (localFrame < 0 || localFrame >= durationInFrames) return null;

  const exitStart = Math.max(durationInFrames - ENTER_FRAMES, ENTER_FRAMES);
  const opacity = interpolate(localFrame, [0, ENTER_FRAMES, exitStart, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const entrance = spring({ frame: localFrame, fps: 30, config: { damping: 16, stiffness: 220, mass: 0.5 } });
  const scale = interpolate(entrance, [0, 1], [0.9, 1]);

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity }}>
      {imageSrc ? (
        <AbsoluteFill>
          <Img src={imageSrc} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.65) 100%)" }} />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ backgroundColor }} />
      )}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 18, transform: `scale(${scale})`, padding: "0 8%" }}>
        {accentColor && <div style={{ width: 70, height: 5, backgroundColor: accentColor }} />}
        <span
          style={{
            fontFamily,
            fontSize: 88,
            fontWeight: 800,
            color,
            textAlign: "center",
            textTransform: "uppercase",
            lineHeight: 1.08,
            textShadow: "0 6px 24px rgba(0,0,0,0.9)",
          }}
        >
          {text}
        </span>
      </div>
    </AbsoluteFill>
  );
};
