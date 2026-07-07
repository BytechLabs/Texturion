"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { besley, martianMono, publicSans } from "@/lib/marketing/fonts";
import { cn } from "@/lib/utils";

import { LOGIN_HREF, SIGNUP_HREF } from "./nav-links";
import { DesktopNav } from "./nav/desktop-nav";
import { MobileNav } from "./nav/mobile-nav";
import { NavNightCss } from "./nav/nav-night-css";
import { Wordmark } from "./wordmark";

/**
 * Marketing header, "Quiet daylight" skin (v3 spec §6 "Nav"): sticky, 48px,
 * white at 92% opacity with backdrop blur, light on every page. Besley-700
 * --day-ink wordmark, links in --ink-70 with --day-ink hover, and the ONE
 * petrol "Start" button (copy deck "Persistent chrome"; 8px radius, /signup).
 * A 1px hairline bottom edge appears on scroll. Structure is unchanged: the
 * mega-menu nav (Product / Pricing / Who it's for / Compare / Canada), a
 * quiet "Log in", and the mobile hamburger → full sheet (now a white
 * surface). Every link still resolves (nav-links.ts). Pricing stays one tap
 * away forever.
 */
export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "nxh-bar sticky top-0 z-40 w-full border-b",
        scrolled ? "nxh-edge" : "border-transparent",
      )}
    >
      <NavNightCss />
      {/* Copy deck "Persistent chrome": the skip link. Target: the layout's
          <main id="content"> (integration wires the id; see build notes). */}
      <a href="#content" className="nxh-skip">
        Skip to content
      </a>
      <nav
        aria-label="Primary"
        className="mx-auto flex h-12 w-full max-w-6xl items-center gap-6 px-4 sm:px-6"
      >
        <Wordmark className="nxh-wordmark nxh-focus rounded-[4px]" />

        {/* Desktop mega-menu nav. */}
        <DesktopNav />

        {/* Right cluster: quiet Log in + the one petrol Start (spec §6). */}
        <div className="ml-auto flex items-center gap-3">
          <Link
            href={LOGIN_HREF}
            className="nxh-focus hidden h-8 items-center rounded-md px-2 text-sm font-medium text-[color:var(--ink-70)] transition-colors hover:text-[color:var(--day-ink)] sm:inline-flex"
          >
            Log in
          </Link>
          <Link
            href={SIGNUP_HREF}
            className="nxh-btn nxh-focus hidden sm:inline-flex"
            aria-label="Start — create your Loonext account"
          >
            Start now
          </Link>

          {/* Mobile hamburger → full white sheet. Plain button (not the shadcn
              ghost variant) so the quiet chrome states are ours. */}
          <div className="lg:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label="Open menu"
                  className="nxh-focus inline-flex size-9 items-center justify-center rounded-[8px] text-[color:var(--ink-70)] transition-colors hover:bg-[#F0F4F2] hover:text-[color:var(--day-ink)]"
                >
                  <Menu className="size-5" aria-hidden />
                </button>
              </SheetTrigger>
              {/* The sheet PORTALS to <body>, outside .mkt-scope and outside
                  the layout's font-variable wrapper, so both are re-mounted
                  here: mkt-scope brings the marketing tokens, the font
                  .variable classes bring Besley/Public Sans/Martian Mono
                  (next/font dedupes; no extra payload). nxh-sheet paints the
                  white surface over .mkt-scope's paper ground. */}
              <SheetContent
                side="right"
                className={cn(
                  "mkt-scope nxh-sheet w-full gap-0 p-0 sm:max-w-sm",
                  besley.variable,
                  publicSans.variable,
                  martianMono.variable,
                  "font-body-mkt",
                )}
              >
                <SheetTitle className="px-4 pt-4">
                  <Wordmark className="nxh-wordmark nxh-focus rounded-[4px]" />
                </SheetTitle>
                <SheetDescription className="sr-only">
                  Loonext navigation, product, who it&apos;s for, compare, and
                  pricing.
                </SheetDescription>
                <MobileNav onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </nav>
    </header>
  );
}
