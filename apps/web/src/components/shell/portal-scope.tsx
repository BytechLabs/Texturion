"use client";

import { useLayoutEffect } from "react";

/**
 * #116: Radix overlays (Sheet, Dialog, DropdownMenu, Popover, Tooltip, Select,
 * the command palette) portal into document.body — OUTSIDE the (app) layout's
 * `.app-scope` div. Out there every var(--app-*) is invalid at
 * computed-value time, so portaled surfaces painted TRANSPARENT backgrounds
 * (the see-through account sheet), currentColor borders (white 1px card
 * outlines in dark), lost the calm shadcn token remaps (generic stone-950
 * grounds), and fell back to Inter.
 *
 * Mirroring the html-class mechanism next-themes already uses, this mounts
 * the app token scope (plus the Golos font variable) on <body> for exactly as
 * long as an (app) route is mounted, so every portal — and the sonner
 * Toaster, which also lives outside the scope div — resolves the calm palette
 * in both themes. `.dark` sits on <html>, an ancestor of body, so the
 * `.dark .app-scope` remap matches. Marketing routes never mount this (their
 * layout group doesn't render it), so the marketing light-lock and its
 * embed-local scopes are untouched. Class mutation happens post-hydration
 * (useEffect), so there is no SSR mismatch; portals only render client-side
 * anyway.
 */
interface ScopeTarget {
  classList: {
    add(...tokens: string[]): void;
    remove(...tokens: string[]): void;
  };
}

/** Add the scope classes to `target`; returns the cleanup that removes
 * exactly what was added. Pure DOM-mechanics, exported for tests (the suite
 * runs in a node environment, so the contract is pinned on a stub target). */
export function mountScope(target: ScopeTarget, classes: string): () => void {
  const tokens = classes.split(/\s+/).filter(Boolean);
  target.classList.add(...tokens);
  return () => target.classList.remove(...tokens);
}

export function PortalScope({ classes }: { classes: string }) {
  // Layout effect (not passive): on an (app) → marketing transition the
  // cleanup then runs before paint, so marketing never paints a frame with
  // the app scope still on <body>.
  useLayoutEffect(() => mountScope(document.body, classes), [classes]);
  return null;
}
