import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

// FASE 5.10-AP (Fase 3) — efectos visuales propios de ENCIENDE EL CAOS.
// Deliberadamente NO reutiliza remotion/components/FilmEffects.tsx (ese
// componente hardcodea `colors.vignette` de SIN EXPLICACIÓN y aplica un
// filtro SVG feTurbulence de grano fílmico fijo, pensado para su estética
// documental) — este archivo es una implementación NUEVA e independiente,
// que solo se INSPIRA en el patrón general (AbsoluteFill + radial-gradient
// para viñeta), nunca importa ni modifica el componente histórico.
//
// Regla explícita del encargo: "rapidez + tensión + claridad", NUNCA "ruido
// visual constante" — por eso este componente NO tiene grano/glitch
// permanente. Solo dos efectos, ambos opcionales y de intensidad
// configurable: (1) viñeta estática (sutileza de foco, siempre presente si
// se activa) y (2) flashes breves y puntuales en frames específicos
// (`cutFrames`, ej. los cortes de plano del B-roll) — nunca automáticos ni
// continuos, el llamador decide exactamente cuándo ocurren.

export type ChaosFilmEffectsProps = {
  vignetteColor?: string; // color base de la viñeta (normalmente el negro profundo del canal)
  vignetteIntensity?: number; // 0-1, opacidad máxima de la viñeta en el borde. Default 0 (sin viñeta) — nunca se activa sola sin que el llamador lo pida
  // Frames (relativos al Sequence que envuelve a este componente) donde debe
  // ocurrir un flash breve — ej. los timelineStart de los cortes de B-roll.
  // Vacío por default: sin flashes salvo que el llamador los pida.
  cutFrames?: number[];
  flashColor?: string;
  flashIntensity?: number; // 0-1, opacidad pico del flash. Default 0.5
  flashDurationFrames?: number; // Default 5 — deliberadamente corto, un "golpe", nunca un fundido largo
};

const DEFAULT_VIGNETTE_COLOR = "rgba(0,0,0,0.8)";
const DEFAULT_FLASH_COLOR = "#FFFFFF";
const DEFAULT_FLASH_INTENSITY = 0.5;
const DEFAULT_FLASH_DURATION = 5;

export const ChaosFilmEffects: React.FC<ChaosFilmEffectsProps> = ({
  vignetteColor = DEFAULT_VIGNETTE_COLOR,
  vignetteIntensity = 0,
  cutFrames = [],
  flashColor = DEFAULT_FLASH_COLOR,
  flashIntensity = DEFAULT_FLASH_INTENSITY,
  flashDurationFrames = DEFAULT_FLASH_DURATION,
}) => {
  const frame = useCurrentFrame();

  // El flash activo (si lo hay) es el de la ÚLTIMA marca de corte cuyo
  // rango [cutFrame, cutFrame + flashDurationFrames) contiene el frame
  // actual — nunca se acumulan/mezclan dos flashes solapados.
  const activeCut = [...cutFrames].reverse().find((c) => frame >= c && frame < c + flashDurationFrames);
  const flashOpacity =
    activeCut !== undefined
      ? interpolate(frame - activeCut, [0, 1, flashDurationFrames], [0, flashIntensity, 0], { extrapolateRight: "clamp" })
      : 0;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {vignetteIntensity > 0 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, ${vignetteColor} 120%)`,
            opacity: vignetteIntensity,
          }}
        />
      )}
      {flashOpacity > 0 && (
        <AbsoluteFill style={{ backgroundColor: flashColor, opacity: flashOpacity, mixBlendMode: "screen" }} />
      )}
    </AbsoluteFill>
  );
};
