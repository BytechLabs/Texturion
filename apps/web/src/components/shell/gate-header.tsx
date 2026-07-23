"use client";

import { Wordmark } from "./wordmark";

import { GateEscape } from "./gate-escape";

/**
 * THE shared escape hatch for every full-screen authenticated gate (#207) —
 * onboarding wizard steps, the plan/checkout step, setting-up, invite accept.
 * Those surfaces render OUTSIDE the (app) shell (no sidebar, no MemberMenu),
 * so without this a multi-workspace user who lands in a non-onboarded
 * workspace's gate has no way to switch back or sign out: the trap class this
 * component exists to close. The law test (src/app/gate-layouts.test.tsx)
 * pins that every gate layout mounts it.
 *
 * The escape cluster itself (switcher + sign out) lives in gate-escape.tsx so
 * font-free surfaces can import it without the Wordmark's next/font
 * dependency; this module re-exports it for the gate layouts.
 */
export { GateEscape, GateSignOut, switchWorkspaceFromGate } from "./gate-escape";

/**
 * The minimal gate header: one hairline bar with the wordmark and the escape
 * cluster. No nav tabs — a gate stays a gate; the escape hatch is navigation
 * (switch workspace, sign out), never a bypass of what the gate enforces.
 */
export function GateHeader() {
  return (
    <header className="flex h-14 w-full shrink-0 items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
      <Wordmark href="/" />
      <GateEscape />
    </header>
  );
}
