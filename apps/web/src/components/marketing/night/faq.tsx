import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";

/**
 * S6.5 — FAQ ("Quiet daylight" v3 spec §6 S6.5, copy deck S7 FAQ). Extracted
 * out of the dark final-CTA band into its own light section: white ground,
 * panel-less, native <details>/<summary> disclosures separated by hairlines.
 * Questions in Public Sans 600 --day-ink, answers --ink-70, a CSS-only
 * plus/minus glyph, petrol focus rings (light ground). Zero JS: the native
 * disclosure works without hydration, so no-JS users get a working FAQ.
 *
 * id="faq" is the anchor target for the footer's Product column (/#faq).
 * No FAQ JSON-LD on purpose: FAQ rich results are dead and the repo
 * deliberately omits it.
 */

/* Copy deck S7 FAQ, verbatim. Curly apostrophes only (eslint
   react/no-unescaped-entities); no em-dashes anywhere in this section. */
const FAQS: { q: string; a: string }[] = [
  {
    q: "Can I keep my current business number?",
    a: "Yes. Bring the number your customers already know or pick a new local one. Porting is self-serve and we walk you through it step by step.",
  },
  {
    q: "What’s a segment?",
    a: "It’s how carriers count outbound texts. One segment is up to 160 characters of plain text, about 70 if you use emoji, so a normal reply is one and a long one might be two or three. Starter includes 500 a month, Pro includes 2,500, and your dashboard shows included, used, and overage at all times. Inbound never counts.",
  },
  {
    q: "What’s the $29 registration fee?",
    a: "US carriers require every business that texts to register its number. The $29 covers that registration once, not yearly. We file the paperwork for you, and the carrier review is why US texting takes about a week to turn on.",
  },
  {
    q: "How do I cancel?",
    a: "From settings, yourself, any month you want. Plans are month to month, so the last month you pay for is the last month you use. Nobody calls to talk you out of it.",
  },
  {
    q: "How does the 30-day guarantee work?",
    a: "Run Loonext for a month. If it isn’t catching texts that turn into work, tell us within 30 days and we refund what you paid.",
  },
  {
    q: "Does the crew need new phones?",
    a: "No. Everyone signs in on the phone they already carry. Replies go out from the business number, so customers see one shop, not six cells.",
  },
];

/* Section CSS, prefix "nxq-". ONE inert style block (repo ledger-css pattern),
   unlayered on purpose so these base declarations beat Tailwind utilities.
   The only transitions (glyph turn, glyph color) are gated behind
   prefers-reduced-motion: no-preference; without it states still swap, they
   just swap instantly. */
const CSS = `
/* Panel-less list: items separated by hairlines, nothing heavier. */
.nxq-list > details + details {
  border-top: 1px solid var(--rule-light);
}
.nxq-item summary {
  position: relative;
  list-style: none;
  cursor: pointer;
  padding: 1.125rem 2.75rem 1.125rem 0;
}
.nxq-item summary::-webkit-details-marker {
  display: none;
}
/* CSS-only plus/minus: two bars; the vertical one lies down when open. */
.nxq-item summary::before,
.nxq-item summary::after {
  content: "";
  position: absolute;
  right: 0.25rem;
  top: calc(50% - 1px);
  width: 0.75rem;
  height: 2px;
  border-radius: 1px;
  background: var(--ink-55);
}
.nxq-item summary::after {
  transform: rotate(90deg);
}
.nxq-item[open] > summary::after {
  transform: rotate(0deg);
}
.nxq-item summary:hover::before,
.nxq-item summary:hover::after,
.nxq-item summary:focus-visible::before,
.nxq-item summary:focus-visible::after {
  background: var(--petrol);
}
/* Light-ground focus: 2px petrol outline, 2px offset. */
.nxq-item summary:focus-visible {
  outline: 2px solid var(--petrol);
  outline-offset: 2px;
  border-radius: 4px;
}
.nxq-a {
  padding: 0 2.75rem 1.25rem 0;
}
@media (prefers-reduced-motion: no-preference) {
  .nxq-item summary::before,
  .nxq-item summary::after {
    transition:
      transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1),
      background-color 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
}
`;

export function Faq() {
  return (
    <Section id="faq" defer intrinsic={640} className="bg-white">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <Reveal className="mx-auto max-w-2xl">
        {/* The deck gives the FAQ no visible heading; keep the landmark for
            AT without inventing copy. */}
        <h2 className="sr-only">FAQ</h2>
        <div className="nxq-list">
          {FAQS.map((item) => (
            <details key={item.q} className="nxq-item">
              <summary className="font-body-mkt text-base font-semibold text-[color:var(--day-ink)]">
                {item.q}
              </summary>
              <p className="nxq-a font-body-mkt text-[0.9375rem] leading-relaxed text-[color:var(--ink-70)]">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}
