import { FrSection } from "@/components/marketing/fr";

/**
 * S11 · FAIR QUESTIONS (COPY-DECK v2). Conversion job: handle the remaining
 * objections on this page so nobody leaves to "think about it."
 *
 * Native <details>/<summary> disclosures (§7: the FAQ works with zero JS),
 * drawn as white cards on the Frost band, separated by space and radius, no
 * hairline rules anywhere (Law 10). Numbers inside FAQ prose stay in the
 * body face (the §3 prose exception). Copy verbatim per deck; no em-dashes.
 */

export const HOME_FAQS: readonly { q: string; a: string }[] = [
  {
    q: "What's my number, and can I keep the one that's on my trucks and my Google listing?",
    a: 'Either. Pick a new local number in the area code you choose, usually live in a minute or two, or bring the number your customers already know. Porting is free and self-serve: choose "Bring my number" at signup or start it later from settings, answer a few questions, and we handle the carrier paperwork and show you where the transfer is the whole way. Your number keeps working on your old carrier while it moves, usually a few days to two weeks for US numbers and often faster in Canada, then switches to Loonext on a scheduled date. Nothing on your trucks or your listing has to change.',
  },
  {
    q: "Do we need to download an app?",
    a: "No. Loonext runs in the browser on any phone or computer. Add it to your home screen and it works like an app, push notifications included. Your crew is set up in the time it takes to open a link.",
  },
  {
    q: "Is it really $29 for the whole team?",
    a: "Yes. $29 a month for up to 3 people on Starter, $79 for up to 10 on Pro. We don't charge per user. One thing to know up front for US shops: there's also a one-time $29 fee to register with the phone companies, so your first month is $58 and every month after is $29. A 6-person crew on a typical per-user tool runs $90 to $114 a month; on Loonext it's $79, flat.",
  },
  {
    q: "What counts as one of my 500 texts?",
    a: "Each text you send counts. A plain text up to 160 characters is one; longer texts, or texts with emoji, count as more than one, and the composer shows you the count before you send, so there's no mystery. Receiving texts and photos is always free and unlimited. In practice, 500 covers roughly 20 to 25 plain texts every working day for a 2 or 3 person shop. Go over and it's 3¢ a text, with a cap you set. Sending photos is its own add-on; see the photos question below.",
  },
  {
    q: "Why does texting US customers take about a week?",
    a: "The phone companies require every business that texts to register first. It's an industry rule, not a Loonext rule, and every provider has to do it. Approval usually lands in 3 to 7 business days, about a week. We file yours the minute you pay and email you the moment it's approved. The whole time, receiving texts already works, and if you're in Canada you can text Canadian customers right away.",
  },
  {
    q: "We're in Canada. What's different?",
    a: "You can text Canadian customers immediately, no US registration needed. If you later want to text US numbers, you can turn that on anytime; the one-time $29 fee and the roughly one-week approval apply then.",
  },
  {
    q: "Can customers text us photos?",
    a: "Yes. Photos come through in the conversation, full size, and receiving them is free on every plan, nothing to turn on. Sending photos back is an add-on: picture messaging is $5 a month and includes 150 outgoing picture messages, and each photo you send also counts as three texts from your allowance. We email you at 80% and again at 100% of your included picture messages, and if a photo can't go, the composer tells you right there; the words in your message still send.",
  },
  {
    q: "What happens if we go over 500 texts?",
    a: "Nothing surprising. Extra texts are 3¢ each on Starter, 2.5¢ on Pro. We email you at 80% and 100% of your allowance, and a spending cap, set to three times your allowance by default, stops things before they run away. You control the cap.",
  },
  {
    q: "What happens if I cancel?",
    a: "Your subscription is month to month. Cancel anytime from your billing settings, no phone call required. We hold your number for 30 days after cancellation, so if you come back within a month, you keep it.",
  },
  {
    q: "What's the one-time $29 fee?",
    a: "It covers registering your business with the phone companies so you're allowed to text customers. They charge a real fee to review and approve every business, and we pay it on your behalf, including a resubmission if the first try bounces. You pay it once, ever: cancel and come back later and you won't pay it again. Canadian businesses that don't text US numbers never pay it at all.",
  },
];

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
  background: var(--fr-cobalt);
}
/* Light-ground focus: 2px cobalt outline, 2px offset (§7). */
.frq-item summary:focus-visible {
  outline: 2px solid var(--fr-cobalt);
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

export function Faq() {
  return (
    <FrSection ground="frost" id="faq">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h2 className="fr-h2 max-w-2xl">Fair questions, straight answers.</h2>

      <div className="mx-auto mt-12 max-w-3xl space-y-3">
        {HOME_FAQS.map((item) => (
          <details key={item.q} className="frq-item fr-card rounded-xl">
            <summary className="font-body-mkt text-base font-semibold text-[color:var(--fr-ink)]">
              {item.q}
            </summary>
            <p className="font-body-mkt px-[1.375rem] pb-5 text-[0.9375rem] leading-[1.65] text-[color:var(--fr-ink-70)]">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </FrSection>
  );
}
