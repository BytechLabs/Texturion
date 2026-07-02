"use client";

import { ChevronDown, Menu } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import {
  CANADA_LINK,
  LOGIN_HREF,
  NAV_MENUS,
  PRICING_LINK,
  PRIMARY_CTA_LABEL,
  SIGNUP_HREF,
  type NavMenu,
} from "./nav-links";
import { Wordmark } from "./wordmark";

/**
 * Marketing header (BLUEPRINT §12): sticky; stone-50 at ~92% opacity with blur;
 * a bottom 1px border appears on scroll. Wordmark left; Product ▾ / Pricing /
 * Who it's for ▾ / Compare ▾ / Canada center-left; Log in (quiet) + petrol
 * "Get your number" CTA right. Mobile → hamburger → full-screen sheet with a
 * pinned CTA. No phone number, ever (§12). Every link resolves (nav-links.ts).
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

        {/* Desktop links */}
        <div className="hidden items-center gap-1 lg:flex">
          <DesktopMenu menu={NAV_MENUS[0]} />
          <TopLink href={PRICING_LINK.href}>{PRICING_LINK.label}</TopLink>
          <DesktopMenu menu={NAV_MENUS[1]} />
          <DesktopMenu menu={NAV_MENUS[2]} />
          <TopLink href={CANADA_LINK.href}>{CANADA_LINK.label}</TopLink>
        </div>

        {/* Right cluster */}
        <div className="ml-auto flex items-center gap-2">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
          >
            <Link href={LOGIN_HREF}>Log in</Link>
          </Button>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href={SIGNUP_HREF}>{PRIMARY_CTA_LABEL}</Link>
          </Button>

          {/* Mobile hamburger → full sheet */}
          <div className="lg:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Open menu"
                >
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full p-0 sm:max-w-sm">
                <SheetTitle className="px-4 pt-4">
                  <Wordmark />
                </SheetTitle>
                <MobileMenu onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </nav>
    </header>
  );
}

function TopLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground"
    >
      {children}
    </Link>
  );
}

function DesktopMenu({ menu }: { menu: NavMenu }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:text-foreground">
        {menu.label}
        <ChevronDown className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {menu.items.map((item) => (
          <DropdownMenuItem key={item.label} asChild>
            <Link href={item.href} className="cursor-pointer">
              {item.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileMenu({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex-1 px-4 py-2">
        {NAV_MENUS.map((menu, i) => (
          <div key={menu.label} className={cn(i > 0 && "mt-6")}>
            <p className="px-2 pb-1 text-xs font-semibold text-muted-foreground">
              {menu.label}
            </p>
            <ul>
              {menu.items.map((item) => (
                <li key={item.label}>
                  <MobileLink href={item.href} onNavigate={onNavigate}>
                    {item.label}
                  </MobileLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="mt-6 border-t border-border pt-4">
          <MobileLink href={PRICING_LINK.href} onNavigate={onNavigate}>
            {PRICING_LINK.label}
          </MobileLink>
          <MobileLink href={CANADA_LINK.href} onNavigate={onNavigate}>
            {CANADA_LINK.label}
          </MobileLink>
          <MobileLink href={LOGIN_HREF} onNavigate={onNavigate}>
            Log in
          </MobileLink>
        </div>
      </div>

      {/* CTA pinned at the bottom of the sheet (§12). */}
      <div className="border-t border-border p-4">
        <SheetClose asChild>
          <Button asChild size="lg" className="w-full">
            <Link href={SIGNUP_HREF}>{PRIMARY_CTA_LABEL}</Link>
          </Button>
        </SheetClose>
      </div>
    </div>
  );
}

function MobileLink({
  href,
  children,
  onNavigate,
}: {
  href: string;
  children: React.ReactNode;
  onNavigate: () => void;
}) {
  return (
    <SheetClose asChild>
      <Link
        href={href}
        onClick={onNavigate}
        className="flex min-h-11 items-center rounded-md px-2 text-base font-medium text-foreground/90 transition-colors hover:bg-accent hover:text-foreground"
      >
        {children}
      </Link>
    </SheetClose>
  );
}
