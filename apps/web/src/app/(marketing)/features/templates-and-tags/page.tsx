/**
 * /features/templates-and-tags, on the v4 "FIRST RESPONSE" FEATURE template
 * (DESIGN-DIRECTION v4 §6, COPY-DECK v2).
 *
 * Dateline `TYPE / · TAP · SENT` → H1 "Stop retyping the same five texts."
 * → the real template picker (variables + preview) in a Panel Frame → tags
 * with the real tag pills + the mark-done behavior → use cases → Truth
 * Strip: templates are per-business, editable, and never auto-send →
 * pricing snippet → unique FAQ → Frost CTA band.
 *
 * The done-mark is described accurately as a per-MESSAGE check, never a job
 * or a task manager. Every number is a verified product/billing fact.
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
  PlainDetails,
  PricingSnippet,
  RelatedLinks,
  TruthStripSection,
  UseCaseSteps,
} from "@/components/marketing/features/feature-page";
import { SavedRepliesVisual } from "@/components/marketing/features/saved-replies-visual";
import { TagsDoneVisual } from "@/components/marketing/features/tags-done-visual";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/features/templates-and-tags";

export const metadata: Metadata = buildMetadata({
  title: "Saved replies and tags that match how you sell",
  description:
    "Write your on-my-way and quote-follow-up texts once, send them in two taps with the / shortcut. Tag conversations quote sent, scheduled, won. Mark texts done in the thread.",
  path: PATH,
});

export default function TemplatesAndTagsPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Templates and tags", path: PATH },
        ])}
      />

      <FeatureHero
        dateline="TYPE / · TAP · SENT"
        title="Stop retyping the same five texts."
        sub="The texts a crew sends all day, on my way, here's your quote, you're booked, get written once and sent in two taps. Then tag conversations the way you actually sell, mark the little things done right in the thread, and find any old message in seconds."
        panel={
          <PanelFrame
            chromeUrl="loonext.com/inbox"
            caption="Type / in the composer and the saved replies open, with the preview showing what actually ships."
            ariaLabel="The Loonext saved-replies picker open over the composer, with a template preview"
          >
            <SavedRepliesVisual />
          </PanelFrame>
        }
      />

      <FeatureSection
        ground="frost"
        eyebrow="Saved replies"
        heading="Write it once. Send it in two taps."
      >
        <p>
          Every service crew sends the same handful of texts on repeat: the
          on-my-way, the photo request, the quote follow-up, the booking
          confirmation. Saved replies let you write each one once and reuse it
          forever. In the composer, type / and your templates pop up; pick one
          and it drops into the message, ready to send or tweak.
        </p>
        <p>
          Templates can carry variables, the customer&apos;s first name and
          your business name, which fill in at send time, and the editor shows
          you a preview of exactly what will ship. They belong to the
          business, not to one person: everyone works from the same set, so
          the whole team sounds consistent, and every template is editable to
          sound like you.
        </p>
      </FeatureSection>

      <FeatureSection
        eyebrow="Tags and done-marks"
        heading="Tag it the way you sell. Check off what's handled."
        visual={
          <PanelFrame
            caption="A conversation tagged Scheduled, and a question checked off right in the thread."
            ariaLabel="Loonext pipeline tags on a conversation and a message marked done"
          >
            <TagsDoneVisual />
          </PanelFrame>
        }
        flip
      >
        <p>
          A conversation carries a status for its state (new, open, waiting,
          closed) and tags for how it fits your pipeline. Loonext ships with a
          sell-ready set, quote sent, scheduled, won, lost, and every one is
          editable to match the words your shop actually uses. Tag a thread
          &quot;Quote sent&quot; and Monday morning you can pull up your open
          quotes and follow up, instead of losing the job to whoever replied
          first.
        </p>
        <p>
          And inside a long thread, some messages are little tasks: &quot;can
          you send someone this week?&quot; Tap the message to mark it done.
          It draws a strikethrough and a check, notes who checked it off and
          when, and the whole crew sees it&apos;s handled. No separate to-do
          app.
        </p>
      </FeatureSection>

      <UseCaseSteps
        eyebrow="Use it like this"
        heading="The workflow layer, on a normal Tuesday."
        steps={[
          {
            title: "The on-my-way, in two taps",
            body: "Save it once: \"On my way. Should be there in about 20 minutes.\" Type /, tap, sent. The customer knows you're coming and nobody typed a word from behind the wheel of a parked truck.",
          },
          {
            title: "Monday's open quotes",
            body: "Every quote you sent last week is tagged Quote sent. Open that list Monday morning, send the saved follow-up to each one, and the quiet jobs come back to life before lunch.",
          },
          {
            title: "The tidy long thread",
            body: "A three-week renovation thread piles up questions. Mark each one done as it's handled and the thread reads like a checklist the whole crew can trust, right where the conversation lives.",
          },
        ]}
      />

      <FeatureSection
        eyebrow="Contacts and search"
        heading="Your customer list, imported and searchable."
      >
        <p>
          Bring your existing customers in with a CSV. The import shows you a
          dry-run preview, exactly which rows will import and which will be
          skipped, and why, before anything is written, and it makes an
          opted-out column explicit so you never accidentally text someone who
          asked you not to. Each contact carries a notes field for the things
          worth remembering: gate codes, preferences, the quirks of a
          property.
        </p>
        <p>
          Everything is searchable. Type a name, a number, or a phrase like
          &quot;water heater&quot; and Loonext pulls up the matching
          conversations and contacts with the matching text highlighted, so
          &quot;what did we quote the Nguyens in March?&quot; is a five-second
          question.
        </p>
      </FeatureSection>

      <TruthStripSection
        heading="The plain facts"
        items={[
          {
            text: "Templates are per-business and editable, and every plan includes them.",
            good: true,
          },
          {
            text: "A template never auto-sends. No drip sequences, no scheduled sends: you send every text.",
          },
          {
            text: "Done-marks live on messages, not jobs. Loonext is a texting inbox, not project management.",
          },
        ]}
      />

      <PlainDetails
        heading="The precise edges"
        lead="These are texting-workflow tools, and it's worth being exact about where they stop."
        items={[
          {
            term: "Saved replies are shortcuts, not automation.",
            detail:
              "A template is a text you send with one tap; it never sends on its own. There are no automated reminders or drip campaigns. Confirmations and follow-ups are fast because they're one tap away, not because the app texts customers for you.",
          },
          {
            term: "Done-marks are on messages, not jobs.",
            detail:
              "Marking a text done checks off a single message inside a thread, with a record of who did it and when. It keeps a conversation tidy; it isn't a task list, a job board, or a scheduler, and it won't pretend to be.",
          },
          {
            term: "Import is your list, with consent.",
            detail:
              "CSV import is for customers you already have permission to text. Purchased or scraped lists are banned by our acceptable use policy, and the import preview surfaces opt-out status so you don't message someone who's already out.",
          },
        ]}
      />

      <PricingSnippet>
        <p>
          Saved replies, tags, statuses, done-marks, search, CSV import, and
          contact notes are included on every plan. There&apos;s no workflow
          upsell: Starter is $29/mo for up to 3 people, Pro is $79/mo for up to
          15 and a second number.
        </p>
        <CountryOnly country="us">
          <p>
            US shops pay a one-time $29 to register with the phone companies,
            once, ever, so the first month is $58 and every month after is $29.
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
        heading="Templates that fit your trade"
        intro="The best saved-replies pack is the one written for your work. Here's how templates and tags play out for a couple of trades, and where they live."
        links={[
          {
            label: "Texting for cleaners",
            href: "/for/cleaners",
            hint: "Recurring confirmations and access instructions, saved and sent in two taps.",
          },
          {
            label: "Texting for plumbers",
            href: "/for/plumbers",
            hint: "The on-my-way, photo-request, and quote-follow-up pack, ready to edit.",
          },
          {
            label: "The shared inbox",
            href: "/features/shared-inbox",
            hint: "Where saved replies, tags, and done-marks live: one inbox, the whole crew.",
          },
          {
            label: "Loonext vs Quo",
            href: "/compare/quo",
            hint: "Workflow tools included, next to a per-user phone system.",
          },
        ]}
      />

      <FeatureFaq
        heading="Template and tag questions, straight answers."
        faqs={[
          {
            q: "How do I use a saved reply?",
            a: "In the composer, type / to open your template list, then pick one; it drops into the message ready to send or edit. You can also open the picker from the composer toolbar. Templates are shared across the crew, so everyone sends from the same set.",
          },
          {
            q: "Do templates support the customer's name?",
            a: "Yes. A template can include the customer's first name and your business name as variables, which fill in automatically at send time, and the editor shows a preview of exactly what will ship, so 'Hi {first_name}' never goes out literally.",
          },
          {
            q: "Can I edit the built-in tags?",
            a: "Yes. Quote sent, Scheduled, Won, and Lost ship ready to use, and you can rename them, add your own, or remove ones you don't need, so the tags match how your shop actually talks about a job.",
          },
          {
            q: "Do templates send automatically?",
            a: "No. A saved reply is a text you send with one tap; it never sends on its own. Loonext has no automated reminders or scheduled sends. The speed comes from templates being one tap away, not from the app texting customers for you.",
          },
          {
            q: "What exactly does marking a text done do?",
            a: "It checks off a single message in a thread, drawing a strikethrough and a check, with a note of who did it and when. It keeps a long conversation tidy and lets the crew see what's been handled. It's not a job, a task, or a to-do list; it's a message-level done-mark.",
          },
          {
            q: "How does CSV import work?",
            a: "Upload your file, map the columns (we auto-detect the obvious ones), and review a dry-run preview showing exactly what will import and what will be skipped, including opt-out status, before anything is written. It's built to bring in customers you already have consent to text.",
          },
        ]}
      />

      <FeatureCta
        heading="Give your crew the shortcuts they'll actually use."
        sub="Saved replies, sell-pipeline tags, done-marks, and search, the workflow layer on your shared inbox, live in minutes."
      />
    </>
  );
}
