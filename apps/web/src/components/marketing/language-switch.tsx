"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { twinOf } from "@/lib/marketing/translated-pages";

/**
 * D138 Rule 6 — the way across to the other language, where there is one.
 *
 * ## It renders nothing where the page has no twin
 *
 * Which is most of the site, for now. Offering French on a page that has none
 * is a promise the next click breaks, and a switcher that lands somebody on
 * `/fr` instead has thrown away what they were reading. So the control is
 * absent rather than disabled: a greyed-out language toggle tells a Quebec
 * reader the French exists and they are not allowed it, which is worse than
 * saying nothing.
 *
 * ## Why a link and not a dropdown, and why the footer
 *
 * There are two languages, so a menu would be a control with one option in it
 * — a decision that does not exist dressed up as one. It names the language it
 * goes TO, in that language, which is the convention every bilingual Canadian
 * site uses and the only version a reader who cannot read the current page can
 * act on.
 *
 * The footer rather than the nav, deliberately and for now. The bar is already
 * carrying a wordmark, three mega-menus, a COUNTRY selector, a quiet Log in and
 * the one cobalt CTA — and a language control beside a country control is the
 * specific confusion to avoid, because country is not language and two
 * adjacent dropdowns that both read as "regional settings" teach people the
 * wrong thing about both. With one page translated it would also appear on two
 * URLs out of fifty-three. It earns a place in the bar when the coverage is
 * broad enough to be worth the room.
 *
 * *Applying: Zen of Clarity, the 'Safety' Principle (footer language links are
 * the conventional place), and Ethical Friction in reverse — no friction on a
 * reader trying to be understood.*
 *
 * ## Why it is a client component
 *
 * It needs the current path, and a layout does not get one. This is the one
 * piece of the marketing chrome that has to know where it is.
 */
export function LanguageSwitch() {
  const pathname = usePathname();
  const twin = twinOf(pathname);
  if (!twin) return null;

  return (
    <Link
      href={twin.path}
      // `lang` on the link itself, because the label is in the OTHER language:
      // without it a screen reader says "Français" with an English voice, which
      // is the one word on the page that has to be pronounced correctly to be
      // useful. `hrefLang` tells the browser the same about the destination.
      lang={twin.locale}
      hrefLang={twin.locale}
      className="frf-link font-body-mkt text-sm underline underline-offset-4"
    >
      {twin.locale === "fr-CA" ? "Français" : "English"}
    </Link>
  );
}
