"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SheetClose } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import {
  CANADA_LINK,
  LOGIN_HREF,
  NAV_MENUS,
  PRICING_LINK,
  PRIMARY_CTA_LABEL,
  SIGNUP_HREF,
  type NavItem,
} from "../nav-links";

/**
 * The mobile navigation sheet (VISUALS §5b): not a flat text list, but grouped
 * sections that mirror the desktop mega-menu, section headers, the same
 * petrol-tinted icon chips, and the one-line descriptions, with comfortable
 * spacing so it feels like the app. The primary petrol CTA is pinned to the
 * bottom of the sheet, always reachable (CONVERSION §2). Every row is ≥44px
 * (G11). Selecting any link closes the sheet.
 */
export function MobileNav({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-6">
        {/* Pricing, a flat top-level link, given its own quiet row. */}
        <FlatRow item={PRICING_LINK} onNavigate={onNavigate} />

        {NAV_MENUS.map((menu) => (
          <section key={menu.label} className="mt-6">
            <h3 className="px-1 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {menu.label}
            </h3>
            <ul className="space-y-0.5">
              {menu.items.map((item) => (
                <li key={item.label}>
                  <MobileRow
                    item={item}
                    compareMotif={menu.label === "Compare"}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}

        {/* Canada + Log in, quiet flat rows at the bottom of the scroll. */}
        <div className="mt-6 space-y-0.5 border-t border-border pt-4">
          <FlatRow item={CANADA_LINK} onNavigate={onNavigate} />
          <FlatRow
            item={{ label: "Log in", href: LOGIN_HREF }}
            onNavigate={onNavigate}
          />
        </div>
      </div>

      {/* Pinned petrol CTA (§5b, CONVERSION §2). */}
      <div className="border-t border-border p-4">
        <SheetClose asChild>
          <Button asChild size="lg" className="w-full">
            <Link href={SIGNUP_HREF} onClick={onNavigate}>
              {PRIMARY_CTA_LABEL}
            </Link>
          </Button>
        </SheetClose>
      </div>
    </div>
  );
}

/** A grouped two-line row: icon chip + label + description (§5b). */
function MobileRow({
  item,
  compareMotif = false,
  onNavigate,
}: {
  item: NavItem;
  compareMotif?: boolean;
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  return (
    <SheetClose asChild>
      <Link
        href={item.href}
        onClick={onNavigate}
        className={cn(
          "flex min-h-11 items-start gap-3 rounded-[10px] p-2.5 transition-colors",
          "active:bg-teal-50 hover:bg-teal-50 dark:active:bg-teal-950/40 dark:hover:bg-teal-950/40",
        )}
      >
        <span
          className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary"
          aria-hidden
        >
          {compareMotif ? (
            <span className="text-[11px] font-semibold tracking-tight">vs</span>
          ) : Icon ? (
            <Icon className="size-[18px]" strokeWidth={1.75} />
          ) : null}
        </span>
        <span className="min-w-0">
          <span className="block text-[15px] font-medium text-foreground">
            {item.label}
          </span>
          {item.description ? (
            <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">
              {item.description}
            </span>
          ) : null}
        </span>
      </Link>
    </SheetClose>
  );
}

/** A single-line flat row (Pricing, Canada, Log in) with a trailing chevron. */
function FlatRow({
  item,
  onNavigate,
}: {
  item: NavItem;
  onNavigate: () => void;
}) {
  return (
    <SheetClose asChild>
      <Link
        href={item.href}
        onClick={onNavigate}
        className={cn(
          "flex min-h-11 items-center justify-between rounded-[10px] px-2.5 text-[15px] font-medium text-foreground transition-colors",
          "active:bg-teal-50 hover:bg-teal-50 dark:active:bg-teal-950/40 dark:hover:bg-teal-950/40",
        )}
      >
        {item.label}
        <ArrowRight
          className="size-4 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
      </Link>
    </SheetClose>
  );
}
