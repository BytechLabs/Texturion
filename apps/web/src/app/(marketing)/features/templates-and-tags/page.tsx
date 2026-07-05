/**
 * /features/templates-and-tags, saved replies, tags, statuses, done-marks, CSV
 * import, contact notes (BLUEPRINT §2, §4). Targets "saved replies sms" and
 * "sms templates for service business".
 *
 * Angles (§4): saved replies with the "/" shortcut, pre-seeded pipeline tags
 * (Quote sent → Scheduled → Won/Lost), statuses, search, CSV import, contact
 * notes. Mark-a-text-done is described ACCURATELY as the D14 per-message
 * strikethrough, NOT jobs, NOT a task manager. 700+ words, hand-written, unique
 * FAQ. buildMetadata + BreadcrumbList JSON-LD; NO FAQPage (§11.2).
 */

import {
  CheckSquare,
  FileUp,
  MessageSquareText,
  NotebookPen,
  Search,
  Tags,
} from "lucide-react";
import type { Metadata } from "next";

import { JsonLd } from "@/components/marketing/ui/json-ld";
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
import { SavedRepliesVisual } from "@/components/marketing/features/saved-replies-visual";
import { TagsDoneVisual } from "@/components/marketing/features/tags-done-visual";
import { FramedShot } from "@/components/marketing/shot";
import { Display } from "@/components/marketing/display";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/features/templates-and-tags";

export const metadata: Metadata = buildMetadata({
  title: "Saved replies, tags & team workflow",
  description:
    "Write your on-my-way and quote-follow-up texts once, send them in two taps. Tag conversations the way you sell, mark texts done, and search everything.",
  path: PATH,
});

export default function TemplatesAndTagsPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Templates & tags", path: PATH },
        ])}
      />

      <FeatureHero
        eyebrow="Templates, tags & workflow"
        title={
          <>
            Stop retyping the same text. Every follow-up{" "}
            <Display.Mark>caught</Display.Mark>.
          </>
        }
        sub="The texts a crew sends all day, on my way, here's your quote, you're booked, get written once and sent in two taps. Then tag conversations the way you actually sell, mark the little things done right in the thread, and find any old message in seconds. It's the workflow layer on top of your shared inbox."
        truthChips={[
          "Type / to open saved replies",
          "Pre-seeded sell pipeline tags",
          "Search every message and contact",
        ]}
        visual={<FramedShot id="thread-open" priority className="mx-auto max-w-xl" />}
      />

      {/* Section 1, saved replies with the / shortcut. */}
      <FeatureSection
        eyebrow="Saved replies"
        heading="Write it once. Send it in two taps."
        visual={<SavedRepliesVisual className="mx-auto max-w-md" />}
        wash
      >
        <p>
          Every service crew sends the same handful of texts on repeat: the
          on-my-way, the photo request, the quote follow-up, the booking
          confirmation, the &ldquo;all done, you&apos;re good to go.&rdquo; Saved
          replies let you write each one once and reuse it forever. In the
          composer, type <strong>/</strong> and your templates pop up; pick one
          and it drops into the message, ready to send or tweak. No copy-paste
          from a notes app, no retyping the same sentence between jobs.
        </p>
        <p>
          Templates are the crew&apos;s, not one person&apos;s, everyone works
          from the same set, so the whole team sounds consistent and nobody has
          to reinvent the &ldquo;running about 20 minutes late&rdquo; text on
          their own. Trades start with a pack tailored to their work, and you can
          edit every one to sound like you.
        </p>
      </FeatureSection>

      {/* Section 2, tags + statuses (how you sell). */}
      <FeatureSection
        eyebrow="Tags & statuses"
        heading="Tag conversations the way you sell."
        visual={<TagsDoneVisual />}
        flip
      >
        <p>
          A conversation carries a status for its state (New, Open, Waiting,
          Closed) and tags for how it fits your pipeline. Loonext ships with a
          sell-ready set, <strong>Quote sent</strong>,{" "}
          <strong>Scheduled</strong>, <strong>Won</strong>,{" "}
          <strong>Lost</strong>, and every one is editable to match the words
          your shop actually uses. Tag a thread &ldquo;Quote sent&rdquo; and it
          stays visible in that list until someone closes the loop, so Monday
          morning you can open your open quotes and follow up instead of losing
          the job to whoever replied first.
        </p>
        <p>
          Because tags and statuses live on the shared conversation, the whole
          crew sees the same picture: what&apos;s quoted, what&apos;s booked,
          what&apos;s waiting on the customer. It&apos;s a lightweight pipeline
          built into the inbox, not a separate CRM you have to keep in sync.
        </p>
      </FeatureSection>

      {/* Section 3, mark a text done (D14, described accurately). */}
      <FeatureSection
        eyebrow="Done-marks"
        heading="Mark a text done, right in the thread."
        visual={
          <FramedShot id="mobile-thread" className="mx-auto max-w-[280px]" />
        }
        wash
      >
        <p>
          Inside a long conversation, some individual messages are little tasks:
          &ldquo;can you send someone to look at the water heater this
          week?&rdquo; Tap that message and mark it done. Loonext draws a
          strikethrough through it and a small petrol check, and notes who
          checked it off and when. The whole crew can see at a glance that
          it&apos;s been handled.
        </p>
        <p>
          To be precise about what this is: a done-mark is a lightweight check on
          a single <em>message</em>, so a busy thread stays tidy and nothing gets
          lost. It isn&apos;t a job, a task manager, or a scheduling tool,
          Loonext is a texting inbox, and the done-mark is a way to keep the
          texting tidy, not a project tracker in disguise.
        </p>
      </FeatureSection>

      {/* Section 4, contacts, notes, CSV import, search. */}
      <FeatureSection
        eyebrow="Contacts & search"
        heading="Your customer list, imported and searchable."
        visual={<FramedShot id="contact-panel" className="mx-auto max-w-xl" />}
        flip
      >
        <p>
          Bring your existing customers in with a CSV. The import wizard shows
          you a dry-run preview, exactly which rows will import and which will
          be skipped, and why, before anything is written, and it makes the
          meaning of an &ldquo;opted out&rdquo; column explicit so you never
          accidentally text someone who asked you not to. Each contact carries an
          auto-saving notes field for the things worth remembering: gate codes,
          preferences, the quirks of a property.
        </p>
        <p>
          And everything is searchable. Type a name, a number, or a phrase like
          &ldquo;water heater&rdquo; and Loonext pulls up the matching
          conversations and contacts with the matching text highlighted, so
          &ldquo;what did we quote the Nguyens in March?&rdquo; is a five-second
          question, not a phone poll around the crew.
        </p>
      </FeatureSection>

      {/* Feature strip. */}
      <FeatureStrip
        heading="The workflow layer, in one place."
        items={[
          {
            icon: MessageSquareText,
            title: "Saved replies",
            body: "Your common texts, written once and sent with the / shortcut, shared across the whole crew.",
          },
          {
            icon: Tags,
            title: "Editable pipeline tags",
            body: "Quote sent, Scheduled, Won, Lost out of the box, rename them to match how your shop sells.",
          },
          {
            icon: CheckSquare,
            title: "Mark a text done",
            body: "Check off an individual message with a strikethrough and a check, so a long thread stays tidy.",
          },
          {
            icon: Search,
            title: "Search everything",
            body: "Every message and contact, searchable with highlighted snippets, no more asking around.",
          },
          {
            icon: FileUp,
            title: "CSV contact import",
            body: "A dry-run preview shows what will import before anything does, with opt-out status made explicit.",
          },
          {
            icon: NotebookPen,
            title: "Contact notes",
            body: "An auto-saving notes field on every contact for gate codes, preferences, and property quirks.",
          },
        ]}
      />

      {/* Honest details. */}
      <HonestDetails
        lead="These are texting-workflow tools, and it's worth being precise about their edges so you know what you're getting."
        items={[
          {
            term: "Saved replies are shortcuts, not automation.",
            detail:
              "A template is a text you send with one tap, it never sends on its own. There are no automated reminders, drip sequences, or scheduled sends. Confirmations and follow-ups are fast to send, but you send them; Loonext doesn't text customers for you.",
          },
          {
            term: "Done-marks are on messages, not jobs.",
            detail:
              "Marking a text done checks off a single message inside a thread. It's a way to keep a conversation tidy, not a task list, a job board, or a scheduler. If you need real project management, Loonext isn't it, and won't pretend to be.",
          },
          {
            term: "Import is your list, with consent.",
            detail:
              "CSV import is for bringing in customers you already have permission to text. Purchased or scraped lists are banned; the import preview surfaces opt-out status so you don't message someone who's already out.",
          },
          {
            term: "Tags are per-conversation.",
            detail:
              "Statuses and tags live on a conversation, so they describe where that thread stands in your pipeline. They're editable and shared across the crew, but they're a lightweight pipeline view, not a full CRM with reporting.",
          },
        ]}
      />

      {/* Mini-pricing. */}
      <MiniPricing
        body={
          <>
            <p>
              Saved replies, tags, statuses, done-marks, search, CSV import, and
              contact notes are all included on every plan, there&apos;s no
              &ldquo;workflow&rdquo; upsell. Starter is $29/mo for up to 3 people;
              Pro is $79/mo for up to 10 and a second number.
            </p>
            <p>
              US shops pay a one-time $29 to register with the phone companies,
              once, ever, so the first month is $58 and every month after is $29.
              Canadian businesses that don&apos;t text US numbers never pay it.
            </p>
          </>
        }
      />

      {/* Internal links. */}
      <RelatedLinks
        heading="Templates that fit your trade"
        intro="The best saved-replies pack is the one written for your work. Here's how templates and tags play out for a couple of trades, and where they sit alongside the shared inbox they live in."
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
            hint: "Where saved replies, tags, and done-marks live, one inbox, the whole crew.",
          },
          {
            label: "Loonext vs Quo",
            href: "/compare/quo",
            hint: "Workflow tools included, next to a per-user phone system.",
          },
        ]}
      />

      {/* Page-specific FAQ, unique to templates-and-tags. */}
      <FeatureFaq
        heading="Templates & tags questions, straight answers."
        faqs={[
          {
            q: "How do I use a saved reply?",
            a: "In the composer, type / to open your template list, then pick one, it drops into the message ready to send or edit. You can also open the picker from the composer toolbar. Templates are shared across the crew, so everyone sends from the same set.",
          },
          {
            q: "Can I edit the built-in tags?",
            a: "Yes. Quote sent, Scheduled, Won, and Lost ship ready to use, and you can rename them, add your own, or remove ones you don't need, so the tags match how your shop actually talks about a job.",
          },
          {
            q: "Do templates send automatically?",
            a: "No. A saved reply is a text you send with one tap; it never sends on its own. Loonext has no automated reminders or scheduled sends, the speed comes from templates being one tap away, not from the app texting customers for you.",
          },
          {
            q: "What exactly does 'mark a text done' do?",
            a: "It checks off a single message in a thread, a strikethrough and a petrol check, with a note of who did it and when. It keeps a long conversation tidy and lets the crew see what's been handled. It's not a job, a task, or a to-do list; it's a message-level done-mark.",
          },
          {
            q: "How does CSV import work?",
            a: "Upload your file, map the columns (we auto-detect the obvious ones), and review a dry-run preview showing exactly what will import and what will be skipped, including opt-out status, before anything is written. Then import. It's built to bring in customers you already have consent to text.",
          },
          {
            q: "Is search across everything?",
            a: "Yes, every message and every contact. Type a name, a number, or a phrase and you get matching conversations and contacts with the matching text highlighted, grouped so you can jump straight to what you meant.",
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
