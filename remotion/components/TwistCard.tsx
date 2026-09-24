import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

// FASE 5.10-AP (Fase 3) — tarjeta de giro/revelación/"pero hay más". Sin
// copy obligatorio: `title` es el único texto requerido, todo lo demás es
// opcional. Soporta `displayMode="fullscreen"|"overlay"` como pidió el
// encargo, implementado de forma concreta (no solo documentado como
// limitación) porque la arquitectura real (AbsoluteFill + estilos
// condicionales) lo permite sin complejidad extra.

export type TwistCardDisplayMode = "fullscreen" | "overlay";
export type TwistCardVariant = "twist" | "reveal" | "update";

export type TwistCardProps = {
  title: string;
  text?: string;
  displayMode?: TwistCardDisplayMode;
  variant?: TwistCardVariant;
  accentColor?: string;
  backgroundColor?: string; // solo tiene efecto visual completo en displayMode="fullscreen"
  titleFontFamily?: string;
  textFontFamily?: string;
  textColor?: string;
  durationInFrames: number; // obligatorio, sin duración creativa por defecto
  startFrame?: number;
};

const DEFAULT_ACCENT = "#FFFFFF";
const DEFAULT_BACKGROUND = "#000000";
const DEFAULT_TEXT_COLOR = "#FFFFFF";
const ENTER_FRAMES = 12;

export const TwistCard: React.FC<TwistCardProps> = ({
  title,
  text,
  displayMode = "overlay",
  variant = "twist",
  accentColor = DEFAULT_ACCENT,
  backgroundColor = DEFAULT_BACKGROUND,
  titleFontFamily,
  textFontFamily,
  textColor = DEFAULT_TEXT_COLOR,
  durationInFrames,
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
  const translateY = interpolate(localFrame, [0, ENTER_FRAMES], [24, 0], { extrapolateRight: "clamp" });

  // `variant` controla intensidad/tratamiento del acento — "twist"/"update"
  // usan una barra lateral; "reveal" usa el acento como color de fondo del
  // título (más contraste, para giros grandes). Ninguno usa glitch/ruido.
  const titleBlock = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: displayMode === "fullscreen" ? "80%" : "70%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {variant !== "reveal" && <div style={{ width: 6, height: 44, backgroundColor: accentColor, flexShrink: 0 }} />}
        <span
          style={{
            fontFamily: titleFontFamily,
            fontSize: displayMode === "fullscreen" ? 72 : 44,
            fontWeight: 800,
            textTransform: "uppercase",
            lineHeight: 1.1,
            color: variant === "reveal" ? backgroundColor : textColor,
            backgroundColor: variant === "reveal" ? accentColor : "transparent",
            padding: variant === "reveal" ? "6px 14px" : 0,
            display: "inline-block",
          }}
        >
          {title}
        </span>
      </div>
      {text && (
        <span style={{ fontFamily: textFontFamily, fontSize: displayMode === "fullscreen" ? 32 : 24, color: textColor, opacity: 0.92, paddingLeft: variant !== "reveal" ? 20 : 0 }}>
          {text}
        </span>
      )}
    </div>
  );

  if (displayMode === "fullscreen") {
    return (
      <AbsoluteFill style={{ backgroundColor, justifyContent: "center", alignItems: "center", opacity }}>
        <div style={{ transform: `translateY(${translateY}px)` }}>{titleBlock}</div>
      </AbsoluteFill>
    );
  }

  // overlay: no cubre todo el frame — un panel flotante sobre el contenido
  // existente, con su propio fondo semitransparente detrás del texto.
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-start", padding: "0 0 10% 6%", pointerEvents: "none" }}>
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          background: "rgba(0,0,0,0.72)",
          borderRadius: 10,
          padding: "20px 28px",
        }}
      >
        {titleBlock}
      </div>
    </AbsoluteFill>
  );
};
