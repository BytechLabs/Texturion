"use client";

import { Check, Copy } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * NumberReveal — the budgeted "delight" number (APP-UI-ELEVATION.md §2.2, §3.4).
 *
 * The one big tabular figure that carries an emotional moment: the activation
 * number on the brand-new inbox (§3.1), the onboarding "your number is ready"
 * reveal (§3.4), the usage "balance" figure (§3.6). Renders in the
 * `app-emotional-number` scale (32–36px, tabular Inter, tight tracking) with a
 * calm 200ms fade+rise on first mount — the ONE motion that is delight, not
 * feedback.
 *
 * DELIGHT BUDGET (§1). This is spent at THREE moments only. Do not scatter it
 * across working screens; the inbox rows, thread meta, and settings labels are
 * the functional ladder, not this.
 *
 * REDUCED MOTION. The reveal animation is a CSS class the globals.css base rule
 * already zeroes; there is no JS-driven motion here, so nothing to guard. The
 * final state is identical with or without motion.
 *
 * ACCESSIBILITY. `value` is already display-formatted by the caller
 * (`formatPhone`, a dollar figure, a count). `copyValue` defaults to `value`;
 * pass a raw form when the copyable text differs from the display text. Copy
 * failures are silent — the number is on screen to read by hand.
 */

export interface NumberRevealProps {
  /** Display-formatted figure, e.g. "(416) 555-0182" or "$29". */
  value: string;
  /** Text placed on the clipboard by the copy button. Defaults to `value`. */
  copyValue?: string;
  /** Show the outline copy button beside the number. Defaults to false. */
  copyable?: boolean;
  /**
   * One warm caption under the number (the §2.2 "hero line" companion), e.g.
   * "This is your business number." Rendered quiet, not tertiary — it is
   * essential.
   */
  caption?: React.ReactNode;
  /** Accessible label for the copy button. Defaults to `Copy ${value}`. */
  copyLabel?: string;
  className?: string;
}

const COPIED_RESET_MS = 2000;

export function NumberReveal({
  value,
  copyValue,
  copyable = false,
  caption,
  copyLabel,
  className,
}: NumberRevealProps) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => clearTimeout(t);
  }, [copied]);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(copyValue ?? value);
      setCopied(true);
    } catch {
      // Clipboard blocked — the number is visible to copy by hand.
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="app-emotional-number app-motion-message-in">
          {value}
        </span>
        {copyable ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCopy}
            aria-label={copyLabel ?? `Copy ${value}`}
          >
            {copied ? (
              <>
                <Check className="size-4" aria-hidden /> Copied
              </>
            ) : (
              <>
                <Copy className="size-4" aria-hidden /> Copy
              </>
            )}
          </Button>
        ) : null}
      </div>
      {caption ? (
        <p className="text-sm text-muted-foreground">{caption}</p>
      ) : null}
    </div>
  );
}

/**
 * CheckCascade — the ONE signature motion (§3.4/§4): the gentle green check
 * cascade on the setting-up screen. Renders a row of completed checks that
 * scale-in in sequence. Reduced-motion shows the final state instantly (the
 * base rule zeroes the animation and the stagger delay is a no-op visually).
 *
 * This is deliberately small and self-contained; the setting-up screen owns the
 * checklist rows and can drop these check marks in as each row resolves.
 */
export function CheckCascade({
  count,
  className,
  stepMs = 90,
}: {
  /** How many check marks have completed. */
  count: number;
  /** Per-step stagger. Ignored under reduced motion. */
  stepMs?: number;
  className?: string;
}) {
  const reduced = React.useRef(false);
  React.useEffect(() => {
    reduced.current = prefersReducedMotion();
  }, []);

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} aria-hidden>
      {Array.from({ length: Math.max(0, count) }).map((_, i) => (
        <span
          key={i}
          className="app-motion-check-cascade flex size-5 items-center justify-center rounded-full bg-success text-white"
          style={{ "--cascade-delay": `${i * stepMs}ms` } as React.CSSProperties}
        >
          <Check className="size-3" strokeWidth={2.5} />
        </span>
      ))}
    </span>
  );
}
