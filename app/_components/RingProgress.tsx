import React from "react";
import type { ReactNode } from "react";

interface RingProgressProps {
  /** 0 → 1, mapped to stroke-dashoffset. */
  progress: number;
  /** Pixel diameter. Default 96. */
  size?: number;
  children?: ReactNode;
}

const CIRCUMFERENCE = 339.292;
const RADIUS = 54;
const VIEWBOX = 120;

/**
 * SVG ring progress indicator with an animated stroke-dashoffset.
 *
 * The track and arc circles are rendered inside an SVG rotated -90deg so
 * the arc starts at the 12-o'clock position. A drop-shadow filter on the
 * arc creates a subtle glow.
 */
export function RingProgress({
  progress,
  size = 96,
  children,
}: RingProgressProps) {
  const dashoffset = CIRCUMFERENCE * (1 - progress);

  return (
    <div
      className="ring-progress"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        style={{ transform: "rotate(-90deg)", width: "100%", height: "100%" }}
      >
        <circle
          cx={VIEWBOX / 2}
          cy={VIEWBOX / 2}
          r={RADIUS}
          className="ring-track"
        />
        <circle
          cx={VIEWBOX / 2}
          cy={VIEWBOX / 2}
          r={RADIUS}
          className="ring-arc"
          style={{ strokeDashoffset: dashoffset }}
        />
      </svg>
      {children ? (
        <span className="ring-center">{children}</span>
      ) : null}
    </div>
  );
}

export { CIRCUMFERENCE };
