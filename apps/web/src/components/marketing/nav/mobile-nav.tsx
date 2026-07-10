"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { CountrySelector } from "@/components/marketing/country";
import { SheetClose } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import {
  CONTACT_LINK,
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
            {/* Pricing sits between Product and Who it's for (deck order).
                #117: it carries the full grouped-row anatomy plus a resting
                Frost wash and a trailing arrow, so the one money page reads
                as a standout button, never a bare text line (emphasis via
                wash and radius, Law 10 — no hairlines). */}
            {i === 0 ? (
              <div className="mt-6">
                <MobileRow
                  item={PRICING_LINK}
                  onNavigate={onNavigate}
                  emphasized
                />
              </div>
            ) : null}
          </section>
        ))}

        {/* #126: Contact reachable from the sheet, not just the footer far
            below — a phone visitor with a pre-signup question shouldn't have to
            scroll the whole page. Desktop keeps its lean bar (Contact stays in
            the footer there). */}
        <div className="mt-6">
          <MobileRow item={CONTACT_LINK} onNavigate={onNavigate} />
        </div>

        {/* The country selector: sets the single site-wide country from the
            sheet, so a mobile visitor gets the same control as the desktop bar. */}
        <section className="mt-6">
          <h3 className="fr-eyebrow px-1 pb-2 text-[color:var(--fr-ink-55)]">
            Where you run your business
          </h3>
          <CountrySelector fullLabels className="flex w-full" />
        </section>

      </div>

      {/* Pinned actions — the cobalt CTA AND Log in, both always reachable
          without scrolling so an existing customer never has to hunt for the
          way in. Log in is a secondary button (not a buried row), matching how
          the desktop bar keeps both visible side by side. */}
      <div className="space-y-2 bg-[color:var(--fr-frost)] p-4">
        <SheetClose asChild>
          <Link
            href={SIGNUP_HREF}
            onClick={onNavigate}
            className="frn-cta frn-cta-lg frn-focus w-full"
          >
            {PRIMARY_CTA_LABEL}
          </Link>
        </SheetClose>
        <SheetClose asChild>
          <Link
            href={LOGIN_HREF}
            onClick={onNavigate}
            className="frn-focus font-body-mkt flex min-h-12 w-full items-center justify-center rounded-full border border-black/10 bg-white text-[15px] font-semibold text-[color:var(--fr-ink)] transition-colors duration-200 ease-out hover:bg-black/[0.03]"
          >
            Log in
          </Link>
        </SheetClose>
      </div>
    </div>
  );
}

/** A grouped two-line row: ink label + ink-55 plain-English line. The
 * `emphasized` variant (#117: Pricing) rests on the Frost wash with a
 * trailing arrow, so it reads as a standout button among plain rows. */
function MobileRow({
  item,
  onNavigate,
  emphasized = false,
}: {
  item: NavItem;
  onNavigate: () => void;
  emphasized?: boolean;
}) {
  return (
    <SheetClose asChild>
      <Link
        href={item.href}
        onClick={onNavigate}
        className={cn(
          "frn-focus flex min-h-11 items-start gap-3 rounded-[10px] p-2.5 transition-colors duration-200 ease-out",
          emphasized
            ? "bg-[color:var(--fr-frost)] hover:bg-[color:var(--fr-frost)] active:bg-[color:var(--fr-frost)]"
            : "hover:bg-[color:var(--fr-frost)] active:bg-[color:var(--fr-frost)]",
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
        {emphasized ? (
          <ArrowRight
            className="mt-2 size-4 shrink-0 text-[color:var(--fr-ink-55)]"
            strokeWidth={1.75}
            aria-hidden
          />
        ) : null}
      </Link>
    </SheetClose>
  );
}
