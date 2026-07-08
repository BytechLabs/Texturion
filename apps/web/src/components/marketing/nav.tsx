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
import { body, display, mono } from "@/lib/marketing/fonts";
import { cn } from "@/lib/utils";

import { CountrySelector } from "@/components/marketing/country";

import { LOGIN_HREF, PRIMARY_CTA_LABEL, SIGNUP_HREF } from "./nav-links";
import { DesktopNav } from "./nav/desktop-nav";
import { MobileNav } from "./nav/mobile-nav";
import { NavCss } from "./nav/nav-css";

/**
 * Marketing header, v4 "FIRST RESPONSE" (DESIGN-DIRECTION §4 "Nav"): Signal
 * White, NO border (Law 10). Wordmark Bricolage 800 ink; links Hanken 500;
 * the one cobalt `Get your number` pill (deck §Global). On scroll past 24px
 * the bar ground clears and the nav row condenses into a floating frosted
 * pill (white at 88% + backdrop blur, the one card shadow). The header keeps
 * a constant 4rem outer height, so condensing never shifts layout (CLS 0).
 *
 * Deck order: Product ▾ · Pricing · Who it's for ▾ · Compare ▾ · Log in ·
 * [Get your number]. Every link resolves (nav-links.ts). Mobile: hamburger →
 * white sheet with the same groups and the pinned cobalt CTA.
 */
export function Nav() {
  const [condensed, setCondensed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setCondensed(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="frn-bar sticky top-0 z-40 w-full"
      data-condensed={condensed || undefined}
    >
      <NavCss />
      {/* Skip link; target: the layout's <main id="content">. */}
      <a href="#content" className="frn-skip">
        Skip to content
      </a>
      <div className="mx-auto flex h-16 w-full max-w-[72rem] items-center px-3 md:px-5">
        <nav
          aria-label="Primary"
          className={cn(
            "flex h-16 w-full items-center gap-6 rounded-full px-3 transition-[height,background-color,box-shadow] duration-200 ease-out md:px-4",
            condensed && "frn-pill h-12",
          )}
        >
          <Link href="/" aria-label="Loonext home" className="frn-wordmark frn-focus rounded-[6px] text-xl leading-none">
            Loonext
          </Link>

          {/* Desktop mega-menu nav, deck order. */}
          <DesktopNav />

          {/* Right cluster: the country selector, quiet Log in, the one cobalt
              pill (§4). The selector sets the single site-wide country; on the
              smallest screens the mobile sheet carries it instead. */}
          <div className="ml-auto flex items-center gap-3">
            <CountrySelector className="hidden sm:inline-flex" />
            <Link
              href={LOGIN_HREF}
              className="frn-focus font-body-mkt hidden h-9 items-center rounded-full px-2.5 text-sm font-medium text-[color:var(--fr-ink-70)] transition-colors duration-200 ease-out hover:text-[color:var(--fr-ink)] sm:inline-flex"
            >
              Log in
            </Link>
            <Link
              href={SIGNUP_HREF}
              className="frn-cta frn-focus hidden sm:inline-flex"
            >
              {PRIMARY_CTA_LABEL}
            </Link>

            {/* Mobile hamburger → full white sheet. Plain button (not the
                shadcn ghost variant) so the chrome states are ours. */}
            <div className="lg:hidden">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    aria-label="Open menu"
                    className="frn-focus inline-flex size-10 items-center justify-center rounded-full text-[color:var(--fr-ink-70)] transition-colors duration-200 ease-out hover:bg-[color:var(--fr-frost)] hover:text-[color:var(--fr-ink)]"
                  >
                    <Menu className="size-5" aria-hidden />
                  </button>
                </SheetTrigger>
                {/* The sheet PORTALS to <body>, outside .mkt-scope and outside
                    the layout's font-variable wrapper, so both are re-mounted
                    here: mkt-scope brings the marketing tokens, the font
                    .variable classes bring Bricolage/Hanken/Spline (next/font
                    dedupes; no extra payload). frn-sheet paints the white
                    surface over .mkt-scope's ground. */}
                <SheetContent
                  side="right"
                  className={cn(
                    "mkt-scope frn-sheet w-full gap-0 p-0 sm:max-w-sm",
                    display.variable,
                    body.variable,
                    mono.variable,
                    "font-body-mkt",
                  )}
                >
                  <SheetTitle className="px-4 pt-4">
                    <Link
                      href="/"
                      aria-label="Loonext home"
                      className="frn-wordmark frn-focus rounded-[6px] text-xl leading-none"
                      onClick={() => setMobileOpen(false)}
                    >
                      Loonext
                    </Link>
                  </SheetTitle>
                  <SheetDescription className="sr-only">
                    Loonext navigation: product, pricing, who it&apos;s for,
                    and comparisons.
                  </SheetDescription>
                  <MobileNav onNavigate={() => setMobileOpen(false)} />
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </nav>
      </div>
    </header>
  );
}
