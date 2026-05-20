import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        "surface-lowest": "var(--surface-lowest)",
        "surface-low": "var(--surface-low)",
        "surface-high": "var(--surface-high)",
        "surface-highest": "var(--surface-highest)",
        "on-surface": "var(--on-surface)",
        "on-surface-v": "var(--on-surface-v)",
        accent: "var(--accent)",
        "accent-dim": "var(--accent-dim)",
        "accent-muted": "var(--accent-muted)",
        /* Legacy aliases so existing tests don't break */
        background: "var(--bg)",
        foreground: "var(--on-surface)",
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        sm: "var(--radius-sm)",
        pill: "var(--radius-pill)",
      },
      transitionTimingFunction: {
        emphasis: "var(--ease-emphasis)",
      },
      transitionDuration: {
        fast: "200ms",
        medium: "350ms",
        slow: "600ms",
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        body: ["var(--font-body)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
