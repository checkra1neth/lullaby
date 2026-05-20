import React from "react";
import { Icon } from "./Icon";

interface StepCardProps {
  iconName: string;
  label: string;
  state: "pending" | "active" | "done";
  /** Stagger index — drives animation-delay via CSS custom property. */
  index?: number;
}

/**
 * Pill-shaped step card used in the order-status polling surface.
 *
 * States:
 *   - `pending`  → icon-circle uses default surface-high background.
 *   - `active`   → icon-circle uses surface-highest; shows a spinner
 *                   (replaced by `hourglass_top` under reduced-motion).
 *   - `done`     → icon-circle fills with accent colour; shows a check mark.
 */
export function StepCard({ iconName, label, state, index = 0 }: StepCardProps) {
  return (
    <li
      className="glass-panel step-card"
      data-state={state}
      style={{ "--index": index } as React.CSSProperties}
    >
      <div className="step-icon-circle">
        <Icon name={iconName} filled={state === "done"} size={20} />
      </div>
      <div className="flex flex-1 flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="step-badge">
          {state === "pending" && "Up next"}
          {state === "active" && "In progress"}
          {state === "done" && "Done"}
        </span>
      </div>
      <div className="flex items-center">
        {state === "active" && <span className="step-spinner" aria-hidden="true" />}
        {state === "done" && (
          <svg
            className="step-check"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3 8.5L6.5 12L13 5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </li>
  );
}
