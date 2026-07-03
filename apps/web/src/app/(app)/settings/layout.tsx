"use client";

import { usePathname } from "next/navigation";

import { SettingsNav } from "@/components/settings/settings-nav";
import { cn } from "@/lib/utils";

/**
 * Left-nav settings layout (G8). Desktop (≥1024px): persistent nav + detail.
 * Mobile/tablet: the /settings index is the stacked section list; detail
 * pages take the full width with their own back link (SettingsPage).
 */
export default function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const atIndex = pathname === "/settings";

  return (
    <div className="mx-auto flex w-full max-w-5xl gap-8 px-4 py-8 md:px-6 lg:gap-10">
      <aside
        className={cn(
          "w-full shrink-0 lg:block lg:w-52",
          atIndex ? "block" : "hidden",
        )}
      >
        <h1 className="mb-4 px-1 text-2xl font-semibold tracking-tight lg:mb-5">
          Settings
        </h1>
        {/* Desktop link list */}
        <div className="hidden lg:block">
          <SettingsNav />
        </div>
        {/* Mobile stacked list (only rendered at the index) */}
        {atIndex && (
          <div className="lg:hidden">
            <SettingsNav asList />
          </div>
        )}
      </aside>
      <div className={cn("min-w-0 flex-1", atIndex ? "hidden lg:block" : "block")}>
        {children}
      </div>
    </div>
  );
}
