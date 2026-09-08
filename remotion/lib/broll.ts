import { FPS } from "../theme";

// Static metadata for an episode's raw stock clips in /public/assets/video.
// (duration/dimensions read once with ffprobe — these files don't change at runtime)
export type SourceVideo = {
  kind: "video";
  file: string; // relative to /public/assets/video/ — may include a subfolder, e.g. "003/clip.mp4"
  durationSec: number;
  width: number;
  height: number;
};

// Stills in /public/assets/images get a Ken Burns pan/zoom instead of playback.
export type SourceImage = {
  kind: "image";
  file: string; // relative to /public/assets/images/ — may include a subfolder
  width: number;
  height: number;
};

export type VisualPool = {
  videoPool: SourceVideo[];
  imagePool: SourceImage[];
};

export type Shot =
  | {
      kind: "video";
      key: string;
      file: string;
      timelineStart: number;
      timelineEnd: number;
      sourceStartFrom: number;
    }
  | {
      kind: "image";
      key: string;
      file: string;
      timelineStart: number;
      timelineEnd: number;
      kenBurnsVariant: number; // 0-3, picks zoom/pan direction
    };

export type ReelOptions = {
  videoShotSeconds?: number;
  imageShotSeconds?: number;
  // How many image shots play for every video shot. Episodes with only a
  // couple of video clips (not enough to avoid heavy repetition) should bias
  // this toward images, which usually have more variety. Default 1 (strict
  // alternation, motion/still/motion/still...).
  imagesPerVideo?: number;
};

const DEFAULT_VIDEO_SHOT_SECONDS = 6;
const DEFAULT_IMAGE_SHOT_SECONDS = 4.5;

/**
 * Builds a repeating reel covering [0, totalFrames), cycling between the
 * video pool and the image pool (motion, still, motion, still... or biased
 * toward stills via imagesPerVideo) so the edit keeps changing rhythm instead
 * of looping the same handful of clips back to back. Each pass over a video
 * alternates which portion of it is used (start vs. middle); each pass over
 * an image alternates its Ken Burns direction.
 */
export const buildReel = (pool: VisualPool, totalFrames: number, opts: ReelOptions = {}): Shot[] => {
  const { videoPool, imagePool } = pool;
  const videoShotSeconds = opts.videoShotSeconds ?? DEFAULT_VIDEO_SHOT_SECONDS;
  const imageShotSeconds = opts.imageShotSeconds ?? DEFAULT_IMAGE_SHOT_SECONDS;
  const imagesPerVideo = Math.max(1, opts.imagesPerVideo ?? 1);

  const shots: Shot[] = [];
  const videoPlayCount = new Map<number, number>();
  const imagePlayCount = new Map<number, number>();

  let t = 0;
  let videoIndex = 0;
  let imageIndex = 0;
  let imagesSinceVideo = 0;
  let useVideo = videoPool.length > 0;

  while (t < totalFrames) {
    if (useVideo || imagePool.length === 0) {
      const video = videoPool[videoIndex % videoPool.length];
      const sourceTotalFrames = Math.floor(video.durationSec * FPS);
      const len = Math.min(videoShotSeconds * FPS, sourceTotalFrames, totalFrames - t);
      const passes = videoPlayCount.get(videoIndex) ?? 0;
      const maxStart = Math.max(sourceTotalFrames - len, 0);
      const sourceStartFrom = passes % 2 === 0 ? 0 : Math.floor(maxStart / 2);
      videoPlayCount.set(videoIndex, passes + 1);

      shots.push({
        kind: "video",
        key: `${video.file}-${t}`,
        file: video.file,
        timelineStart: t,
        timelineEnd: t + len,
        sourceStartFrom,
      });

      t += len;
      videoIndex += 1;
      imagesSinceVideo = 0;
    } else {
      const image = imagePool[imageIndex % imagePool.length];
      const len = Math.min(imageShotSeconds * FPS, totalFrames - t);
      const passes = imagePlayCount.get(imageIndex) ?? 0;
      imagePlayCount.set(imageIndex, passes + 1);

      shots.push({
        kind: "image",
        key: `${image.file}-${t}`,
        file: image.file,
        timelineStart: t,
        timelineEnd: t + len,
        kenBurnsVariant: passes % 4,
      });

      t += len;
      imageIndex += 1;
      imagesSinceVideo += 1;
    }

    if (videoPool.length === 0) {
      useVideo = false;
    } else if (imagePool.length === 0) {
      useVideo = true;
    } else if (useVideo) {
      useVideo = false;
    } else {
      useVideo = imagesSinceVideo >= imagesPerVideo;
    }
  }

  return shots;
};

// Shots overlapping the given absolute frame range [startFrame, endFrame).
export const shotsInRange = (shots: Shot[], startFrame: number, endFrame: number): Shot[] => {
  return shots.filter((s) => s.timelineEnd > startFrame && s.timelineStart < endFrame);
};
