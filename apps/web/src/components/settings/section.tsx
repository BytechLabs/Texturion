"use client";

/*
 * #228: the directive above is a formality, not a rendering change. Every one of
 * this file's importers is already a `"use client"` module — the settings pages,
 * the cards, the task views — so it was compiled into the client bundle either
 * way, and it uses no server-only API. Stating it is what lets the two sentences
 * below reach `useT()` instead of staying the last hardcoded strings on a screen
 * whose every other card has been extracted.
 */

import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import { useT } from "@/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Shared scaffolding for every settings detail page (G8): mobile back link
 * to the stacked section list, page heading, and bordered cards (no shadows —
 * G2 border-first surfaces).
 */
export function SettingsPage({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    // §3.6: one concern per page, editorial whitespace — 32px between the page
    // header and the section stack.
    <div className="space-y-8">
      <div className="space-y-1.5">
        <Link
          href="/settings"
          className="mb-2 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground lg:hidden"
        >
          <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
          {t("settingsMore.settingsHeading")}
        </Link>
        {/* Screen heading — 24px/600, the §2.2 page-title rung. */}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

export function SettingsCard({
  title,
  description,
  children,
  footer,
  className,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    // §2.4 border-first, no card shadow. Interior rules use the softer
    // stone-100 divider (§2.1 border-subtle) so the header/footer splits almost
    // disappear while the card edge stays crisp.
    <section className={cn("rounded-lg border bg-card", className)}>
      {(title || description) && (
        <div className="space-y-1 border-b border-border-subtle px-5 py-4 sm:px-6">
          {/* Section heading — 18px/600, the confident §3.6 rung. */}
          {title && (
            <h2 className="text-[1.0625rem] font-semibold tracking-tight">
              {title}
            </h2>
          )}
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      <div className="px-5 py-5 sm:px-6">{children}</div>
      {footer && (
        <div className="border-t border-border-subtle bg-muted/30 px-5 py-3.5 sm:px-6">
          {footer}
        </div>
      )}
    </section>
  );
}

/** Inline error with a retry — the shared query-failure state. */
export function LoadError({
  message,
  onRetry,
}: {
  /** Defaulted inside the body rather than in the signature, because the
   *  default is now a lookup and a hook cannot run in a parameter list. */
  message?: string;
  onRetry: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border bg-card px-4 py-4">
      <p className="text-sm text-muted-foreground">
        {message ?? t("common.loadFailed")}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}
