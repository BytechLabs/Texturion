/**
 * /for/cleaners (trades track). BLUEPRINT §5. Angle: recurring clients, lockbox
 * / gate codes and access notes, reschedules, team dispatch. Zero shared
 * sentences with any other trade page (§5 guard). Own metadata + BreadcrumbList
 * JSON-LD. Fully static (§11.4).
 */

import type { Metadata } from "next";
import {
  CalendarCheck,
  KeyRound,
  ListChecks,
  Repeat,
  Sparkles,
  StickyNote,
  UserPlus,
  Users,
} from "lucide-react";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { TradePage } from "@/components/marketing/trades/trade-page";
import type { TradeContent } from "@/components/marketing/trades/trade-page";
import { TradeGraphic, TradePhoto } from "@/components/marketing/trades/trade-graphic";
import { Display } from "@/components/marketing/display";
import { Photo } from "@/components/marketing/photo";
import { CLEANERS_SCRIPT } from "@/components/marketing/trades/scripts";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/for/cleaners";

export const metadata: Metadata = buildMetadata({
  title: "Texting software for cleaning businesses",
  description:
    "A shared text inbox for cleaning companies: confirm recurring visits, keep every gate code with the client, and handle reschedules. Flat $29/mo.",
  path: PATH,
});

const CONTENT: TradeContent = {
  slug: "cleaners",
  displayName: "Cleaners",

  eyebrow: "Business texting for cleaning teams",
  h1: (
    <>
      Every reschedule and gate code,{" "}
      <Display.Mark>caught</Display.Mark> and kept.
    </>
  ),
  heroSub:
    "Half your business is the same clients on repeat, and half the job is knowing how to get in. Gate codes, lockbox notes, “the dog stays crated,” reschedules. JobText keeps all of it in one inbox every cleaner on the team can see, from one business number.",
  heroTruthLine:
    "Access notes saved to the client, not one person's phone. Live in minutes. Month to month.",
  heroPhotoId: "owner-apron-phone",
  heroPhotoCaption: "Reschedule text, caught",

  painH2: "Half the job is getting in the door. That info can't live on one phone.",
  painBody: [
    "Cleaning is a relationship business built on trust and repetition. The same homes, the same offices, week after week, and every one of them has a way in: a door code, a lockbox, a “side gate's unlocked, key's under the mat.” When that lives in one owner's text history, the cleaner sent to cover a shift is locked out on the porch, texting “what's the code again?” to a phone that's busy.",
    "Then there are the reschedules. A client pushes Friday to Monday, someone on the team says yes, and now two cleaners think they're covering it, or nobody does. JobText gives the whole team one inbox: the access notes sit on the client, the reschedule is visible to everyone, and the person who shows up already knows the code, the dog, and what the client asked for last time.",
  ],
  painVisual: (
    <TradePhoto
      photoId="phone-in-hand"
      caption="“What's the gate code again?” shouldn't go to one busy phone. Access notes live on the client, where whoever covers the shift can see them."
    />
  ),

  threadH2: "A biweekly clean, handled by the team.",
  threadLede:
    "A regular client texts the door code and a note about the dog before her Friday clean. The office saves the access details to her contact, assigns the visit to the two-person team, and confirms a window, so whoever walks up on Friday already knows exactly how to get in.",
  script: CLEANERS_SCRIPT,
  supportingGraphic: (
    <TradeGraphic
      caption="Access notes live on the client in one shared inbox, so whichever cleaner covers the visit already has the code, not a locked door and a busy phone."
    >
      <Photo
        id="owner-counter-phone"
        className="overflow-hidden rounded-xl"
        imgClassName="aspect-[4/3] object-cover"
        sizes="(min-width: 1024px) 28rem, 100vw"
      />
    </TradeGraphic>
  ),

  useCasesH2: "Where texting earns its keep in a cleaning business.",
  useCases: [
    {
      icon: KeyRound,
      title: "Gate codes and access notes, saved to the client.",
      body: "“Code 4482, lockbox on the left, dog stays crated.” Save it once to the contact and every cleaner sees it before they arrive, no more locked-out cleaners texting the owner from a doorstep.",
    },
    {
      icon: CalendarCheck,
      title: "Confirm recurring visits in two taps.",
      body: "The night before, send your regulars a quick “we're on for tomorrow between 10 and noon” with a saved reply. Fewer surprised clients, fewer wasted trips to a house nobody's home at.",
    },
    {
      icon: Repeat,
      title: "Reschedules everyone can see.",
      body: "A client moves Friday to Monday and the whole team sees the change in one thread, no double-coverage, no gap. The conversation carries the history so you're never guessing which week you skipped.",
    },
    {
      icon: UserPlus,
      title: "Upsell the deep clean, in writing.",
      body: "“Want us to do the oven and inside the fridge this visit?” Add-ons booked by text are booked on the record, the team sees the extra scope and the client sees the extra line before you show up.",
    },
  ],

  savedRepliesH2: "Six texts every cleaning team sends. Steal these.",
  savedRepliesIntro:
    "Ready-to-edit saved replies for cleaning companies, the confirm-the-recurring, the on-our-way, the add-on ask, in the warm, brief tone clients expect from you.",
  savedReplies: [
    {
      name: "Visit confirmation",
      text: "Hi! Confirming your clean tomorrow between {time} and {time}. Reply here if anything's changed, otherwise, see you then.",
    },
    {
      name: "Access check",
      text: "Before we come by, is the entry still the same (code/lockbox), and anything we should know about pets or areas to skip?",
    },
    {
      name: "On our way",
      text: "The team's heading over now and will be there shortly. We'll text you when we lock up.",
    },
    {
      name: "Add-on offer",
      text: "We've got a little extra time this visit, want us to add the oven or inside the windows? It'd be {amount} on top of the usual.",
    },
    {
      name: "Reschedule",
      text: "No problem moving your clean. We can do {day} between {time} and {time} instead, does that work? Same team, same rate.",
    },
    {
      name: "All done",
      text: "All finished and locked up. Left everything as you like it. If anything's not quite right, just text us here and we'll make it good.",
    },
  ],

  featuresH2: "Built for how a cleaning company actually works.",
  features: [
    {
      icon: StickyNote,
      title: "Access notes the customer never sees.",
      body: "Codes, quirks, “skip the office upstairs”, kept as internal notes on the client, visible to the team, never sent as a text.",
    },
    {
      icon: Users,
      title: "Dispatch the right team.",
      body: "Assign each visit to the cleaners covering it, so there's one owner and no double-coverage on a reschedule.",
    },
    {
      icon: Sparkles,
      title: "One history per client.",
      body: "Every visit, every add-on, every note in one thread, so a fill-in cleaner is never starting from zero.",
    },
    {
      icon: ListChecks,
      title: "Works on the phone in their apron.",
      body: "No app to install, one-handed replies between houses, push notifications when a client texts. If they can text, they can use it.",
    },
  ],

  pricingH2: "$29 a month for the whole team.",
  pricingBody:
    "Starter is 3 people, 1 local number, and 500 texts a month, plenty for confirming a route of recurring clients (a plain confirmation counts as one; the composer shows the count as you type). Growing past three cleaners? Step up to Pro, $79 covers up to 10 people and a second number, handy if you run residential and commercial lines separately. Month to month, receiving always free, and for US companies a one-time $29 to register with the phone companies (first month $58, then $29).",

  faqH2: "Cleaner questions, straight answers.",
  faqs: [
    {
      q: "Can the whole team see a client's gate code without me texting it around?",
      a: "Yes. Save the code and access notes to the client as an internal note, and every cleaner sees it on their own phone before they arrive. Customers never see internal notes, it's not a text, it's a note attached to the conversation.",
    },
    {
      q: "We reschedule a lot. Will two cleaners end up covering the same house?",
      a: "Not when the reschedule is in one shared inbox. Assign the visit to one owner and the whole team sees who's got it and when, no double-coverage, no gap. JobText doesn't move appointments for you, but everyone's looking at the same thread instead of separate phones.",
    },
    {
      q: "Most of our clients are weekly or biweekly regulars. Does texting help?",
      a: "That's exactly where it shines. The full history of a recurring client, access, add-ons, that one thing they always want done, sits in one thread, so any cleaner you send is up to speed, and confirming the next visit is a two-tap saved reply.",
    },
    {
      q: "Our cleaners aren't office people. Is this hard to use?",
      a: "It looks and works like texting, on the phone they already have. They open a link, and they're in, nothing to install, no training day. Access notes and assignments just appear in the conversation.",
    },
    {
      q: "Do confirmation texts use up our 500?",
      a: "A plain confirmation counts as one text, so 500 covers a lot of “see you tomorrow” messages. The composer shows the count before you send; go over and it's 3¢ each with a cap you control, so no surprise bill during a busy stretch.",
    },
    {
      q: "What's involved in getting our cleaning business registered to text?",
      a: "Barely anything on your end. At signup you'll enter your legal business name, address, and EIN, and if you clean as a sole proprietor without an EIN, there's a path for that too (we text you a code to verify and take it from there). We file the paperwork. Receiving texts works immediately, and texting US clients switches on within about a week once you're approved.",
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
          { name: "Who it's for", path: "/#trades" },
          { name: "Cleaners", path: PATH },
        ])}
      />
      <TradePage content={CONTENT} />
    </>
  );
}
