// A fade-in/hold/fade-out trapezoid that never crashes on short durations.
// remotion's interpolate() requires a strictly increasing input range, which
// breaks whenever a clipped Sequence ends up shorter than 2x the fade window
// (common for the last B-roll shot inside a short clip's range, or a caption
// truncated right at a clip boundary). This shrinks the fade proportionally
// instead of producing duplicate keyframes.
export const fadeEnvelope = (
  frame: number,
  durationInFrames: number,
  fadeFrames: number,
  peak = 1,
): number => {
  if (durationInFrames <= 0) return 0;
  const fade = Math.max(0, Math.min(fadeFrames, Math.floor(durationInFrames / 2)));
  if (fade <= 0) return frame >= 0 && frame < durationInFrames ? peak : 0;
  if (frame <= 0) return 0;
  if (frame < fade) return (frame / fade) * peak;
  if (frame >= durationInFrames) return 0;
  if (frame > durationInFrames - fade) return Math.max(0, ((durationInFrames - frame) / fade) * peak);
  return peak;
};
