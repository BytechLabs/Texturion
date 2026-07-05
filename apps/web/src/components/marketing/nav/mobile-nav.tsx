"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { SheetClose } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import {
  CANADA_LINK,
  LOGIN_HREF,
  NAV_MENUS,
  PRICING_LINK,
  SIGNUP_HREF,
  type NavItem,
} from "../nav-links";

/**
 * The mobile navigation sheet, light skin (v3 spec §6): a white panel (the
 * surface itself is painted by nxh-sheet in nav.tsx) with the same grouped
 * sections as the desktop mega-menu — Public Sans 600 --ink-55 section
 * labels (sentence case; mono is figures-only in v3), quiet #F0F4F2 icon
 * chips with petrol glyphs, --day-ink labels, --ink-55 descriptions. The one
 * petrol "Start" CTA is pinned to the bottom of the sheet, always reachable.
 * Every row is ≥44px (G11). Selecting any link closes the sheet.
 */
export function MobileNav({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-6">
        {/* Pricing, a flat top-level link, given its own quiet row. */}
        <FlatRow item={PRICING_LINK} onNavigate={onNavigate} />

        {NAV_MENUS.map((menu) => (
          <section key={menu.label} className="mt-6">
            <h3 className="font-body-mkt px-1 pb-1 text-[11px] font-semibold text-[color:var(--ink-55)]">
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
        <div className="mt-6 space-y-0.5 border-t border-[color:var(--rule-light)] pt-4">
          <FlatRow item={CANADA_LINK} onNavigate={onNavigate} />
          <FlatRow
            item={{ label: "Log in", href: LOGIN_HREF }}
            onNavigate={onNavigate}
          />
        </div>
      </div>

      {/* Pinned petrol CTA, the one button, "Start" (copy deck "Persistent
          chrome"), 44px tap height. */}
      <div className="border-t border-[color:var(--rule-light)] p-4">
        <SheetClose asChild>
          <Link
            href={SIGNUP_HREF}
            onClick={onNavigate}
            className="nxh-btn nxh-btn-lg nxh-focus w-full"
          >
            Start
          </Link>
        </SheetClose>
      </div>
    </div>
  );
}

/** A grouped two-line row: quiet icon chip + day-ink label + ink-55 line. */
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
          "nxh-focus flex min-h-11 items-start gap-3 rounded-[10px] p-2.5 transition-colors",
          "hover:bg-[#F0F4F2] active:bg-[#F0F4F2]",
        )}
      >
        <span
          className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-[rgba(11,43,38,0.08)] bg-[#F0F4F2] text-[color:var(--petrol)]"
          aria-hidden
        >
          {compareMotif ? (
            <span className="text-[11px] font-semibold tracking-tight">vs</span>
          ) : Icon ? (
            <Icon className="size-[18px]" strokeWidth={1.75} />
          ) : null}
        </span>
        <span className="min-w-0">
          <span className="block text-[15px] font-medium text-[color:var(--day-ink)]">
            {item.label}
          </span>
          {item.description ? (
            <span className="mt-0.5 block text-[13px] leading-snug text-[color:var(--ink-55)]">
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
          "nxh-focus flex min-h-11 items-center justify-between rounded-[10px] px-2.5 text-[15px] font-medium text-[color:var(--day-ink)] transition-colors",
          "hover:bg-[#F0F4F2] active:bg-[#F0F4F2]",
        )}
      >
        {item.label}
        <ArrowRight
          className="size-4 text-[color:var(--ink-55)]"
          strokeWidth={1.75}
          aria-hidden
        />
      </Link>
    </SheetClose>
  );
}
