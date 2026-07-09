/**
 * /for/cleaners (trades crew), v4 "FIRST RESPONSE". COPY-DECK v2
 * §/for/cleaners: dateline 5:56 PM · KEY UNDER MAT?, H1 "The text inbox for
 * cleaning crews.", pain H2 "Every key, code, and reschedule lives in
 * somebody's texts.", the access-instructions-plus-reschedule script, and
 * the v2 use cases (entry notes the customer never sees, recurring-visit
 * confirmations, add-on requests). Fully static; own metadata +
 * BreadcrumbList JSON-LD.
 */

import type { Metadata } from "next";

import { CountryText } from "@/components/marketing/country";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { TradePage } from "@/components/marketing/trades/trade-page";
import type { TradeContent } from "@/components/marketing/trades/trade-page";
import { CLEANERS_SCRIPT } from "@/components/marketing/trades/scripts";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/for/cleaners";

export const metadata: Metadata = buildMetadata({
  title: "Texting software for cleaning businesses",
  description:
    "A shared text inbox for cleaning companies: confirm recurring visits, keep every access note with the client, handle reschedules as a team. Flat $29/mo.",
  path: PATH,
});

const CONTENT: TradeContent = {
  slug: "cleaners",
  displayName: "Cleaners",

  dateline: "5:56 PM · KEY UNDER MAT?",
  h1: "The text inbox for cleaning crews.",
  heroSub:
    "Key under the mat, dog in the crate, oven this time, and Friday moved to Monday. Half of cleaning is what the client told you last week, and it can't live on one phone. Loonext keeps every access note, reschedule, and add-on in one inbox the whole team can see. $29 a month.",
  heroTruth:
    "Access notes saved to the client · Live in minutes · Month to month",

  painH2: "Every key, code, and reschedule lives in somebody's texts.",
  painBody: [
    "Cleaning is a relationship business built on repetition: the same homes and offices, week after week, and every one of them has a way in. A door code, a lockbox, a “key's under the mat this Friday.” When that lives in one owner's text history, the cleaner covering a shift is locked out on the porch, texting “what's the code again?” to a phone that's busy.",
    "Then there are the reschedules. A client pushes Friday to Monday, someone says yes, and now two cleaners think they're covering it, or nobody does. With one shared inbox, the access notes sit on the client, the reschedule is visible to everyone, and whoever shows up already knows the code, the dog, and what the client asked for last time.",
  ],

  threadH2: "A key under the mat, and a Friday moved to Monday.",
  threadLede:
    "At 5:56 PM a regular texts new entry instructions and asks to move her clean. The office saves the key note to her contact, the team's Friday opens up, and Monday's visit is confirmed with a window, all before dinner.",
  script: CLEANERS_SCRIPT,
  threadAriaLabel:
    "A cleaning company conversation: new key instructions at 5:56 PM and a Friday clean rescheduled to Monday between 10 and noon",

  useCasesH2: "Where texting earns its keep in a cleaning business.",
  useCases: [
    {
      title: "Entry notes the customer never sees.",
      body: "“Code 4482, lockbox on the left, dog stays crated.” Save it once as an internal note and every cleaner sees it before they arrive. Internal notes are marked, locked, and never sent as a text.",
    },
    {
      title: "Recurring-visit confirmations, in two taps.",
      body: "The night before, send your regulars a quick “we're on for tomorrow between 10 and noon” with a saved reply. Fewer surprised clients, fewer wasted trips to a house nobody's home at.",
    },
    {
      title: "Add-on requests, on the record.",
      body: "“Just the oven if you have time” lands in the thread, where the team doing the visit actually sees it, and where you can price the deep clean in writing before you show up.",
    },
    {
      title: "Reschedules everyone can see.",
      body: "A client moves Friday to Monday and the whole team sees the change in one thread. No double-coverage, no gap, and the history shows which week you skipped.",
    },
  ],

  savedRepliesH2: "Six texts every cleaning team sends. Steal these.",
  savedRepliesIntro:
    "Six saved replies worth setting up on day one: the confirm-the-recurring, the access check, the add-on ask, in the warm, brief tone clients expect from you. Save each one once and it's two taps forever.",
  savedReplies: [
    {
      name: "Visit confirmation",
      text: "Hi {first_name}! Confirming your clean tomorrow between 10 and noon. Reply here if anything's changed; otherwise, see you then.",
    },
    {
      name: "Access check",
      text: "Before we come by, is the entry still the same (code or lockbox), and anything we should know about pets or areas to skip?",
    },
    {
      name: "On our way",
      text: "The team's heading over now and will be there shortly. We'll text you when we lock up.",
    },
    {
      name: "Add-on offer",
      text: "We've got a little extra time this visit. Want us to add the oven or inside the windows? It'd be $40 on top of the usual.",
    },
    {
      name: "Reschedule",
      text: "No problem moving your clean. We can do Monday between 10 and noon instead. Does that work? Same team, same rate.",
    },
    {
      name: "All done",
      text: "All finished and locked up. Left everything as you like it. If anything's not quite right, text us here and we'll make it good.",
    },
  ],
  savedRepliesCaption:
    "The cleaning pack in the composer: tomorrow's confirmations go out in a couple of taps each.",

  featuresH2: "Built for how a cleaning company actually works.",
  features: [
    {
      title: "Access notes the customer never sees.",
      body: "Codes, quirks, “skip the office upstairs.” Kept as internal notes on the client, visible to the team, never sent as a text.",
    },
    {
      title: "Dispatch the right team.",
      body: "Assign each visit to the cleaners covering it, so there's one owner and no double-coverage on a reschedule.",
    },
    {
      title: "One history per client.",
      body: "Every visit, every add-on, every note in one thread, so a fill-in cleaner is never starting from zero.",
    },
    {
      title: "Works on the phone in their apron.",
      body: "No app to install, one-handed replies between houses, push notifications when a client texts. If they can text, they can use it.",
    },
  ],

  pricingH2: "$29 a month for the whole team.",
  pricingBody:
    "Starter is 3 people, 1 local number, and 500 texts a month, plenty for confirming a route of recurring clients; a plain confirmation counts as one, and the composer shows the count before you send. Growing past three cleaners, or running residential and commercial lines separately? Pro is $79 for up to 15 people and a second number.",

  faqH2: "Cleaner questions, straight answers.",
  faqs: [
    {
      q: "Can the whole team see a client's gate code without me texting it around?",
      a: "Yes. Save the code and access notes to the client as an internal note, and every cleaner sees it on their own phone before they arrive. Customers never see internal notes; it's not a text, it's a note attached to the conversation.",
    },
    {
      q: "We reschedule a lot. Will two cleaners end up covering the same house?",
      a: "Not when the reschedule is in one shared inbox. Assign the visit to one owner and the whole team sees who's got it and when. No double-coverage, no gap. Loonext doesn't move appointments for you, but everyone's looking at the same thread instead of separate phones.",
    },
    {
      q: "Most of our clients are weekly or biweekly regulars. Does texting help?",
      a: "That's exactly where it shines. The full history of a recurring client, with the access notes, the add-ons, and that one thing they always want done, sits in one thread, so any cleaner you send is up to speed, and confirming the next visit is a two-tap saved reply.",
    },
    {
      q: "Our cleaners aren't office people. Is this hard to use?",
      a: "It looks and works like texting, on the phone they already have. They open a link, and they're in. Nothing to install, no training day. Access notes and assignments just appear in the conversation.",
    },
    {
      q: "Do confirmation texts use up our 500?",
      a: "A plain confirmation counts as one text, so 500 covers a lot of “see you tomorrow” messages, and the composer shows the count before you send. Go over and it's 3¢ each with a cap you control, so there's no surprise bill during a busy stretch.",
    },
    {
      q: "What's involved in getting our cleaning business registered to text?",
      a: (
        <CountryText
          us="We handle it. At signup you'll enter your legal business name, address, and EIN, and if you clean as a sole proprietor without an EIN, there's a path for that too: we text you a code to verify and take it from there. We file the paperwork. Receiving texts works immediately, and texting US clients switches on within about a week once you're approved."
          ca="Nothing to register and no wait. If you clean Canadian homes for Canadian customers, you start texting the same day you sign up."
        />
      ),
    },
  ],

  finalH2: "Get every gate code off one person's phone.",
  finalSub:
    "One shared inbox for recurring clients, access notes, and reschedules, so whoever shows up knows how to get in. Live in minutes.",
};

export default function CleanersPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Cleaners", path: PATH },
        ])}
      />
      <TradePage content={CONTENT} />
    </>
  );
}
