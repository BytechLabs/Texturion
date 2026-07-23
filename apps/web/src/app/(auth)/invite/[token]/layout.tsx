import type { Metadata } from "next";

import { GateEscape } from "@/components/shell/gate-header";

/**
 * Per-route tab title for /invite/[token] (accepting a teammate invitation).
 * The page is a client component, so the title lives in this segment layout.
 * `robots: noindex` is inherited from the (auth) group layout; the
 * "%s · Loonext" template comes from the root.
 *
 * Also mounts the shared gate escape cluster (#207): invite accept is a
 * full-screen authenticated gate (needs-name, joining, error states), so a
 * signed-in visitor — e.g. a multi-workspace member on a stale invite — must
 * be able to switch workspace or sign out without finishing the flow. The
 * cluster renders nothing while signed out, so the anonymous invite states
 * are untouched. Fixed to the top-right of the viewport because this segment
 * renders INSIDE the (auth) group's centered card.
 */
export const metadata: Metadata = {
  title: "Accept your invitation",
};

export default function InviteTitleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <GateEscape className="fixed right-4 top-4" />
      {children}
    </>
  );
}
