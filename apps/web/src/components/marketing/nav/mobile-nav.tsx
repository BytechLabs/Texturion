"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { SheetClose } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import {
  LOGIN_HREF,
  NAV_MENUS,
  PRICING_LINK,
  PRIMARY_CTA_LABEL,
  SIGNUP_HREF,
  type NavItem,
} from "../nav-links";
import { MenuIconChip } from "./menu-icon";

/**
 * The mobile navigation sheet, v4 "FIRST RESPONSE" skin: a white panel (the
 * surface is painted by frn-sheet in nav.tsx) with the same groups as the
 * desktop mega-menu in deck order (Product, Pricing, Who it's for, Compare,
 * Log in), each grouped row led by the same cobalt Frost icon chip as the
 * desktop menu (amendment 15), Frost hover wash, and
 * the one cobalt `Get your number` pill pinned to the bottom, always
 * reachable. Every row is at least 44px. Selecting any link closes the
 * sheet.
 */
export function MobileNav({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-6">
        {NAV_MENUS.map((menu, i) => (
          <section key={menu.label} className={i === 0 ? "mt-2" : "mt-6"}>
            <h3 className="fr-eyebrow px-1 pb-2 text-[color:var(--fr-ink-55)]">
              {menu.label}
            </h3>
            <ul className="space-y-0.5">
              {menu.items.map((item) => (
                <li key={item.label}>
                  <MobileRow item={item} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
            {/* Pricing sits between Product and Who it's for (deck order). */}
            {i === 0 ? (
              <div className="mt-6">
                <FlatRow item={PRICING_LINK} onNavigate={onNavigate} />
              </div>
            ) : null}
          </section>
        ))}

        {/* Log in, a quiet flat row at the bottom of the scroll. */}
        <div className="mt-6 border-t-0 pt-2">
          <FlatRow
            item={{ label: "Log in", href: LOGIN_HREF }}
            onNavigate={onNavigate}
          />
        </div>
      </div>

      {/* Pinned cobalt CTA, the one button, deck label, 48px tap height. */}
      <div className="bg-[color:var(--fr-frost)] p-4">
        <SheetClose asChild>
          <Link
            href={SIGNUP_HREF}
            onClick={onNavigate}
            className="frn-cta frn-cta-lg frn-focus w-full"
          >
            {PRIMARY_CTA_LABEL}
          </Link>
        </SheetClose>
      </div>
    </div>
  );
}

/** A grouped two-line row: ink label + ink-55 plain-English line. */
function MobileRow({
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
          "frn-focus flex min-h-11 items-start gap-3 rounded-[10px] p-2.5 transition-colors duration-200 ease-out",
          "hover:bg-[color:var(--fr-frost)] active:bg-[color:var(--fr-frost)]",
        )}
      >
        {item.icon ? <MenuIconChip icon={item.icon} className="mt-0.5" /> : null}
        <span className="min-w-0 flex-1">
          <span className="font-body-mkt block text-[15px] font-semibold text-[color:var(--fr-ink)]">
            {item.label}
          </span>
          {item.description ? (
            <span className="font-body-mkt mt-0.5 block text-[13px] leading-snug text-[color:var(--fr-ink-55)]">
              {item.description}
            </span>
          ) : null}
        </span>
      </Link>
    </SheetClose>
  );
}

/** A single-line flat row (Pricing, Log in) with a trailing arrow. */
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
          "frn-focus font-body-mkt flex min-h-11 items-center justify-between rounded-[10px] px-2.5 text-[15px] font-semibold text-[color:var(--fr-ink)] transition-colors duration-200 ease-out",
          "hover:bg-[color:var(--fr-frost)] active:bg-[color:var(--fr-frost)]",
        )}
      >
        {item.label}
        <ArrowRight
          className="size-4 text-[color:var(--fr-ink-55)]"
          strokeWidth={1.75}
          aria-hidden
        />
      </Link>
    </SheetClose>
  );
}
