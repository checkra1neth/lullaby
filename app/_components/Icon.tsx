import React from "react";

/**
 * Material Symbols Outlined icon wrapper.
 *
 * Renders a <span class="material-symbols-outlined"> with inline
 * font-variation-settings. When the font fails to load, the glyph name
 * renders as plain text in the system fallback font; the span keeps its
 * inline-block sizing so layout does not collapse.
 *
 * Req 5.2, 5.3, 5.5
 */
interface IconProps {
  /** Material Symbols Outlined glyph name, e.g. "bedtime", "auto_awesome". */
  name: string;
  /** Filled variant. Default false. */
  filled?: boolean;
  /** Variation weight, 100–700. Default 300. */
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700;
  /** Pixel size; sets font-size. Default 24. */
  size?: number;
  /** When omitted, the span is decorative (aria-hidden). */
  "aria-label"?: string;
  className?: string;
}

export function Icon({
  name,
  filled = false,
  weight = 300,
  size = 24,
  "aria-label": ariaLabel,
  className,
}: IconProps) {
  const style: React.CSSProperties = {
    fontSize: size,
    fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' ${weight}`,
  };

  if (ariaLabel) {
    return (
      <span
        className={`material-symbols-outlined ${className ?? ""}`}
        style={style}
        role="img"
        aria-label={ariaLabel}
      >
        {name}
      </span>
    );
  }

  return (
    <span
      className={`material-symbols-outlined ${className ?? ""}`}
      style={style}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
