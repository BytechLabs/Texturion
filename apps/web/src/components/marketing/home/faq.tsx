/**
 * FAQ (§H12). Native <details> accordion (styled, no JS island). The "what's my
 * number / can I keep it" objection sits first. All Q&A per §H12.
 *
 * DESIGN-DIRECTION §0: no section number, no ledger spine, no status-spine
 * costume. A composed <Display> headline opens it; each entry is a paper panel
 * with a warm hairline and a petrol edge that lights when open. Sits on the
 * paper ground. Server component.
 */

import { ChevronDown } from "lucide-react";

import { Section } from "@/components/marketing/ui/section";
import { Display } from "@/components/marketing/display";

const FAQS = [
  {
    q: "What's my number, and can I keep the one that's on my trucks and my Google listing?",
    a: "Yes, bring the number your customers already know. When you sign up, choose “Bring my number,” tell us your current carrier details, and upload a recent bill; we handle the paperwork with the phone companies from there. Transfers are free for US and Canadian numbers, and they typically take about 1 to 7 business days. Your number keeps working on your current carrier the whole time and switches to JobText on the transfer date, nothing goes dark. Texting through JobText turns on once the transfer completes, and we show you exactly where it is at each step. In a hurry to start texting today? Grab a new local number now and transfer your old one alongside it.",
  },
  {
    q: "Do we need to download an app?",
    a: "No. JobText runs in the browser on any phone or computer. Add it to your home screen and it works like an app, push notifications included. Your crew is set up in the time it takes to open a link.",
  },
  {
    q: "Is it really $29 for the whole team?",
    a: "Yes, $29 a month for up to 3 people on Starter, $79 for up to 10 on Pro. We don't charge per user. One thing to know up front for US shops: there's also a one-time $29 fee to register with the phone companies, so your first month is $58 and every month after is $29. A 6-person crew on a typical per-user tool runs $90 to $114 a month; on JobText it's $79, flat.",
  },
  {
    q: "What counts as one of my 500 texts?",
    a: "Each text you send counts. A plain text up to 160 characters is one; longer texts, or texts with emoji, count as more than one, and the composer shows you the count before you send, so there's no mystery. Sending a photo counts as three. Receiving texts and photos is always free and unlimited. In practice, 500 covers roughly 20 to 25 plain texts every working day for a 2 to 3 person shop; if you send a lot of photos, it's closer to 150 photo-sends a month. Go over and it's 3¢ a text, with a cap you set.",
  },
  {
    q: "Why does texting US customers take about a week?",
    a: "The phone companies require every business that texts to register first, it's an industry rule, not a JobText rule, and every provider has to do it. Approval usually lands in 3 to 7 business days (about a week). We file yours the minute you pay and email you the moment it's approved. The whole time, receiving texts already works, and if you're in Canada you can text Canadian customers right away.",
  },
  {
    q: "We're in Canada. What's different?",
    a: "You can text Canadian customers immediately, no US registration needed. If you later want to text US numbers, you can turn that on anytime; the one-time $29 fee and the roughly-one-week approval apply then.",
  },
  {
    q: "Can customers text us photos?",
    a: "Yes. Photos come through in the conversation, full size, and receiving them is free. You can send photos back too, each one counts as three texts from your monthly allowance.",
  },
  {
    q: "What happens if we go over 500 texts?",
    a: "Nothing surprising. Extra texts are 3¢ each on Starter (2.5¢ on Pro), we email you at 80% and 100% of your allowance, and a spending cap, set to 3× your allowance by default, stops things before they run away. You control the cap.",
  },
  {
    q: "What happens if I cancel?",
    a: "Your subscription is month to month, cancel anytime from your billing settings, no phone call required. We hold your number for 30 days after cancellation, so if you come back within a month, you keep it.",
  },
  {
    q: "What's the one-time $29 fee?",
    a: "It covers registering your business with the phone companies so you're allowed to text customers, they charge a real fee to review and approve every business, and we pay it on your behalf (including a resubmission if the first try bounces). You pay it once, ever: cancel and come back later and you won't pay it again. Canadian businesses that don't text US numbers never pay it at all.",
  },
] as const;

export function Faq() {
  return (
    <Section id="faq" defer intrinsic={680}>
      <div className="mx-auto max-w-3xl">
        <p className="font-mono-mkt flex items-center justify-center gap-2.5 text-[13px] font-medium tracking-[0.04em] text-[color:var(--graphite)]">
          <span aria-hidden className="h-px w-6 bg-[color:var(--petrol)]/50" />
          Questions
        </p>
        <Display as="h2" size="h2" className="mt-4 text-center">
          Fair questions, straight answers.
        </Display>

        <div className="mt-12 space-y-2">
          {FAQS.map((item) => (
            <details
              key={item.q}
              className="group relative overflow-hidden rounded-[14px] border border-[color:var(--hairline)] bg-[color:var(--paper-2)] pl-3 open:border-[color:var(--petrol)]/40"
            >
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-[2px] rounded-l-[14px] bg-[color:var(--hairline)] transition-colors group-open:bg-[color:var(--petrol)]"
              />
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 text-left text-[16px] font-medium text-[color:var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--petrol)]/50 [&::-webkit-details-marker]:hidden">
                <span className="flex-1">{item.q}</span>
                <ChevronDown
                  className="size-5 shrink-0 text-[color:var(--graphite)] transition-transform duration-200 group-open:rotate-180"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </summary>
              <p className="px-4 pb-5 pr-8 text-[15px] leading-relaxed text-[color:var(--ink-70)]">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}
