import React, { forwardRef, type ElementType, type ReactNode } from "react";

/**
 * GlassPanel — reusable glassmorphic container.
 *
 * Props:
 *   - `as` — Element tag, defaults to `<div>`. Use "section" / "article" /
 *     "aside" for landmarks.
 *   - `className` — Additional Tailwind classes merged after `.glass-panel`.
 *   - `role` — Optional ARIA role passed straight through.
 *   - `aria-label` — When the panel acts as a labelled landmark.
 *   - `children`
 *
 * Fallback behaviour (Req 2.4):
 *   The `.glass-panel` CSS utility includes an `@supports not (backdrop-filter)`
 *   block that falls back to `background: var(--surface-high)` on browsers
 *   without backdrop-filter (e.g. Safari ≤ 13, embedded webviews).
 *
 * Accessibility:
 *   When used as a landmark, pass `as="section"` and `aria-label` so screen
 *   readers announce the region.
 */
interface GlassPanelProps {
  as?: ElementType;
  className?: string;
  role?: string;
  "aria-label"?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}

export const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(
  function GlassPanel(
    { as: Component = "div", className, role, "aria-label": ariaLabel, style, children },
    ref,
  ) {
    return (
      <Component
        ref={ref as React.Ref<never>}
        className={`glass-panel ${className ?? ""}`.trim()}
        role={role}
        aria-label={ariaLabel}
        style={style}
      >
        {children}
      </Component>
    );
  },
);
