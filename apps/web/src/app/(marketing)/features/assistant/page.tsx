/**
 * /features/assistant — Lou, on the v4 "FIRST RESPONSE" FEATURE template
 * (DESIGN-DIRECTION v4 §6, COPY-DECK v2).
 *
 * WHY THIS PAGE EXISTS (#491). Five AI features have shipped and the marketing
 * site mentioned none of them, which is half of why the product reads as a
 * texting tool: the assistant is the part a buyer compares against everybody
 * else's "AI receptionist".
 *
 * THE COPY RULE THIS PAGE IS WRITTEN UNDER is the one in
 * docs/DESCRIPTIVE-SURFACES.md: "Overstating a limit is a documentation error.
 * Understating what you do with customer data is the other thing." So the page
 * leads with what Lou touches and what it never does, and the defaults are
 * stated per feature rather than as one comfortable sentence. Four toggles are
 * ON; `voicemail_intake` is OFF, and it says so, because it is the only one
 * that changes what a stranger hears in the business's own name (D89).
 *
 * Every number is read from the product: the monthly caps and the five toggles
 * in apps/api/src/ai/settings.ts, mirrored in lib/marketing/llms-txt.ts, whose
 * test reads the caps out of the API constants that enforce them.
 */

import Link from "next/link";
import type { Metadata } from "next";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { PanelFrame } from "@/components/marketing/fr";
import { AssistantVisual } from "@/components/marketing/features/assistant-visual";
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

const PATH = "/features/assistant";

export const metadata: Metadata = buildMetadata({
  title: "Lou, the assistant that drafts and never sends",
  description:
    "Lou drafts replies for you to edit, writes voicemails down so you can read them, and fills in a job's address and due date from the customer's own words. A person always sends. Included on every plan.",
  path: PATH,
});

export default function AssistantPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Lou, your assistant", path: PATH },
        ])}
      />

      <FeatureHero
        dateline="DRAFTS. NEVER SENDS."
        title="Lou does the typing. A person still does the answering."
        sub="Lou is the assistant inside Loonext. It drafts a reply you can edit, writes a voicemail down so you can read it at a red light, and fills in a job's address and due date from what the customer actually said. It never sends anything, never books anything, and never talks to your customer as you. Included on every plan, and every part of it can be switched off."
        panel={
          <PanelFrame
            caption="A draft waiting in the composer, and the task it filled in. Neither has gone anywhere."
            ariaLabel="A reply drafted by Lou sitting unsent in the Loonext composer, above a task it filled in"
          >
            <AssistantVisual />
          </PanelFrame>
        }
      />

      <FeatureSection
        ground="frost"
        eyebrow="The core idea"
        heading="A suggestion is not a decision."
      >
        <p>
          Everything Lou produces lands in front of a person before it goes
          anywhere. A drafted reply sits in the composer waiting to be edited or
          thrown away. An address it read out of a text is a field you can
          correct. Nothing is queued, nothing sends on a timer, and there is no
          setting that makes any of it automatic, because the moment a machine
          answers a customer in your name you have stopped running your own
          business.
        </p>
        <p>
          That is also the honest difference between this and an &quot;AI
          receptionist&quot;. Lou does not hold a conversation with your
          customer. The one place it speaks to them at all is a single extra
          line in your voicemail greeting, asking what the job is, and that is
          the one feature that ships turned off.
        </p>
      </FeatureSection>

      <UseCaseSteps
        ground="white"
        eyebrow="What it actually does"
        heading="Four jobs, five switches."
        steps={[
          {
            title: "Drafts the reply",
            body: "Lou reads the thread and writes a reply in your voice, grounded in one sentence you wrote about what your business does. You edit it or bin it. It never sends. If you have told Lou nothing about the business, it will not invent a description of it.",
          },
          {
            title: "Writes the voicemail down",
            body: "A voicemail arrives as text you can read between jobs and search months later, instead of a badge you have to find somewhere quiet to listen to. The recording is still there.",
          },
          {
            title: "Fills in the job",
            body: "Promote a text to a task and Lou pulls the address and the due date out of what the customer wrote. Two separate switches, so a crew that wants the address but not the date can have exactly that.",
          },
          {
            title: "Asks what the job is",
            body: "Off by default. Your greeting adds one line asking for the problem and the address, says plainly that a machine writes the answer down, and Lou breaks the transcript out into those fields above the recording. Nothing is booked and nobody meets a menu.",
          },
        ]}
      />

      <TruthStripSection
        heading="The plain facts"
        items={[
          {
            text: "Lou never sends a message, never answers a call, and never books anything. Every output is a suggestion a person accepts, edits, or discards.",
            good: true,
          },
          {
            text: "Four features arrive ON: drafted replies, voicemail transcripts, task addresses, task due dates. Voicemail intake arrives OFF, because it is the only one your customer hears. An owner can switch any of them either way.",
          },
          {
            text: "The caps are per workspace per calendar month and they are hard: 1,500 drafted replies, 500 voicemail transcripts, 1,000 task details. Past a cap the feature stops for the rest of the month rather than billing you more, and the crew is told which cap it was.",
          },
          {
            text: "The models run on Cloudflare Workers AI in the same account that hosts the app. Your message content and voicemail audio are not used to train models, by Cloudflare's published policy and by ours. What comes back is stored in your workspace like any other message and deleted with it.",
          },
        ]}
      />

      <PricingSnippet>
        <p>
          Lou is included at both prices with nothing to enable and no per-seat
          or per-use charge: $29/mo on Starter for up to 3 people, $79/mo on Pro
          for up to 15. The monthly caps are the reason there is no meter to
          watch. What Lou reads and stores is set out in our{" "}
          <Link
            href="/legal/privacy"
            className="font-medium text-[color:var(--fr-olive)] underline-offset-2 hover:underline"
          >
            privacy policy
          </Link>{" "}
          and the{" "}
          <Link
            href="/legal/subprocessors"
            className="font-medium text-[color:var(--fr-olive)] underline-offset-2 hover:underline"
          >
            subprocessors page
          </Link>
          .
        </p>
      </PricingSnippet>

      <RelatedLinks
        heading="Where Lou shows up"
        intro="The assistant is not a screen of its own. It appears inside the things you were already doing."
        links={[
          {
            label: "Shared inbox",
            href: "/features/shared-inbox",
            hint: "Where a drafted reply waits for you to edit it.",
          },
          {
            label: "Calls and voicemail",
            href: "/features/calls",
            hint: "Where the transcript and the intake questions live.",
          },
          {
            label: "Privacy",
            href: "/legal/privacy",
            hint: "What is read, what is stored, and for how long.",
          },
          {
            label: "Subprocessors",
            href: "/legal/subprocessors",
            hint: "Every third party that sees customer data, named.",
          },
        ]}
      />

      <FeatureFaq
        heading="Assistant questions, straight answers."
        faqs={[
          {
            q: "Will Lou reply to my customers without me?",
            a: "No, and there is no setting that would let it. Every draft waits in the composer for a person to read, change, or delete. The only message Loonext ever sends on its own is your after-hours auto-reply and your missed-call text back, and both of those are words you wrote yourself, not words Lou wrote.",
          },
          {
            q: "Is my customers' message content used to train AI models?",
            a: "No. The models run on Cloudflare Workers AI inside the same account that hosts the app, and message content and voicemail audio are not used for training, by Cloudflare's published policy and by ours. Anything Lou produces is stored in your workspace like any other message and is deleted when that data is.",
          },
          {
            q: "Can I turn it off?",
            a: "Yes, feature by feature, in Settings under AI, by an owner or admin. Four are on when you arrive and one, voicemail intake, is off. Turning a feature off stops it immediately; nothing already produced is removed, because it is your workspace's data at that point.",
          },
          {
            q: "What happens when we hit a monthly cap?",
            a: "That feature stops for the rest of the calendar month and the crew is told which cap it was. Nothing bills more and nothing degrades quietly. A voicemail past the transcript cap still arrives as a recording; a reply past the draft cap is just a reply you type yourself.",
          },
          {
            q: "Why is the voicemail question off by default when everything else is on?",
            a: "Because it is the only one your customer experiences. The others produce something a member of your crew reads and decides about. That one changes what a stranger hears when they ring your business, in your name, and a default that speaks for you is not ours to pick.",
          },
          {
            q: "Does Lou know anything about my business?",
            a: "Only one sentence, which you write, describing what you do. It grounds the drafts so they sound like your trade instead of generic support copy. If you leave it blank, Lou will not describe your business at all rather than guess, because an invented answer to a customer is worse than no answer.",
          },
        ]}
      />

      <FeatureCta
        heading="Let the typing be somebody else's job."
        sub={`Drafted replies, voicemails in writing, and jobs that fill themselves in, ${ACTIVATION_CLAIM}. See the price.`}
      />
    </>
  );
}
