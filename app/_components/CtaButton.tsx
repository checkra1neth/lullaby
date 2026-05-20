"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { KeyboardEvent, ReactNode } from "react";
import { Icon } from "./Icon";

interface CtaButtonLinkProps {
  href: string;
  children: ReactNode;
  iconName?: string;
  fullWidth?: boolean;
  compact?: boolean;
  type?: never;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  download?: string;
}

interface CtaButtonSubmitProps {
  href?: never;
  children: ReactNode;
  iconName?: string;
  fullWidth?: boolean;
  compact?: boolean;
  type: "submit";
  onClick?: never;
  download?: never;
}

type CtaButtonProps = CtaButtonLinkProps | CtaButtonSubmitProps;

/**
 * Gradient-glow call-to-action button.
 *
 * Renders either a Next.js `<Link>` (default) or a `<button type="submit">`
 * depending on the `type` prop. The dual-mode preserves the keyboard contract:
 *   - `<Link>`: Space is intercepted and routed via `useRouter().push(href)`;
 *     Enter and click are handled natively by `<a>`.
 *   - `<button>`: Native Space/Enter activation, no interception needed.
 *
 * Visual structure (Req 4.1):
 *   - Outer `.cta-glow` span with the same gradient + blur for the halo.
 *   - Inner `.cta-inner` span with the gradient fill and text.
 *
 * Reduced-motion: the hover-glow transition is disabled by the global
 * `@media (prefers-reduced-motion: reduce)` block in globals.css.
 */
export function CtaButton({
  href,
  children,
  iconName,
  fullWidth,
  compact,
  type,
  onClick,
  download,
}: CtaButtonProps) {
  const router = useRouter();

  function handleKeyDown(event: KeyboardEvent<HTMLAnchorElement>) {
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      if (href) router.push(href);
    }
  }

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (onClick) {
      e.preventDefault();
      onClick(e);
    }
  }

  if (type === "submit") {
    return (
      <button
        type="submit"
        className="cta-btn"
        data-fullwidth={fullWidth ? "" : undefined}
        data-compact={compact ? "" : undefined}
      >
        <span className="cta-glow" aria-hidden="true" />
        <span className="cta-inner">
          {iconName ? <Icon name={iconName} filled size={20} /> : null}
          {children}
        </span>
      </button>
    );
  }

  return (
    <Link
      href={href}
      className="cta-btn"
      data-fullwidth={fullWidth ? "" : undefined}
      data-compact={compact ? "" : undefined}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      download={download}
    >
      <span className="cta-glow" aria-hidden="true" />
      <span className="cta-inner">
        {iconName ? <Icon name={iconName} filled size={20} /> : null}
        {children}
      </span>
    </Link>
  );
}
