"use client";

import { PenSquare } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The compose FAB (G3, issue #8): petrol, bottom-right, the app's single
 * "new message" entry point on ALL breakpoints (the sidebar's dedicated button
 * was removed). Sits above the mobile tab bar below lg, and lower on desktop
 * where there's no tab bar. Hidden on the open thread and the compose page,
 * whose bottom-anchored composer it would overlap. Routes to /inbox/new.
 */
export function ComposeFab() {
  const pathname = usePathname();
  // "/inbox/[id]" (open thread) and "/inbox/new" (already composing) both start
  // with "/inbox/"; the "/inbox" list itself does not, so the FAB stays there.
  if (pathname.startsWith("/inbox/")) return null;

  return (
    <Link
      href="/inbox/new"
      aria-label="New conversation"
      className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] right-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground app-shadow-float transition-transform duration-150 ease-out hover:bg-primary/90 active:scale-95 lg:bottom-6 lg:right-6"
    >
      <PenSquare className="size-6" strokeWidth={1.75} />
    </Link>
  );
}
