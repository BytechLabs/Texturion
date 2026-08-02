/**
 * /features/contacts, on the v4 "FIRST RESPONSE" FEATURE template
 * (DESIGN-DIRECTION v4 §6, COPY-DECK v2).
 *
 * WHY THIS PAGE EXISTS (#491). Contacts are an app tab and the marketing site
 * mentioned them once, as a CSV import feature, which is the least interesting
 * true thing about them.
 *
 * THE IDEA IS D99: a customer's history is one stream, assembled at read time.
 * Threading (D7) reopens a conversation closed within 30 days and otherwise
 * starts a new one, so a customer serviced once a year for six years is six
 * conversations — correct, and it means "what have we done for this customer?"
 * spanned N records with nothing assembling them. That question, asked before
 * every visit, is what this page sells.
 *
 * WHAT IT DOES NOT CLAIM: merging duplicates. #246 is open. Two customers that
 * already exist twice stay twice, and saying otherwise on a page about having
 * one record per customer would be the worst possible place to overpromise.
 */

import Link from "next/link";
import type { Metadata } from "next";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { PanelFrame } from "@/components/marketing/fr";
import { ContactTimelineVisual } from "@/components/marketing/features/contact-timeline-visual";
import { PlanPrice } from "@/components/marketing/pricing/plan-price";
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

const PATH = "/features/contacts";

export const metadata: Metadata = buildMetadata({
  title: "One history for every customer",
  description:
    // #328: no figure. A description is one string per URL and the price a
    // reader should see depends on their country, so quoting either one would
    // put a number in the search snippet that the page itself may contradict.
    "Every text, call, voicemail and photo you have exchanged with a customer, on one timeline, with their address and your private notes. Import your list with a CSV. One flat price for the crew.",
  path: PATH,
});

export default function ContactsPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Contacts", path: PATH },
        ])}
      />

      <FeatureHero
        dateline="BEFORE YOU KNOCK"
        title="What have we done for this customer? One screen, six years."
        sub="A furnace serviced every autumn is six separate jobs, and it should be. But the question you ask in the van outside their house is not about one job, it is about all of them. Every text, call, voicemail and photo you have ever exchanged with somebody sits on one timeline, with their address, your private notes, and what they agreed to."
        panel={
          <PanelFrame
            caption="Karen Mullins, four years of work, assembled from four separate conversations."
            ariaLabel="A customer's history in Loonext, mixing texts, a call and a voicemail on one timeline"
          >
            <ContactTimelineVisual />
          </PanelFrame>
        }
      />

      <FeatureSection
        ground="frost"
        eyebrow="The core idea"
        heading="Conversations end. Customers do not."
      >
        <p>
          A conversation closes when a job is done, and the next time that
          customer texts, a new one starts. That is right: an annual furnace
          service genuinely is a new job, not a continuation of last
          October&apos;s. But it means the person who has served them six times
          has six records and no history.
        </p>
        <p>
          The contact is where those come back together. Texts, calls,
          voicemails with their transcripts, photos, and the jobs that came out
          of them, in one time-ordered stream. Nothing is copied or summarized
          to build it; it is assembled the moment you open it, from the same
          records the inbox is showing.
        </p>
        <p>
          The practical version: the tech standing on the porch knows the dog is
          in the crate, the key is under the mat, and last year&apos;s part was
          the wrong one, without phoning the office to ask.
        </p>
      </FeatureSection>

      <UseCaseSteps
        ground="white"
        eyebrow="What a contact holds"
        heading="The things you would otherwise keep on a phone."
        steps={[
          {
            title: "The address, and what is at it",
            body: "Where the job is, plus the notes only your crew sees: gate code, dog, parking, the quirk that cost an hour last time. Private by construction, never sent to the customer.",
          },
          {
            title: "What they agreed to",
            body: "How consent was recorded and when, so the question \"are we allowed to text this person?\" has an answer with a date on it rather than a shrug. If they have opted out, the contact says so and says which kind, because only some can be undone from inside the app.",
          },
          {
            title: "Their whole history",
            body: "Every conversation, call and job in one stream. Search it the way you search everything else: a name, a number, or a phrase like \"water heater\".",
          },
          {
            title: "Your list, brought in",
            body: "Import from a CSV with a dry run that shows exactly what will be created before anything is, and export the whole list back out whenever you want. Your customers are not hostage to us.",
          },
        ]}
      />

      <TruthStripSection
        heading="The plain facts"
        items={[
          {
            text: "The history is assembled when you open it, from the conversations, calls and tasks that already exist. Nothing is duplicated into a second store that can drift.",
            good: true,
          },
          {
            text: "Internal notes on a contact are never sent and never visible to the customer, the same way notes inside a conversation are not.",
          },
          {
            text: "Duplicates are not merged yet. If the same person exists twice, they stay twice for now; import will not create a second copy of somebody it recognises, but two records that already exist do not combine.",
          },
          {
            text: "Import and export are both CSV, both included, with no row cap and no charge.",
          },
        ]}
      />

      <PricingSnippet>
        <p>
          Contacts come with the inbox: <PlanPrice plan="starter" />/mo on
          Starter for up to 3 people, <PlanPrice plan="pro" />/mo on Pro for up
          to 15. There is no per-contact pricing, no
          contact cap and no CRM tier. Photos and files attached to a customer
          are stored free with no caps, which is set out with everything else in
          our{" "}
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
        heading="What fills a contact"
        intro="A contact is not something you maintain. It is what the rest of the product leaves behind."
        links={[
          {
            label: "Shared inbox",
            href: "/features/shared-inbox",
            hint: "The conversations that become the history.",
          },
          {
            label: "Calls and voicemail",
            href: "/features/calls",
            hint: "Calls and their transcripts land on the same timeline.",
          },
          {
            label: "Tasks",
            href: "/features/tasks",
            hint: "The jobs that came out of those conversations.",
          },
          {
            label: "Compliance built in",
            href: "/features/compliance",
            hint: "Where the consent record on a contact comes from.",
          },
        ]}
      />

      <FeatureFaq
        heading="Contact questions, straight answers."
        faqs={[
          {
            q: "Is this a CRM?",
            a: "Not in the sales sense. There are no deal stages, no pipelines with forecast values, no lead scoring and no email sequences. It is the record of a customer you already serve: who they are, where they are, what you have said to each other, and what you agreed. If you need a sales CRM, keep it; this is the operational half.",
          },
          {
            q: "Can I merge two contacts that are the same person?",
            a: "Not yet, and we would rather say so than imply otherwise on the page about having one record per customer. Import will not create a second copy of a number it already knows, so bringing your list in does not make the problem worse. Merging two that already exist is on the list.",
          },
          {
            q: "Who can see the private notes?",
            a: "Your crew, and only your crew. Notes on a contact are internal in the same way notes inside a conversation are: they are never sent, never appear in a text, and the customer has no way to see them. They are drawn differently in the app for exactly that reason.",
          },
          {
            q: "Can I get my contacts back out?",
            a: "Yes, as a CSV, whenever you want, without asking anybody. Leaving is stated up front here rather than made difficult: your customer list is yours, and an export button is the least a product can do about that.",
          },
          {
            q: "Does the history include calls, or only texts?",
            a: "Both, plus voicemails with their transcripts and any photos or files. That is the whole point of assembling it: a customer who rang twice and texted once has three things in their history, in the order they happened, not two lists you merge by eye.",
          },
        ]}
      />

      <FeatureCta
        heading="Know the customer before you knock."
        sub={`One history per customer, assembled from every text and call, ${ACTIVATION_CLAIM}. See the price.`}
      />
    </>
  );
}
