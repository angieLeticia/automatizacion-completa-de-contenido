export type ClipMark = {
  startFrame: number;
  endFrame: number;
  hookText: string;
  // Optional per-clip reframe for the 9:16 crop; defaults to "50% 50%".
  objectPosition?: string;
};
