/**
 * FAQ (Track B) — §3.11 / COPY §H12. Native <details> accordion (styled, no JS
 * island). NO FAQPage JSON-LD (BLUEPRINT §3.11/§11.2 finding — the rich result
 * died May 2026; commercial FAQPage is downside-only). The "what's my number /
 * can I keep it" objection moves UP to the first cluster (finding). All Q&A
 * verbatim from §H12. Server component.
 */

import { ChevronDown } from "lucide-react";

import { Section } from "@/components/marketing/ui/section";

const FAQS = [
  {
    q: "What's my number — and can I keep the one that's on my trucks and my Google listing?",
    a: "JobText gives you a new local number in the area code you choose, and today it can't take over your existing number — number porting is on our list, and we won't pretend it's here before it is. Here's what to do in the meantime so you don't lose the number you've built up: forward your existing number to your new JobText number (your phone carrier does this for calls in a couple of minutes), and start putting your JobText number on new signs, quotes, and your listing. Your old number keeps ringing and forwarding; new texts come to JobText, where the whole crew can see them. When porting ships, moving the number over will be one step.",
  },
  {
    q: "Do we need to download an app?",
    a: "No. JobText runs in the browser on any phone or computer. Add it to your home screen and it works like an app — push notifications included. Your crew is set up in the time it takes to open a link.",
  },
  {
    q: "Is it really $29 for the whole team?",
    a: "Yes — $29 a month for up to 3 people on Starter, $79 for up to 10 on Pro. We don't charge per user. One thing to know up front for US shops: there's also a one-time $29 fee to register with the phone companies, so your first month is $58 and every month after is $29. A 6-person crew on a typical per-user tool runs $90 to $114 a month; on JobText it's $79, flat.",
  },
  {
    q: "What counts as one of my 500 texts?",
    a: "Each text you send counts. A plain text up to 160 characters is one; longer texts, or texts with emoji, count as more than one — and the composer shows you the count before you send, so there's no mystery. Sending a photo counts as three. Receiving texts and photos is always free and unlimited. In practice, 500 covers roughly 20 to 25 plain texts every working day for a 2–3 person shop; if you send a lot of photos, it's closer to 150 photo-sends a month. Go over and it's 3¢ a text, with a cap you set.",
  },
  {
    q: "Why does texting US customers take about a week?",
    a: "The phone companies require every business that texts to register first — it's an industry rule, not a JobText rule, and every provider has to do it. Approval usually lands in 3–7 business days (about a week). We file yours the minute you pay and email you the moment it's approved. The whole time, receiving texts already works, and if you're in Canada you can text Canadian customers right away.",
  },
  {
    q: "We're in Canada. What's different?",
    a: "You can text Canadian customers immediately — no US registration needed. If you later want to text US numbers, you can turn that on anytime; the one-time $29 fee and the roughly-one-week approval apply then.",
  },
  {
    q: "Can customers text us photos?",
    a: "Yes. Photos come through in the conversation, full size, and receiving them is free. You can send photos back too — each one counts as three texts from your monthly allowance.",
  },
  {
    q: "What happens if we go over 500 texts?",
    a: "Nothing surprising. Extra texts are 3¢ each on Starter (2.5¢ on Pro), we email you at 80% and 100% of your allowance, and a spending cap — set to 3× your allowance by default — stops things before they run away. You control the cap.",
  },
  {
    q: "What happens if I cancel?",
    a: "Your subscription is month to month — cancel anytime from your billing settings, no phone call required. We hold your number for 30 days after cancellation, so if you come back within a month, you keep it.",
  },
  {
    q: "What's the one-time $29 fee?",
    a: "It covers registering your business with the phone companies so you're allowed to text customers — they charge a real fee to review and approve every business, and we pay it on your behalf (including a resubmission if the first try bounces). You pay it once, ever: cancel and come back later and you won't pay it again. Canadian businesses that don't text US numbers never pay it at all.",
  },
] as const;

export function Faq() {
  return (
    <Section id="faq">
      <div className="mx-auto max-w-3xl">
        <h2 className="display-h2 text-center text-foreground">
          Fair questions, straight answers.
        </h2>

        <div className="mt-12 divide-y divide-border border-y border-border">
          {FAQS.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-[17px] font-medium text-foreground [&::-webkit-details-marker]:hidden">
                {item.q}
                <ChevronDown
                  className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </summary>
              <p className="pb-5 pr-8 text-[15px] leading-relaxed text-muted-foreground">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}
