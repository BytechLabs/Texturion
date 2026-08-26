import { ConsentBanner } from "@/components/marketing/consent";
import { CountryProvider } from "@/components/marketing/country";
import { DocumentLanguage } from "@/components/marketing/document-language";
import { Footer } from "@/components/marketing/footer";
import { GoogleTagManager } from "@/components/marketing/google-tag-manager";
import { Nav } from "@/components/marketing/nav";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { RevealActivator } from "@/components/marketing/ui/reveal-activator";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { golosText } from "@/lib/app/fonts";
import { body, display, mono } from "@/lib/marketing/fonts";
import { organizationJsonLd } from "@/lib/marketing/seo";

/**
 * The marketing frame, in one language or the other.
 *
 * ## Why this is a component rather than a layout
 *
 * D138 serves French from real `/fr/…` routes, and a Next layout cannot read
 * the pathname — it receives `children` and nothing else. So the language has
 * to come from WHICH layout rendered, which means two layouts, which means the
 * shell they share lives here rather than being copied into both. A copy is how
 * the English footer and the French one would come to differ by a `<div>`.
 *
 * ## `lang` on the frame, and what it does and does not fix
 *
 * `app/layout.tsx` owns `<html lang="en">` and cannot know which route group is
 * about to render, so a French marketing page's `<html>` still says English.
 * The `lang` here covers the whole visible subtree, which is what a screen
 * reader actually reads from — WCAG 3.1.2 Language of Parts — so VoiceOver and
 * NVDA speak French on these pages. It is server-rendered, so it is in the HTML
 * a crawler receives rather than applied by a script afterwards.
 *
 * §3.1.1 is about the DOCUMENT's language, and `<html>` belongs to a layout
 * that cannot know which group is rendering. `DocumentLanguage` corrects it
 * once the route is known — the same thing the app does, for the same reason.
 * So the reader is served by two mechanisms: a server-rendered `lang` covering
 * the whole subtree, and the document attribute a moment later.
 *
 * The remaining honest gap is that the document attribute is not in the HTML as
 * SERVED. Closing that means a root layout per route group, which is a
 * restructuring of `app/` with every page in its blast radius — worth doing
 * once when the French tree justifies it, not between two pages.
 */
export function MarketingShell({
  locale = "en",
  children,
}: Readonly<{ locale?: MarketingLocale; children: React.ReactNode }>) {
  return (
    // Mounts --font-display / --font-body / --font-mono on the marketing
    // subtree only (the two-surfaces rule); the app keeps its own faces.
    // --font-golos joins them for exactly one thing: the brand wordmark
    // (#206) in the nav and footer is Golos Text SemiBold by rule.
    <div
      lang={locale}
      className={`mkt-scope ${display.variable} ${body.variable} ${mono.variable} ${golosText.variable} font-body-mkt flex min-h-svh flex-col`}
    >
      {/* No-JS fail-safe: reveal every scroll-reveal element when JS is off, so
          content is never permanently hidden without the RevealActivator. */}
      <noscript>
        <style>{`[data-reveal]{opacity:1 !important;transform:none !important;}`}</style>
      </noscript>
      {/* WCAG 3.1.1 — corrects <html lang> once the route is known; the
          server-rendered lang on this div covers the subtree either way. */}
      <DocumentLanguage locale={locale} />
      {/* #124: Google Tag Manager — marketing pages only, gated on
          NEXT_PUBLIC_GTM_ID (off in dev/CI). Never mounted by the app groups.
          The ConsentBanner shares the same gate: it asks (once) whether GTM
          tags may set cookies, and the loader's Consent Mode v2 default stays
          denied until the visitor says yes. Overlay, never inserts (CLS 0). */}
      <GoogleTagManager />
      <ConsentBanner locale={locale} />
      <JsonLd data={organizationJsonLd()} />
      {/* One shared IntersectionObserver drives every [data-reveal] (§4). */}
      <RevealActivator />
      {/* One site-wide country (owner ruling v1): the nav CountrySelector, the
          home HeroCountryChooser, the branch helpers, and the /pricing toggle
          all read this single provider, so every surface moves the same state.
          SSR default is "us"; a returning visitor's choice is adopted from
          localStorage after hydration. */}
      <CountryProvider>
        <Nav locale={locale} />
        {/* id="content" is the nav skip link's target; keep it in sync with
            nav.tsx's .frn-skip href. tabIndex={-1} makes it a programmatic
            focus target so activating the skip link actually moves focus (and
            the AT reading cursor) into the content across browsers. */}
        <main id="content" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </main>
        <Footer locale={locale} />
      </CountryProvider>
    </div>
  );
}
