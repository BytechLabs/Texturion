/**
 * /features/shared-inbox, the flagship feature page, on the v4 "FIRST
 * RESPONSE" FEATURE template (DESIGN-DIRECTION v4 §6, COPY-DECK v2).
 *
 * Dateline `1 OWNER PER CONVERSATION` → H1 "Every customer text, in one
 * inbox the whole crew can see." → the real inbox staged mid-task (assign
 * menu open) in a Panel Frame → use cases (morning triage, one owner per
 * thread, search as memory) → Truth Strip (receiving texts is free and
 * unlimited; photos are free to receive and saved in your storage) → pricing
 * snippet → unique FAQ → Frost CTA band.
 *
 * Every number is a verified product/billing fact. buildMetadata +
 * BreadcrumbList JSON-LD; no FAQPage.
 */

import type { Metadata } from "next";

import { CountryOnly } from "@/components/marketing/country";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { PanelFrame } from "@/components/marketing/fr";
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
import { InboxListVisual } from "@/components/marketing/features/inbox-list-visual";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/features/shared-inbox";

export const metadata: Metadata = buildMetadata({
  title: "Shared text inbox for the whole crew",
  description:
    "Every customer text, in one inbox the whole crew can see. Assign one owner per conversation, reply from any phone, search everything. $29/mo flat for the team.",
  path: PATH,
});

export default function SharedInboxPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Shared inbox", path: PATH },
        ])}
      />

      <FeatureHero
        dateline="1 OWNER PER CONVERSATION"
        title="Every customer text, in one inbox the whole crew can see."
        sub="A customer texts your business number and the conversation shows up on every phone on the team. Whoever is free picks it up, it gets exactly one owner, and nobody has to ask around about who answered the Hendersons. The number, the history, and the customers stay with the business."
        panel={
          <PanelFrame
            chromeUrl="loonext.com/inbox"
            caption="The Reyes Plumbing inbox, mid-morning: Priya assigns the new drain call to Dale."
            ariaLabel="The Reyes Plumbing inbox in Loonext, with the assign menu open on a new conversation"
          >
            <InboxListVisual />
          </PanelFrame>
        }
      />

      <FeatureSection
        ground="frost"
        eyebrow="The core idea"
        heading="A text stops being one person's problem."
      >
        <p>
          When a customer texts your business number, Loonext turns that text
          into a conversation everyone can see. Priya sees it. Dale sees it.
          Marcus sees it. Whoever is free picks it up, and because the whole
          crew is looking at the same thread, two people never reply to the
          same customer, and nobody assumes someone else already did.
        </p>
        <p>
          Every conversation carries one owner and one status: new, open,
          waiting, or closed. Filter to Open and you&apos;re looking at exactly
          the work that still needs a human. Filter to Mine and you&apos;re
          looking at your own. It&apos;s the difference between a phone that
          buzzes at random and a queue you can actually clear.
        </p>
      </FeatureSection>

      {/* Signal White here, not the default Frost: "The core idea" band above
          is Frost, and bands alternate (Law 10; the ground change IS the
          separator). White also keeps the eyebrow's Frost chip legible. */}
      <UseCaseSteps
        ground="white"
        eyebrow="Use it like this"
        heading="Three jobs the inbox does every day."
        steps={[
          {
            title: "Morning triage",
            body: "Open the inbox with your first coffee. Everything that came in overnight is sitting in one list: assign the urgent one to whoever's closest, reply to the easy ones, and the day starts sorted instead of scattered across three personal phones.",
          },
          {
            title: "One owner per thread",
            body: "Assign a conversation and it shows on every phone: an owner chip on the row, a line in the thread. One owner means no double replies and no silent gaps, and anyone can still step in when they're needed.",
          },
          {
            title: "Search as memory",
            body: "Every message and contact is searchable. \"What did we quote the Nguyens in March?\" takes five seconds, not a phone poll around the crew. The answer is in the thread, with the matching text highlighted.",
          },
        ]}
      />

      <FeatureSection
        eyebrow="Notes stay internal"
        heading="Talk about the job without texting the customer."
      >
        <p>
          Some of what a crew needs to say should never leave the building:
          gate codes, &quot;quote high, last visit ran long&quot;, the quirks
          of a property. Internal notes live right inside the conversation,
          drawn in an unmistakable marked card with a lock, and they are never
          sent to the customer. The next person who opens the thread has the
          context exactly where they need it.
        </p>
        <p>
          And the inbox is live. When Dale replies, the conversation updates on
          every other phone: the status changes, the snippet updates, the
          thread re-sorts. Nobody refreshes, nobody wonders, nobody replies
          twice.
        </p>
      </FeatureSection>

      <TruthStripSection
        heading="The plain facts"
        items={[
          {
            text: "Receiving texts is free and unlimited on every plan. Photos are free to receive and saved in your included storage.",
            good: true,
          },
          {
            text: "Starter seats 3 people, Pro seats 15. Real limits, never per-seat billing.",
          },
          {
            text: "Loonext is a texting inbox, not a phone system. The optional call forwarding add-on ($8/mo) rings your cell and texts back missed calls.",
          },
        ]}
      />

      <PricingSnippet>
        <p>
          The shared inbox is the whole product, at one flat price for the
          whole crew: $29/mo on Starter for up to 3 people and one local
          number, $79/mo on Pro for up to 15 people and two numbers. 500
          outgoing texts a month on Starter, 2,500 on Pro, and receiving texts
          is always free and unlimited.
        </p>
        <CountryOnly country="us">
          <p>
            US shops also pay a one-time $29 to register with the phone
            companies, charged once, ever, so the first month is $58 and every
            month after is $29.
          </p>
        </CountryOnly>
        <CountryOnly country="ca">
          <p>
            Texting Canadian customers has no registration and no setup fee, so
            $29 is $29 from your first month on.
          </p>
        </CountryOnly>
      </PricingSnippet>

      <RelatedLinks
        heading="See the shared inbox in your trade"
        intro="The inbox is the same for every crew, but the way it earns its keep is specific. Here's how it plays out in a few trades, and where the flat price stands next to the per-user tools."
        links={[
          {
            label: "Texting for plumbers",
            href: "/for/plumbers",
            hint: "Photo triage, on-my-way texts, and after-hours texts in one shared inbox.",
          },
          {
            label: "Texting for HVAC",
            href: "/for/hvac",
            hint: "The no-heat morning rush, triaged across the whole crew.",
          },
          {
            label: "Templates and tags",
            href: "/features/templates-and-tags",
            hint: "Saved replies, sell-pipeline tags, and done-marks inside the inbox.",
          },
          {
            label: "Loonext vs Heymarket",
            href: "/compare/heymarket",
            hint: "A shared inbox at a flat price, next to a per-user platform.",
          },
        ]}
      />

      <FeatureFaq
        heading="Shared inbox questions, straight answers."
        faqs={[
          {
            q: "How many people can share one inbox?",
            a: "Three on Starter, fifteen on Pro, a flat price either way, never per seat. Everyone shares the same inbox and the same business number; they just open a link on their own phone. There are no extra charges as you add teammates up to your plan's limit.",
          },
          {
            q: "Can two people reply to the same customer by accident?",
            a: "It's designed against. Every conversation carries one assignee and a status, and the list updates in realtime, so if Dale is replying, the rest of the crew sees the conversation move and knows it's handled. Anyone can still jump in when they need to; the point is that nobody has to guess.",
          },
          {
            q: "Do customers know it's a shared inbox and not one person's phone?",
            a: "No. To the customer it's a normal text conversation with your business. Internal notes and assignments live inside Loonext and are never sent. What the customer sees is a single, consistent business number that always gets answered.",
          },
          {
            q: "What happens to conversations when a teammate leaves?",
            a: "They stay. The number, the contacts, and every conversation belong to the business, not to the person who happened to reply. Deactivate a departing teammate in settings and their conversations remain right where they are, ready for whoever picks them up next.",
          },
          {
            q: "Is the inbox live, or do I have to refresh?",
            a: "It's live. New messages, status changes, and replies appear across every phone as they happen, with a quiet notification when a text lands in a conversation you're not currently viewing. You never refresh to see what's new.",
          },
          {
            q: "Can I search old conversations?",
            a: "Yes. Every message and every contact is searchable from the inbox. Type a name, a number, or a phrase like 'water heater' and you get the conversations and contacts that match, with the matching text highlighted.",
          },
        ]}
      />

      <FeatureCta
        heading="Give your crew one inbox to share."
        sub="A local business number and a shared text inbox the whole team can see, live in minutes. See the price, pay, and start today."
      />
    </>
  );
}
