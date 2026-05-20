import { MOODS, type Mood } from "./MOODS";

/**
 * Apply a mood to the document root by mutating the CSS custom properties
 * `--mood-h`, `--mood-s`, `--mood-l`. The MoodAwareBackground reads these
 * variables and transitions its radial gradient.
 *
 * Runs synchronously so the transition starts within the same tick as the
 * click event (well under the 50 ms ceiling in Req 3.3).
 */
export function applyMood(mood: Mood): void {
  const root = document.documentElement;
  const { h, s, l } = MOODS[mood];
  root.style.setProperty("--mood-h", String(h));
  root.style.setProperty("--mood-s", `${s}%`);
  root.style.setProperty("--mood-l", `${l}%`);
}

/**
 * Read the current mood variables from `:root` and parse them back to numbers.
 */
export function readMoodVars(): { h: number; s: number; l: number } {
  const cs = getComputedStyle(document.documentElement);
  return {
    h: Number(cs.getPropertyValue("--mood-h").trim()),
    s: Number(cs.getPropertyValue("--mood-s").trim().replace("%", "")),
    l: Number(cs.getPropertyValue("--mood-l").trim().replace("%", "")),
  };
}
