import {
  currencyForCountry,
  formatMoney,
  PLAN_PRICE_CENTS,
  US_REGISTRATION_FEE_CENTS,
  type BillingCurrency,
} from "@loonext/shared";

import { CountryOnly, type Country } from "@/components/marketing/country";
import { FrSection } from "@/components/marketing/fr";

/**
 * S11 · FAIR QUESTIONS (COPY-DECK v2), country-aware (owner ruling v1,
 * 2026-07-08). Conversion job: handle the remaining objections on this page so
 * nobody leaves to "think about it."
 *
 * The setup/timeline/fee answers branch on the site-wide country. A US visitor
 * reads the honest carrier-wait and the one-time registration fee with no
 * Canadian carve-outs; a Canadian visitor reads the same-day, no-fee story,
 * plus the one opt-in question about turning on US texting later (where the US
 * fee and wait honestly do apply). Neither list shows the other country's
 * timeline.
 *
 * #328: the country branch IS the currency branch. This list is built by a
 * function of currency and each country's list fixes that argument, which is
 * not an assumption about the reader: `faqsForCountry` is the only thing that
 * builds one, the two lists never render together, and the answers a Canadian
 * reads are therefore only ever built with CAD. That matters most in the
 * pricing answer, which is the one a reader checks against their card.
 *
 * Native <details>/<summary> disclosures (§7: the FAQ works with zero JS),
 * drawn as white cards on the Frost band, separated by space and radius, no
 * hairline rules anywhere (Law 10). Numbers inside FAQ prose stay in the
 * body face (the §3 prose exception). No em-dashes.
 */

interface HomeFaq {
  /** The question (US/default wording). */
  q: string;
  /** The answer (US/default wording). */
  a: string;
  /** When set, this entry renders only for the matching country. */
  only?: Country;
  /** Canada question override (defaults to `q`). */
  qCa?: string;
  /** Canada answer override (defaults to `a`). */
  aCa?: string;
}

/**
 * Somebody else's prices, which stay literal because they are not ours to
 * derive: these are the published per-user rates the comparison pages source.
 *
 * They are US dollars, and for a Canadian reader they now SAY so. The sentence
 * sets a rival's monthly total beside ours, so once our half is CAD the two
 * halves stopped being the same money. The comparison still holds with the
 * label on (their US$90 floor is well past our CAD Pro price at any rate this
 * decade has seen); without it, the sentence was our argument plus an
 * accidental exchange rate, which is the exact defect #328 is about.
 */
const crewElsewhere = (currency: BillingCurrency) =>
  currency === "cad"
    ? "A 6-person crew on a typical per-user tool runs US$90 to US$114 a month"
    : "A 6-person crew on a typical per-user tool runs $90 to $114 a month";

/** The question list for one currency; `faqsForCountry` picks which. */
function homeFaqs(currency: BillingCurrency): readonly HomeFaq[] {
  const starter = formatMoney(PLAN_PRICE_CENTS[currency].starter, currency);
  const pro = formatMoney(PLAN_PRICE_CENTS[currency].pro, currency);
  const registration = formatMoney(US_REGISTRATION_FEE_CENTS[currency], currency);
  // The first month is a SUM, so it is the figure that can go wrong while both
  // of its parts stay right. Added here rather than written down.
  const firstMonth = formatMoney(
    PLAN_PRICE_CENTS[currency].starter + US_REGISTRATION_FEE_CENTS[currency],
    currency,
  );
  return [
    {
      q: "What's my number, and can I keep the one that's on my trucks and my Google listing?",
      a: 'Either. Pick a new local number in the area code you choose, usually live in a minute or two, or bring the number your customers already know. Porting is free and self-serve: choose "Bring my number" at signup or start it later from settings, answer a few questions, and we handle the carrier paperwork and show you where the transfer is the whole way. Your number keeps working on your old carrier while it moves, usually a few days to two weeks, then switches to Loonext on a scheduled date. Nothing on your trucks or your listing has to change.',
      aCa: 'Either. Pick a new local Canadian number in the area code you choose, usually live in a minute or two, or bring the number your customers already know. Porting is free and self-serve: choose "Bring my number" at signup or start it later from settings, answer a few questions, and we handle the carrier paperwork and show you where the transfer is the whole way. Your number keeps working on your old carrier while it moves, often just a few days for a Canadian number, then switches to Loonext on a scheduled date. Nothing on your trucks or your listing has to change.',
    },
    {
      q: "Do we need to download an app?",
      a: "No. Loonext runs in the browser on any phone or computer. Add it to your home screen and it works like an app, push notifications included. Your crew is set up in the time it takes to open a link.",
    },
    {
      q: "Does it do phone calls too, or only texts?",
      a: "Both, on the same number, included on every plan with nothing to switch on. A customer calls and every teammate's Loonext rings at once, so whoever is free answers. Nobody free? They leave a voicemail we write down so you can read it between jobs, and they get an automatic text back in your own words. You call customers back from the app and they see your business number, never anyone's cell. What it is not is a call center: no phone menus, no queues, no desk phones.",
    },
    {
      q: `Is it really ${starter} for the whole team?`,
      a: `Yes. ${starter} a month for up to 3 people on Starter, ${pro} for up to 15 on Pro. We don't charge per user. One thing to know up front: there's also a one-time ${registration} fee to register with the phone companies, so your first month is ${firstMonth} and every month after is ${starter}. ${crewElsewhere(currency)}; on Loonext it's ${pro}, flat.`,
      aCa: `Yes. ${starter} a month for up to 3 people on Starter, ${pro} for up to 15 on Pro. We don't charge per user, and texting Canadian customers has no registration fee and no setup cost, so ${starter} is ${starter} from your first month on. ${crewElsewhere(currency)}; on Loonext it's ${pro}, flat.`,
    },
    {
      q: "What counts as a text I send?",
      a: "Each text you send counts. A plain text up to 160 characters is one; longer texts, or texts with emoji, count as more than one, and the composer shows you the count before you send, so there's no mystery. Receiving texts is always free and unlimited. Receiving photos is free too, and they're saved for you; storage is free, with no caps. Texting is included under our automated fair-use policy, and almost every crew stays well inside it without thinking about it.",
    },
    {
      q: "Why does texting US customers take about a week?",
      a: "The phone companies require every business that texts to register first. It's an industry rule, not a Loonext rule, and every provider has to do it. Approval usually lands in 3 to 7 business days, about a week. We file yours the minute you pay and email you the moment it's approved. The whole time, receiving texts already works.",
      only: "us",
    },
    {
      q: "When can I start texting customers?",
      a: "Right away. Your Loonext number is active usually a minute or two after you sign up, and you can text Canadian customers the same day. No registration, no fee, no waiting. Receiving texts works immediately too.",
      only: "ca",
    },
    {
      q: "Can we also text US customers?",
      // The fee lands on a CANADIAN invoice here, which is why it is read with
      // this list's currency and not fixed to USD: a Canadian workspace that
      // turns on US texting is charged US_REGISTRATION_FEE_CENTS.cad.
      a: `Yes, when you're ready. You can turn on US texting anytime from settings. That's the point where the one-time ${registration} US registration and the roughly one-week carrier approval apply, because US phone companies require every business to register. Until you turn it on, texting Canadian customers stays free of both.`,
      only: "ca",
    },
    {
      q: "Can customers text us photos?",
      a: "Yes, both directions, on every plan, nothing to turn on. Photos customers send come through in the conversation, full size, and receiving them is free. Sending photos back is included too, under the same fair-use policy as your texts, and every photo is stored free with no caps.",
    },
    {
      q: "What happens if we go over our included texting?",
      a: "Nothing surprising. We email you at 80% and again at 100% of your included texting, and past it extra texts bill at a small per-text rate, up to a spending cap you control that stops things before they run away. The exact rates live in our fair use policy.",
    },
    {
      q: "What happens if I cancel?",
      a: "Your subscription is month to month. Cancel anytime from your billing settings, no phone call required. We hold your number for 30 days after cancellation, so if you come back within a month, you keep it.",
    },
    {
      q: `What's the one-time ${registration} fee?`,
      a: "It covers registering your business with the phone companies so you're allowed to text customers. They charge a real fee to review and approve every business, and we pay it on your behalf, including a resubmission if the first try bounces. You pay it once, ever: cancel and come back later and you won't pay it again.",
      only: "us",
    },
  ];
}

/**
 * The US list, which is the SSR default (country-context.tsx).
 *
 * #328 note, the same one pricing-data.ts carries about `PLANS`: this is built
 * with USD, so the Canada-only entries inside it hold US figures. Nothing
 * renders it — `faqsForCountry` rebuilds the list in the reader's own currency
 * — and it is exported for the tests that read the country-neutral answers.
 */
export const HOME_FAQS: readonly HomeFaq[] = homeFaqs("usd");

/** The visible question/answer list for one country: build it in the currency
 *  that country is billed in, filter the single-country entries out of the
 *  other country, then apply any Canada wording override. */
export function faqsForCountry(country: Country): { q: string; a: string }[] {
  return homeFaqs(currencyForCountry(country))
    .filter((f) => !f.only || f.only === country)
    .map((f) => ({
      q: country === "ca" && f.qCa ? f.qCa : f.q,
      a: country === "ca" && f.aCa ? f.aCa : f.a,
    }));
}

/* Section CSS, prefix "frq-". One inert style block (repo pattern),
   unlayered on purpose so these base declarations beat Tailwind utilities.
   The only transitions (glyph turn + color) are gated behind
   prefers-reduced-motion: no-preference; without it, states swap instantly.
   No hairlines (Law 10): the rows are white cards on the Frost wash. */
const CSS = `
.frq-item summary {
  position: relative;
  list-style: none;
  cursor: pointer;
  padding: 1.125rem 3.25rem 1.125rem 1.375rem;
}
.frq-item summary::-webkit-details-marker {
  display: none;
}
/* CSS-only plus/minus: two bars; the vertical one lies down when open. */
.frq-item summary::before,
.frq-item summary::after {
  content: "";
  position: absolute;
  right: 1.375rem;
  top: calc(50% - 1px);
  width: 0.75rem;
  height: 2px;
  border-radius: 1px;
  background: var(--fr-ink-55);
}
.frq-item summary::after {
  transform: rotate(90deg);
}
.frq-item[open] > summary::after {
  transform: rotate(0deg);
}
.frq-item summary:hover::before,
.frq-item summary:hover::after,
.frq-item summary:focus-visible::before,
.frq-item summary:focus-visible::after {
  background: var(--fr-olive);
}
/* Light-ground focus: 2px cobalt outline, 2px offset (§7). */
.frq-item summary:focus-visible {
  outline: 2px solid var(--fr-olive);
  outline-offset: 2px;
  border-radius: 12px;
}
@media (prefers-reduced-motion: no-preference) {
  .frq-item summary::before,
  .frq-item summary::after {
    transition:
      transform 200ms ease-out,
      background-color 200ms ease-out;
  }
}
`;

function FaqList({ items }: { items: { q: string; a: string }[] }) {
  return (
    <>
      {items.map((item) => (
        <details key={item.q} className="frq-item fr-card rounded-xl">
          <summary className="font-body-mkt text-base font-semibold text-[color:var(--fr-ink)]">
            {item.q}
          </summary>
          <p className="font-body-mkt px-[1.375rem] pb-5 text-[0.9375rem] leading-[1.65] text-[color:var(--fr-ink-70)]">
            {item.a}
          </p>
        </details>
      ))}
    </>
  );
}

export function Faq() {
  return (
    <FrSection ground="frost" id="faq">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h2 className="fr-h2 max-w-2xl">Fair questions, straight answers.</h2>

      {/* The two lists never coexist: SSR renders the US set (the default), and
          a returning Canadian swaps to the Canada set after hydration. */}
      <div className="mx-auto mt-12 max-w-3xl space-y-3">
        <CountryOnly country="us">
          <FaqList items={faqsForCountry("us")} />
        </CountryOnly>
        <CountryOnly country="ca">
          <FaqList items={faqsForCountry("ca")} />
        </CountryOnly>
      </div>
    </FrSection>
  );
}
