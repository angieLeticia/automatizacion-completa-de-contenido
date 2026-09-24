import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";

// FASE 5.10-AP (Fase 3) — bumper corto de identidad de canal. NO incluye
// ningún logo gráfico — `logoSrc` es opcional y, si se omite (como será el
// caso hasta que exista un logo real de ENCIENDE EL CAOS), el bumper
// funciona igual mostrando solo el nombre del canal como texto. Nunca se
// fabrica un placeholder gráfico (PNG/SVG/ícono) — eso violaría la regla
// explícita de no inventar assets creativos todavía.
//
// `durationInFrames` es OBLIGATORIO (sin default) a propósito — el encargo
// pide explícitamente no fijar todavía una duración creativa definitiva; que
// el componente la exija como prop fuerza a quien lo use (Fase 4, o un test)
// a decidirla explícitamente cada vez, nunca a heredar un número inventado
// aquí.

export type ChannelBumperProps = {
  channelName: string;
  // Ruta ya resuelta (ej. vía staticFile()) a un logo real — OPCIONAL.
  // Sin logo real todavía, se omite y el bumper se apoya solo en texto.
  logoSrc?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  durationInFrames: number;
  startFrame?: number;
};

const DEFAULT_TEXT_COLOR = "#FFFFFF";
const DEFAULT_BACKGROUND = "#000000";

export const ChannelBumper: React.FC<ChannelBumperProps> = ({
  channelName,
  logoSrc,
  accentColor,
  backgroundColor = DEFAULT_BACKGROUND,
  textColor = DEFAULT_TEXT_COLOR,
  fontFamily,
  durationInFrames,
  startFrame = 0,
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - startFrame;
  if (localFrame < 0 || localFrame >= durationInFrames) return null;

  const FADE_FRAMES = Math.min(10, Math.floor(durationInFrames / 3));
  const opacity = interpolate(
    localFrame,
    [0, FADE_FRAMES, Math.max(durationInFrames - FADE_FRAMES, FADE_FRAMES), durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const scale = interpolate(localFrame, [0, FADE_FRAMES], [0.94, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor, justifyContent: "center", alignItems: "center", opacity }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, transform: `scale(${scale})` }}>
        {logoSrc && <Img src={logoSrc} style={{ maxWidth: "40%", maxHeight: 200, objectFit: "contain" }} />}
        <span
          style={{
            color: textColor,
            fontFamily,
            fontSize: 64,
            fontWeight: 800,
            letterSpacing: 4,
            textTransform: "uppercase",
            textAlign: "center",
          }}
        >
          {channelName}
        </span>
        {accentColor && <div style={{ width: 90, height: 5, backgroundColor: accentColor }} />}
      </div>
    </AbsoluteFill>
  );
};
