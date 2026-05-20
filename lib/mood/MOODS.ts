export type Mood = "calm" | "dreamy" | "cozy" | "playful" | "gentle" | "default";

export interface MoodHsl {
  h: number;
  s: number;
  l: number;
}

export const MOODS: Record<Mood, MoodHsl> = {
  default: { h: 245, s: 55, l: 70 },
  calm: { h: 220, s: 60, l: 70 },
  dreamy: { h: 270, s: 55, l: 72 },
  cozy: { h: 30, s: 65, l: 70 },
  playful: { h: 340, s: 60, l: 72 },
  gentle: { h: 180, s: 45, l: 70 },
};
