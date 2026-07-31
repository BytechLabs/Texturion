/**
 * /features/calls, on the v4 "FIRST RESPONSE" FEATURE template
 * (DESIGN-DIRECTION v4 §6, COPY-DECK v2).
 *
 * WHY THIS PAGE EXISTS (#491). Calling has shipped on every plan since
 * D36–D43 and the marketing site never had a page for it, so the product read
 * as a texting tool with a dialer bolted on. The founder's words: "instead of
 * making it look like our platform is for texts only."
 *
 * THE OBJECTION IT HAS TO ANSWER is not "can it make calls". It is "so it is a
 * texting app that also dials out". The answer is the pair the visual shows:
 * an incoming call ringing the WHOLE CREW, and the voicemail it becomes,
 * written down, when they were all on a roof.
 *
 * Dateline `WHOEVER IS FREE PICKS UP` → H1 → the ringing card + the voicemail
 * it becomes → the core idea → use cases → what it is NOT → Truth Strip →
 * pricing snippet → related → unique FAQ → Frost CTA band.
 *
 * Every claim here is checked against `lib/marketing/llms-txt.ts` and
 * docs/CALLS-V2.md. The deletions matter as much as the features: D43 removed
 * cell forwarding, so no sentence on this page may imply a call reaches a
 * personal phone. buildMetadata + BreadcrumbList JSON-LD; no FAQPage.
 */

import Link from "next/link";
import type { Metadata } from "next";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { PanelFrame } from "@/components/marketing/fr";
import { CallVisual } from "@/components/marketing/features/call-visual";
import {
  FeatureCta,
  FeatureFaq,
  FeatureHero,
  FeatureSection,
  PricingSnippet,
  RelatedLinks,
  TruthStripSection,
  UseCaseSteps,
} from "@/components/marketing/features/feature-page";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";
import { ACTIVATION_CLAIM } from "@/lib/marketing/activation";

const PATH = "/features/calls";

export const metadata: Metadata = buildMetadata({
  title: "Calls and voicemail on your business number",
  description:
    "Incoming calls ring your whole crew in the app, so whoever is free answers. Missed callers leave a voicemail you can read and get a text back. Included on every plan, $29/mo flat for the team.",
  path: PATH,
});

export default function CallsPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Calls and voicemail", path: PATH },
        ])}
      />

      <FeatureHero
        dateline="WHOEVER IS FREE PICKS UP"
        title="Your number rings the whole crew, not one person's pocket."
        sub="A customer calls the number on your van. Every teammate's Loonext rings at once and whoever is free takes it. Nobody picks up because you're all under a sink? They leave a voicemail, we write it down so you can read it between jobs, and they get a text back before they call the next business. Calling is included on every plan, with nothing to switch on."
        panel={
          <PanelFrame
            caption="Karen calls the shop line at 4:40, and the 8:52 voicemail nobody could take."
            ariaLabel="An incoming call in Loonext ringing three teammates, above a voicemail with its transcript"
          >
            <CallVisual />
          </PanelFrame>
        }
      />

      <FeatureSection
        ground="frost"
        eyebrow="The core idea"
        heading="The app is the phone."
      >
        <p>
          There is no forwarding, no bridge to somebody&apos;s cell, and no
          handset to buy. The call arrives inside Loonext on every phone and
          computer the crew is signed in on, and the first person to hit Answer
          gets it. The rest stop ringing. That is the whole mechanism, and it
          is why a call no longer depends on one person being free.
        </p>
        <p>
          When you call a customer back, it goes out from your business number,
          never from the phone in your hand. They see the same number they
          called, they can call it again, and no tech ever hands out a personal
          mobile to get a job done.
        </p>
        <p>
          A call is a first-class part of the conversation, not a separate log.
          It sits in the customer&apos;s thread beside their texts, so the
          person who picks up next reads what was said last time instead of
          starting over.
        </p>
      </FeatureSection>

      <UseCaseSteps
        ground="white"
        eyebrow="Use it like this"
        heading="Three calls a week that used to go somewhere else."
        steps={[
          {
            title: "The one nobody could take",
            body: "Four of you are on jobs at 8:52 pm. The caller leaves a voicemail, Loonext writes it down, and it arrives as something you can read at a red light instead of a badge you have to find somewhere quiet to listen to. They get a text back in your own words, so the job is still yours in the morning.",
          },
          {
            title: "The one the office should take",
            body: "Screening tells you who is calling before you commit to the conversation, and caller ID name goes out with your calls as well as arriving with theirs. If it turns out to be a job for someone else, transfer it to them mid-call rather than asking the customer to hang up and dial again.",
          },
          {
            title: "The one that becomes work",
            body: "The customer describes a job on the phone. Turn that call into a task with an owner, an address and a due date, linked back to the call it came from, so \"book the Hendersons for Tuesday\" stops living in the head of whoever answered.",
          },
        ]}
      />

      <FeatureSection
        eyebrow="What it is not"
        heading="A shared line, not a call center."
      >
        <p>
          There are no phone menus, no press-one-for-service, no hold queues,
          and no agent scoring. A caller does not meet a robot; they meet
          whoever on your crew is free. That is a deliberate limit, and it is
          the right one for a business where the person who answers is often
          the person who does the work.
        </p>
        <p>
          There is no desk phone and no SIP handset to configure, and calls do
          not forward to a cell. Loonext needs microphone permission on the
          device you answer from, and a phone with the app closed is reached by
          a push notification rather than a ring, so the calls that matter most
          are the ones you have notifications turned on for.
        </p>
        <p>
          Calls are not recorded. Voicemails are, because the caller chose to
          leave one, and the recording plus its transcript live in the
          conversation like any other message.
        </p>
      </FeatureSection>

      <TruthStripSection
        heading="The plain facts"
        items={[
          {
            text: "Calling is included on every plan, both directions, with nothing to turn on and no add-on to buy.",
            good: true,
          },
          {
            text: "Starter includes 2,500 calling minutes a month and Pro includes 6,000, shared across incoming and outgoing. A minute counts only when somebody actually talked; ringing never does.",
          },
          {
            text: "Voicemail transcripts are written by Lou, our assistant, and are capped at 500 a month per workspace. Past the cap the recording still arrives, just without the write-up.",
          },
          {
            text: "No cell forwarding, no desk phones, no phone menus or queues. The app is the phone, and it needs microphone permission to be one.",
          },
        ]}
      />

      <PricingSnippet>
        <p>
          Calling costs nothing extra: $29/mo on Starter covers up to 3 people
          and $79/mo on Pro covers up to 15, and calls are included at both
          prices. Minutes work the way texting does, on a fair-use basis rather
          than a hard cap, with a spending limit you set and an email at 80%
          and again at 100% before a single paid minute is billed. The concrete
          numbers live in our{" "}
          <Link
            href="/legal/fair-use"
            className="font-medium text-[color:var(--fr-olive)] underline-offset-2 hover:underline"
          >
            fair use policy
          </Link>
          .
        </p>
      </PricingSnippet>

      <RelatedLinks
        heading="The rest of the line"
        intro="Calls are one half of what arrives on your business number. Here is the other half, and where the flat price stands next to the per-user tools."
        links={[
          {
            label: "Shared inbox",
            href: "/features/shared-inbox",
            hint: "Every customer text in one inbox the whole crew can see.",
          },
          {
            label: "Your business number",
            href: "/features/business-number",
            hint: "A local number that belongs to the business, ported in free.",
          },
          {
            label: "Missed calls, lost jobs",
            href: "/blog/missed-calls-lost-jobs-text-back-playbook",
            hint: "What a good text-back actually says, with lines to steal.",
          },
          {
            label: "Loonext vs Quo",
            href: "/compare/quo",
            hint: "Where a full phone system genuinely beats a shared line.",
          },
        ]}
      />

      <FeatureFaq
        heading="Call questions, straight answers."
        faqs={[
          {
            q: "Does the call ring my actual cell phone?",
            a: "No, and that is deliberate. It rings inside Loonext on whatever device you are signed in on, which is usually your cell. There is no call forwarding: forwarding meant the call left the product, so the crew could not see it, the transcript did not exist, and it landed on one person again. If the app is closed, a push notification brings you to it.",
          },
          {
            q: "What happens when nobody answers?",
            a: "The caller reaches your voicemail, the recording lands in their conversation, and Lou writes it down so you can read it instead of listening. They also get an automatic text back in words you wrote yourself, which is usually what turns a missed call into a booked job rather than a lost one.",
          },
          {
            q: "Can two people answer the same call?",
            a: "No. Everyone's phone rings, the first person to answer gets the call, and everyone else stops ringing. The call then shows in the shared conversation, so the rest of the crew can see it happened and who took it without anyone having to say so.",
          },
          {
            q: "What number do customers see when we call them?",
            a: "Your business number, every time, from every teammate and every device. Caller ID name goes out with it where the carriers support it. Nobody's personal mobile is ever presented, so a customer cannot start calling a tech directly by accident.",
          },
          {
            q: "Can I transfer a call to someone else on the crew?",
            a: "Yes. Put the caller on hold and transfer to a teammate mid-call, so the customer is handed over rather than asked to hang up and dial again. Screening tells you who is calling before you take it, which is usually what decides whether you answer or let it go to voicemail.",
          },
          {
            q: "Are calls recorded?",
            a: "No. Only voicemails, because the caller chose to leave one. Call recording brings consent rules that vary by state and province, and we would rather not ship it than ship it in a way that quietly puts you on the wrong side of them.",
          },
          {
            q: "Do I need a desk phone or a special headset?",
            a: "Neither. Any phone or computer with a microphone and the app open is the phone. That is the whole hardware list, and there is nothing to configure, register, or plug in.",
          },
        ]}
      />

      <FeatureCta
        heading="Stop losing the calls nobody could take."
        sub={`Calls and texts on one business number, answered by whoever is free, ${ACTIVATION_CLAIM}. See the price.`}
      />
    </>
  );
}
