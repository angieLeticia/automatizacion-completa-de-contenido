import rawChapters from "../data/chapters.json";

export type ChapterMark = {
  number: number;
  title: string;
  year: string;
  audioFile: string;
  // Measured once with ffprobe against public/assets/audio/{audioFile}.
  audioDurationSeconds: number;
  // Reveal points estimated proportionally from that chapter's own script
  // <break> tags against the measured audio duration. Update if a chapter's
  // audio is regenerated with a different pace.
  titleRevealSeconds: number;
  yearRevealSeconds: number;
};

export const chapters: ChapterMark[] = rawChapters as ChapterMark[];
