"use client";

import { PenSquare } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Mobile/tablet compose FAB (G3): petrol, bottom-right, above the tab bar.
 * Shown on the calm destinations below lg (the desktop sidebar carries its own
 * "New message" button). Hidden on the open thread and the compose page, whose
 * bottom-anchored composer the FAB would overlap. Routes to /inbox/new.
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
      className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] right-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground app-shadow-float transition-transform duration-150 ease-out hover:bg-primary/90 active:scale-95 lg:hidden"
    >
      <PenSquare className="size-6" strokeWidth={1.75} />
    </Link>
  );
}
