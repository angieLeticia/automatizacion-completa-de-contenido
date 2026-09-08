import { AbsoluteFill, Sequence } from "remotion";
import { captionsInRange, secToFrames } from "../lib/captions";
import type { Caption } from "../lib/captions";
import { InteractiveText } from "./InteractiveText";

type Props = {
  captions: Caption[];
  rangeStart: number;
  rangeEnd: number;
  /** Position on screen; ShortClip pins subtitles low and large per the spec. */
  variant?: "documentary" | "short";
};

// Renders whichever caption cues overlap [rangeStart, rangeEnd) of the main
// timeline. Shared by MainDocumentary and every ShortClip.
export const Captions: React.FC<Props> = ({ captions, rangeStart, rangeEnd, variant = "documentary" }) => {
  const active = captionsInRange(captions, rangeStart, rangeEnd);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: variant === "short" ? 220 : 110,
        paddingLeft: variant === "short" ? 48 : 160,
        paddingRight: variant === "short" ? 48 : 160,
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
                  padding: variant === "short" ? "18px 28px" : "12px 30px",
                  borderRadius: 8,
                  maxWidth: variant === "short" ? "100%" : "80%",
                }}
              >
                <InteractiveText
                  text={caption.text}
                  type={caption.type}
                  fontSize={variant === "short" ? 56 : undefined}
                />
              </div>
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
