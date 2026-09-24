import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

// FASE 5.10-AP (Fase 3 — componentes de ENCIENDE EL CAOS) — texto animado
// con identidad PROPIA, deliberadamente distinta de
// remotion/components/InteractiveText.tsx::GlitchText (esa es la firma
// visual de SIN EXPLICACIÓN: spring lento damping=11/stiffness=80, glow
// radial difuminado, líneas que se abren despacio — un "reveal" dramático).
// Esta identidad es la opuesta a propósito: entrada RÁPIDA y seca (spring
// stiffness alto, sin blur), una barra de acento SÓLIDA (no un glow
// difuminado) y, opcionalmente, un flash breve de un solo frame para la
// sensación de "breaking news"/cámara de prensa — nunca ruido visual
// constante (regla del canal: "rapidez + tensión + claridad", NO "glitch
// permanente"). Cero referencia al nombre de ningún canal — todo llega por
// props, con defaults neutros (blanco, sans-serif), nunca colores/fuentes
// de SIN EXPLICACIÓN.

export type ChaosTextVariant = "headline" | "impact" | "emphasis";

export type ChaosInteractiveTextProps = {
  text: string;
  // "headline" = titular grande con barra de acento; "impact" = palabra de
  // impacto aún más grande, sin barra, con flash de entrada; "emphasis" =
  // texto secundario, entrada más sutil, sin flash.
  variant?: ChaosTextVariant;
  fontFamily: string; // sin default — el llamador SIEMPRE pasa la fuente del theme del canal (Anton/Montserrat u otra)
  color?: string; // default neutro (blanco) — el llamador pasa el color real del theme
  accentColor?: string; // color de la barra/flash — default = `color`
  fontSize?: number;
  fontWeight?: number | string;
  align?: "left" | "center" | "right";
  // Frame (relativo al Sequence que envuelve a este componente) en el que
  // arranca la animación de entrada — mismo patrón que InteractiveText.
  startFrame?: number;
  // Intensidad del golpe de entrada (overshoot/flash), 0-1. Default 1.
  intensity?: number;
};

const DEFAULT_COLOR = "#FFFFFF";

export const ChaosInteractiveText: React.FC<ChaosInteractiveTextProps> = ({
  text,
  variant = "headline",
  fontFamily,
  color = DEFAULT_COLOR,
  accentColor,
  fontSize,
  fontWeight = 800,
  align = "center",
  startFrame = 0,
  intensity = 1,
}) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const localFrame = frame - startFrame;
  if (localFrame < 0) return null;

  const resolvedAccent = accentColor ?? color;
  const defaultSize = variant === "impact" ? Math.round(width * 0.075) : variant === "emphasis" ? Math.round(width * 0.03) : Math.round(width * 0.05);
  const size = fontSize ?? defaultSize;

  // Entrada rápida y seca — a propósito MUY distinta del spring lento de
  // GlitchText (damping 11/stiffness 80): aquí stiffness alto + damping
  // alto = asienta en ~8-10 frames, sin rebote dramático, sensación de
  // "golpe" en vez de "revelación".
  const entrance = spring({ frame: localFrame, fps: 30, config: { damping: 18, stiffness: 260, mass: 0.4 } });
  const translateX = interpolate(entrance, [0, 1], [align === "left" ? -40 : align === "right" ? 40 : 0, 0]);
  const translateY = interpolate(entrance, [0, 1], [14 * intensity, 0]);
  const opacity = interpolate(localFrame, [0, 6], [0, 1], { extrapolateRight: "clamp" });

  // Flash breve de un solo golpe (nunca ruido constante) — solo en las
  // variantes que lo piden. Barra sólida (nunca un glow difuminado tipo
  // GlitchText) para "impact"/"headline".
  const flashOpacity =
    variant !== "emphasis"
      ? interpolate(localFrame, [0, 2, 6], [0.85 * intensity, 0.85 * intensity, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : 0;
  const barWidth = variant === "headline" ? interpolate(entrance, [0, 1], [0, 100]) : 0;

  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        flexDirection: "column",
        alignItems: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
        gap: 14,
        maxWidth: "90%",
        opacity,
        transform: `translate(${translateX}px, ${translateY}px)`,
      }}
    >
      {flashOpacity > 0 && (
        <div
          style={{
            position: "absolute",
            inset: "-12% -6%",
            backgroundColor: resolvedAccent,
            opacity: flashOpacity,
            mixBlendMode: "screen",
            pointerEvents: "none",
          }}
        />
      )}
      {variant === "headline" && (
        <div style={{ width: `${barWidth}%`, height: 6, backgroundColor: resolvedAccent }} />
      )}
      <span
        style={{
          position: "relative",
          color,
          fontFamily,
          fontWeight,
          fontSize: size,
          textTransform: variant === "emphasis" ? "none" : "uppercase",
          textAlign: align,
          whiteSpace: "pre-wrap",
          lineHeight: 1.05,
          letterSpacing: variant === "impact" ? -1 : 0,
          textShadow: "0 4px 18px rgba(0,0,0,0.85)",
        }}
      >
        {text}
      </span>
    </div>
  );
};
