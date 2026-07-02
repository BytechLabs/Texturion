"use client";

import { PenSquare } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Mobile compose FAB (G3): petrol, bottom-right, above the tab bar, shown on
 * the inbox tab only. Routes to the new-conversation flow (/inbox/new).
 */
export function ComposeFab() {
  const pathname = usePathname();
  if (pathname !== "/inbox") return null;

  return (
    <Link
      href="/inbox/new"
      aria-label="New conversation"
      className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] right-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform duration-150 ease-out hover:bg-primary/90 active:scale-95 md:hidden"
    >
      <PenSquare className="size-6" strokeWidth={1.75} />
    </Link>
  );
}
