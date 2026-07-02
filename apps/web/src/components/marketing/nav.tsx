"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { LOGIN_HREF, PRIMARY_CTA_LABEL, SIGNUP_HREF } from "./nav-links";
import { DesktopNav } from "./nav/desktop-nav";
import { MobileNav } from "./nav/mobile-nav";
import { Wordmark } from "./wordmark";

/**
 * Marketing header (BLUEPRINT §12, VISUALS §5b): sticky; stone-50 at ~92%
 * opacity with blur; a bottom 1px border appears on scroll. Left: the petrol
 * wordmark mark. Center: the designed mega-menu nav (Product / Pricing / Who
 * it's for / Compare / Canada) — rounded elevated panels with two-line rows,
 * per-menu icons, and a featured cell in Product. Right: a quiet "Log in" and
 * the solid petrol primary CTA (the site-wide "Start for $29", CONVERSION §2).
 * Mobile → hamburger → full sheet with grouped icon sections and a pinned CTA.
 * No phone number, ever (§12). Every link resolves (nav-links.ts).
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
        "sticky top-0 z-40 w-full bg-background/92 backdrop-blur transition-colors supports-[backdrop-filter]:bg-background/80",
        scrolled ? "border-b border-border" : "border-b border-transparent",
      )}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 sm:px-6"
      >
        <Wordmark />

        {/* Desktop mega-menu nav. */}
        <DesktopNav />

        {/* Right cluster. */}
        <div className="ml-auto flex items-center gap-2">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="hidden text-foreground/80 hover:text-foreground sm:inline-flex"
          >
            <Link href={LOGIN_HREF}>Log in</Link>
          </Button>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href={SIGNUP_HREF}>{PRIMARY_CTA_LABEL}</Link>
          </Button>

          {/* Mobile hamburger → full sheet. */}
          <div className="lg:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open menu">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className="w-full gap-0 p-0 sm:max-w-sm"
              >
                <SheetTitle className="px-4 pt-4">
                  <Wordmark />
                </SheetTitle>
                <SheetDescription className="sr-only">
                  JobText navigation — product, who it&apos;s for, compare, and
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
