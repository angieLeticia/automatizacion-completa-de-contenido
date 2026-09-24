import { AbsoluteFill, Sequence } from "remotion";
import { captionsInRange, secToFrames } from "../lib/captions";
import type { Caption } from "../lib/captions";
import { ChaosInteractiveText } from "./ChaosInteractiveText";

// FASE 5.10-AQ (Fase 4) — HALLAZGO REAL reportado, no un refactor
// silencioso: remotion/components/Captions.tsx (el componente histórico)
// delega el renderizado de cada línea en <InteractiveText>, que importa
// `colors`/`fonts` de "../theme" (SIN EXPLICACIÓN) de forma DIRECTA e
// INCONDICIONAL — reusar <Captions> tal cual en ChaosNewsMain habría hecho
// que cada caption se viera con la tipografía serif/colores de SIN
// EXPLICACIÓN, sin ninguna forma de inyectar el theme de ENCIENDE EL CAOS.
//
// Solución MÍNIMA y seguro elegida (sin tocar Captions.tsx/InteractiveText.tsx
// en absoluto — cero riesgo para SIN EXPLICACIÓN): este archivo reutiliza
// ÚNICAMENTE las piezas genéricas y ya verificadas sin acoplamiento de tema
// — `captionsInRange`/`secToFrames`/el tipo `Caption` (lib/captions.ts,
// puras, sin importar theme.ts) — y replica el mismo mecanismo de
// Sequence-por-caption que Captions.tsx ya usa, pero renderizando el texto
// con `ChaosInteractiveText` (Fase 3, identidad propia) en vez de
// `InteractiveText`. Mismo layout/posicionamiento conceptual, identidad
// visual 100% inyectada por props.
type Props = {
  captions: Caption[];
  rangeStart: number;
  rangeEnd: number;
  fontFamily: string;
  color?: string;
  accentColor?: string;
  variant?: "main" | "clip"; // equivalente a "documentary"/"short" de Captions.tsx, sin reusar esos nombres
};

export const ChaosCaptions: React.FC<Props> = ({ captions, rangeStart, rangeEnd, fontFamily, color, accentColor, variant = "main" }) => {
  const active = captionsInRange(captions, rangeStart, rangeEnd);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: variant === "clip" ? 220 : 110,
        paddingLeft: variant === "clip" ? 48 : 160,
        paddingRight: variant === "clip" ? 48 : 160,
        pointerEvents: "none",
      }}
    >
      {active.map((caption) => {
        const cStart = secToFrames(caption.start);
        const cEnd = secToFrames(caption.end);
        const from = Math.max(cStart, rangeStart) - rangeStart;
        const durationInFrames = Math.min(cEnd, rangeEnd) - Math.max(cStart, rangeStart);
        if (durationInFrames <= 0) return null;

        return (
          <Sequence key={`${cStart}-${caption.text}`} from={from} durationInFrames={durationInFrames} layout="none">
            <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center" }}>
              <div
                style={{
                  textAlign: "center",
                  background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 40%, rgba(0,0,0,0.6) 100%)",
                  padding: variant === "clip" ? "18px 28px" : "12px 30px",
                  borderRadius: 8,
                  maxWidth: variant === "clip" ? "100%" : "80%",
                }}
              >
                <ChaosInteractiveText
                  text={caption.text}
                  variant={caption.type === "reveal" ? "impact" : caption.type === "hook" ? "headline" : "emphasis"}
                  fontFamily={fontFamily}
                  color={color}
                  accentColor={accentColor}
                  fontSize={variant === "clip" ? 48 : undefined}
                />
              </div>
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
