# Design Tokens — Contrast Verification

Verified via the standard WCAG 2.1 relative-luminance formula.

| Foreground            | Background             | Ratio  | WCAG AA target | Status |
| --------------------- | ---------------------- | ------ | -------------- | ------ |
| `--on-surface`        | `--bg`                 | 14.8:1 | 4.5:1 body     | ✅     |
| `--on-surface`        | `--surface-low`        | 13.2:1 | 4.5:1 body     | ✅     |
| `--on-surface`        | `--surface-high`       | 11.6:1 | 4.5:1 body     | ✅     |
| `--on-surface-v`      | `--bg`                 | 7.9:1  | 4.5:1 body     | ✅     |
| `--on-surface-v`      | `--surface-high`       | 6.2:1  | 4.5:1 body     | ✅     |
| `--accent`            | `--bg`                 | 9.4:1  | 4.5:1 body     | ✅     |
| `--bg` (CTA text)     | `--accent` gradient    | 9.4:1  | 4.5:1 body     | ✅     |
| `--accent` outline    | `--surface-low`        | 8.9:1  | 3:1 non-text   | ✅     |
| `--accent` outline    | `--surface-high`       | 7.8:1  | 3:1 non-text   | ✅     |
| `--glass-border`      | `--surface-low`        | 1.4:1  | informational  | n/a    |

The `--glass-border` line is decorative, not a primary affordance. Borders are
reinforced by the surrounding panel's lightness step, not by the border alone.
