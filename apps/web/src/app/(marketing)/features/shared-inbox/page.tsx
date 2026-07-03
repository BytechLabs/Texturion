/**
 * /features/shared-inbox — the flagship feature page (BLUEPRINT §2, §4).
 *
 * Head-term target ("shared sms inbox", "team text inbox"): 900+ words of
 * hand-written, page-specific content, its own unique FAQ (not a shared block),
 * and its own product visuals — the live inbox-list DOM and the steppable
 * thread deep-dive reused from the home §3.4 primitives. Every claim traces to
 * SPEC §1/§6 and DESIGN.md G4/G5. NO shared sentences with the other feature
 * pages. buildMetadata + BreadcrumbList JSON-LD; NO FAQPage (§11.2).
 */

import {
  ClipboardList,
  Lock,
  RefreshCw,
  Search,
  Users,
  UserSquare,
} from "lucide-react";
import type { Metadata } from "next";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { ThreadDeepDive } from "@/components/marketing/thread-demo/thread-deep-dive";
import { WATER_HEATER_SCRIPT } from "@/components/marketing/thread-demo/script";
import {
  FeatureCta,
  FeatureFaq,
  FeatureHero,
  FeatureSection,
  FeatureStrip,
  HonestDetails,
  MiniPricing,
  RelatedLinks,
} from "@/components/marketing/features/feature-page";
import { FramedShot } from "@/components/marketing/shot";
import { Illustration } from "@/components/marketing/illustration";
import { InboxListVisual } from "@/components/marketing/features/inbox-list-visual";
import { Section } from "@/components/marketing/ui/section";
import { Container } from "@/components/marketing/ui/container";
import { Reveal } from "@/components/marketing/ui/reveal";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/features/shared-inbox";

export const metadata: Metadata = buildMetadata({
  title: "Shared SMS inbox for your whole team",
  description:
    "One business number, one inbox the whole crew sees. Assign, status, note, tag, search, and mark texts done from any phone. Flat $29/mo for the team.",
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
        eyebrow="Shared inbox"
        title="One number. One inbox your whole crew can see."
        sub="Every text to your business number lands in a single inbox that everyone on the team opens — on their own phone, at the same time. No more forwarding screenshots, no more 'did anyone answer the Hendersons?' The conversation belongs to the business, not to whoever's holding the phone."
        truthChips={[
          "Everyone sees every text",
          "Works on any phone, no app",
          "Realtime — replies show up as they happen",
        ]}
        visual={<InboxListVisual />}
      />

      {/* Section 1 — one number, whole team (copy | inbox-list already in hero;
          this uses the steppable deep-dive as its second, richer visual). */}
      <Section>
        <Container>
          <div className="mx-auto mb-12 max-w-3xl">
            <p className="text-[13px] font-semibold text-primary">
              The core idea
            </p>
            <h2 className="display-h2 mt-2 text-foreground">
              A text stops being one person&apos;s problem.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              When a customer texts your business number, JobText turns that text
              into a conversation in a shared inbox. Priya sees it. Dale sees it.
              Marcus sees it. Whoever is free picks it up — and because everyone
              is looking at the same thread, two people never reply to the same
              customer, and nobody assumes someone else already did. The mess of
              a business run from one personal cell simply goes away: the number
              is the company&apos;s, the history is the company&apos;s, and the
              next person who opens the app is caught up in a glance.
            </p>
          </div>
          <Reveal>
            <ThreadDeepDive script={WATER_HEATER_SCRIPT} />
          </Reveal>
        </Container>
      </Section>

      {/* Section 2 — assign & status. */}
      <FeatureSection
        eyebrow="Assign & status"
        heading="One owner, one status, no double replies."
        visual={
          <FramedShot id="thread-open" className="mx-auto max-w-xl" />
        }
        wash
      >
        <p>
          Every conversation can be assigned to exactly one person — the tech
          who&apos;s closest, the office manager who took the first call,
          whoever should carry it. Assignment shows as a small avatar on the
          conversation and as a system line in the thread (&ldquo;Priya assigned
          this to Dale&rdquo;), so the whole crew knows who has it without a
          single &ldquo;who&apos;s got this one?&rdquo; text.
        </p>
        <p>
          Alongside the owner sits a status: <strong>New</strong> for the ones
          nobody has touched, <strong>Open</strong> for the ones in progress,{" "}
          <strong>Waiting</strong> for the ball that&apos;s in the
          customer&apos;s court, and <strong>Closed</strong> for the ones that
          are done. Filter the list to &ldquo;Open&rdquo; and you&apos;re
          looking at exactly the work that still needs a human. Filter to
          &ldquo;Mine&rdquo; and you&apos;re looking at your own. It is the
          difference between a phone that buzzes at random and a queue you can
          actually clear.
        </p>
      </FeatureSection>

      {/* Section 3 — notes. */}
      <FeatureSection
        eyebrow="Internal notes"
        heading="Talk about the job without texting the customer."
        visual={
          <FramedShot id="contact-panel" className="mx-auto max-w-xl" />
        }
        flip
      >
        <p>
          Some of what a crew needs to say about a job should never leave the
          building: &ldquo;gate code 4482, dog is friendly,&rdquo; &ldquo;last
          visit ran long, quote high,&rdquo; &ldquo;this is the third backup on
          that street.&rdquo; In JobText you write those as internal notes,
          right inside the conversation where they belong. Notes are drawn in an
          unmistakable amber card with a lock icon and an &ldquo;Internal
          note&rdquo; label — they are never sent to the customer, ever, and the
          design makes it impossible to confuse one for an outgoing text.
        </p>
        <p>
          Because the note lives in the thread, the next person to open the
          conversation has the context the way they need it: attached to the
          customer, in order, next to the messages it&apos;s about. No separate
          notes app, no side channel, no &ldquo;text me the gate code again.&rdquo;
        </p>
      </FeatureSection>

      {/* Section 4 — realtime + mark done. */}
      <FeatureSection
        eyebrow="Realtime & done-marks"
        heading="When Dale replies, everyone's phone shows it answered."
        visual={
          <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8">
            <Illustration
              id="shared-inbox"
              alt="An inbound text becomes a handled, checked-off task in the shared inbox."
            />
            <p className="mt-6 text-center text-[13px] leading-relaxed text-muted-foreground">
              A text lands, the crew handles it, and one tap marks it done —
              struck through with a petrol check the whole team can see.
            </p>
          </div>
        }
        wash
      >
        <p>
          JobText is live. The moment someone on the crew sends a reply, the
          conversation updates on every other phone — the status changes, the
          snippet updates, the thread re-sorts to the top. You don&apos;t
          refresh, you don&apos;t poll, you don&apos;t wonder. If a customer
          texts while you&apos;re looking at their thread, the new message just
          appears. If they text while you&apos;re elsewhere, a quiet notification
          tells you, and the conversation jumps up the list.
        </p>
        <p>
          For the little things inside a thread — a question you&apos;ve handled,
          an address you&apos;ve noted — tap the message to mark it done. It
          draws a strikethrough and a small petrol check, and the whole crew sees
          it&apos;s handled. It&apos;s a lightweight way to keep a long
          conversation tidy without leaving the inbox for a separate to-do list.
        </p>
      </FeatureSection>

      {/* Feature strip — how the pieces map to a crew's day. */}
      <FeatureStrip
        heading="Everything a shared inbox should do."
        items={[
          {
            icon: Users,
            title: "The whole crew, one view",
            body: "Starter covers 3 people, Pro covers 10 — all looking at the same inbox, all on their own phones. No per-seat surprise on the bill.",
          },
          {
            icon: UserSquare,
            title: "Assign to one owner",
            body: "Each conversation has a single assignee, shown as an avatar and a system line, so responsibility is never ambiguous.",
          },
          {
            icon: ClipboardList,
            title: "Statuses that clear a queue",
            body: "New, Open, Waiting, Closed — filter to the work that still needs you and stop scrolling past what's done.",
          },
          {
            icon: Lock,
            title: "Notes that stay internal",
            body: "Amber, locked, and never sent — talk about the job inside the conversation without the customer ever seeing it.",
          },
          {
            icon: Search,
            title: "Search everything",
            body: "Every message and contact is searchable. 'What did we quote the Nguyens?' takes five seconds, not a phone poll.",
          },
          {
            icon: RefreshCw,
            title: "Realtime across the team",
            body: "Replies, status changes, and new texts show up on every phone as they happen — no refresh, no double-reply.",
          },
        ]}
      />

      {/* Honest details — limits stated plainly (§4). */}
      <HonestDetails
        lead="A shared inbox is only trustworthy if you know exactly what it does and doesn't do. Here's the fine print, in plain words."
        items={[
          {
            term: "It's a texting inbox, not a phone system.",
            detail:
              "JobText handles SMS and MMS to and from your business number. It doesn't place or receive voice calls, and it doesn't do mass text blasts — it's built for one-to-one conversations a crew can share.",
          },
          {
            term: "Receiving is free and unlimited; sending is what counts.",
            detail:
              "Every inbound text and photo is free on every plan. Only the texts your team sends count against your monthly allowance (500 on Starter, 2,500 on Pro), and the composer shows the count before you send.",
          },
          {
            term: "Seats are enforced, honestly.",
            detail:
              "Starter is 3 people and Pro is 10 — real limits, enforced in the app, not a soft cap that quietly bills you for a fourth teammate. When you outgrow Starter, upgrading to Pro is one click and applies immediately.",
          },
          {
            term: "Assignment is a convention, not a lock.",
            detail:
              "Assigning a conversation to one person signals ownership; it doesn't stop a teammate from stepping in when they're needed. Anyone on the crew can read and reply to any conversation — that's the point of a shared inbox.",
          },
        ]}
      />

      {/* Mini-pricing strip. */}
      <MiniPricing
        body={
          <>
            <p>
              The shared inbox is the whole product, and it&apos;s the same flat
              price for everyone on the crew: $29/mo on Starter for up to 3
              people and one local number, $79/mo on Pro for up to 10 people and
              two numbers. Receiving texts is always free and unlimited.
            </p>
            <p>
              For US shops there&apos;s a one-time $29 fee to register your
              business with the phone companies — charged once, ever — so your
              first month is $58 and every month after is $29. Canadian
              businesses that don&apos;t text US numbers never pay it.
            </p>
          </>
        }
      />

      {/* Internal links — trades + related features + a comparison. */}
      <RelatedLinks
        heading="See the shared inbox in your trade"
        intro="The inbox is the same for every crew, but the way it earns its keep is specific. Here's how it plays out in a few trades — and where JobText's flat, shared model stands next to the per-seat tools."
        links={[
          {
            label: "Texting for plumbers",
            href: "/for/plumbers",
            hint: "Photo triage, on-my-way texts, and after-hours texts in one shared inbox.",
          },
          {
            label: "Texting for HVAC",
            href: "/for/hvac",
            hint: "Seasonal no-heat calls, triaged across the whole crew.",
          },
          {
            label: "Templates, tags & workflow",
            href: "/features/templates-and-tags",
            hint: "Saved replies, sell-pipeline tags, and done-marks inside the inbox.",
          },
          {
            label: "JobText vs Heymarket",
            href: "/compare/heymarket",
            hint: "A shared inbox at a flat price, next to a per-user platform.",
          },
        ]}
      />

      {/* Page-specific FAQ — unique to shared-inbox (§4 flagship rule). */}
      <FeatureFaq
        heading="Shared inbox questions, straight answers."
        faqs={[
          {
            q: "How many people can share one inbox?",
            a: "Three on Starter, ten on Pro — a flat price either way, never per seat. Everyone shares the same inbox and the same business number; they just open a link on their own phone. There are no extra charges as you add teammates up to your plan's limit.",
          },
          {
            q: "Can two people reply to the same customer by accident?",
            a: "It's designed against. Every conversation carries one assignee and a status, and the list updates in realtime — so if Dale is typing a reply, the rest of the crew sees the conversation move and knows it's handled. Anyone can still jump in when they need to; the point is that nobody has to guess.",
          },
          {
            q: "Do customers know it's a shared inbox and not one person's phone?",
            a: "No — to the customer it's a normal text conversation with your business. Internal notes and assignments live inside JobText and are never sent. What the customer sees is a single, consistent business number that always gets answered.",
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
            a: "Yes. Every message and every contact is searchable from the inbox — type a name, a number, or a phrase like 'water heater' and you get the conversations and contacts that match, with the matching text highlighted.",
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
