# Animation Catalog

## Named Animations

| Name          | Duration                | Easing                         | Trigger                    | Used by                              |
| ------------- | ----------------------- | ------------------------------ | -------------------------- | ------------------------------------ |
| `fadeUp`      | `var(--motion-medium)`  | `var(--ease-emphasis)`         | Page/section mount         | Marketing hero, create form, order status, library cards, sign-in |
| `fadeIn`      | `var(--motion-medium)`  | `var(--ease-emphasis)`         | Element mount              | Reserved for future use              |
| `floatEmoji`  | `3s`                    | `ease-in-out`                  | Decorative idle          | Reserved for future use              |
| `pvPulse`     | `2s`                    | `ease-in-out`                  | Preview active state       | Reserved for future use              |
| `spin`        | `0.7s`                  | `linear`                       | Active step spinner      | StepCard (active state)              |
| ring-progress | `var(--motion-slow)`    | `var(--ease-emphasis)`         | Status poll update         | RingProgress stroke-dashoffset       |
| mood-bg       | `var(--motion-mood)`    | `var(--ease-emphasis)`         | Mood selection             | MoodAwareBackground background       |
| cta-glow      | `var(--motion-medium)`  | `var(--ease-emphasis)`         | Pointer hover              | CtaButton outer glow opacity         |
| card-hover    | `var(--motion-fast)`    | `var(--ease-emphasis)`         | Pointer hover              | Price card translateY + border       |
| step-card     | `var(--motion-medium)`  | `var(--ease-emphasis)`         | Status transition          | StepCard entrance + stagger          |

## Stagger Pattern

Stagger is implemented via an inline CSS custom property `--index` set by the
parent and consumed by `animation-delay: calc(var(--index) * Nms)`.
No JS timers are used.

| Surface        | Delay increment | Pages                 |
| -------------- | --------------- | --------------------- |
| Hero elements  | 80 ms           | Marketing landing     |
| Step cards     | 120 ms          | Order status          |
| Library cards  | 80 ms           | Library               |
| Player panels  | 180 ms          | Order status          |

## Non-Decorative Motion That Survives Reduced-Motion

The following indicators remain visible even when `prefers-reduced-motion: reduce`
is active, but their decorative motion is removed:

- `aria-busy="true"` on the polling progressbar ( Req 10.5, 24.3 )
- Static `hourglass_top` glyph replacing the animated spinner (Req 16.4)
- "In progress" text label on active step cards (Req 10.6)

## Font-Display Escape Hatch

The default font-display strategy for Material Symbols Outlined is `display=block`
as specified in Req 19.4. If a page swaps to `display=swap` to chase LCP, the
choice must be recorded here and the page must already meet the CLS ≤ 0.05
and LCP ≤ 2500 ms budgets.
