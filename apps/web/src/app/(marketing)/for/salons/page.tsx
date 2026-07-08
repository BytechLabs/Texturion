/**
 * /for/salons (trades crew), v4 "FIRST RESPONSE". COPY-DECK v2 §/for/salons:
 * dateline 11:20 AM · RUNNING LATE, H1 "The text inbox for your front desk,
 * even if you don't have one.", pain H2 about the empty chair and the
 * running-late text on a personal phone, the reschedule-between-stylists
 * script, and the v2 use cases (confirmations, waitlist fills, aftercare
 * follow-ups). Honesty guards: confirmations and waitlist fills are things
 * you SEND (fast, with saved replies), never "automated"; and NO booking
 * integration claims anywhere (Loonext is texting only). Fully static; own
 * metadata + BreadcrumbList JSON-LD.
 */

import type { Metadata } from "next";

import { CountryText } from "@/components/marketing/country";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { TradePage } from "@/components/marketing/trades/trade-page";
import type { TradeContent } from "@/components/marketing/trades/trade-page";
import { SALONS_SCRIPT } from "@/components/marketing/trades/scripts";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/for/salons";

export const metadata: Metadata = buildMetadata({
  title: "Text messaging for salons and barbershops",
  description:
    "A shared text inbox for salons: confirm appointments to cut no-shows, fill cancellations from your waitlist, and follow up after the visit. Flat $29/mo.",
  path: PATH,
});

const CONTENT: TradeContent = {
  slug: "salons",
  displayName: "Salons",

  dateline: "11:20 AM · RUNNING LATE",
  h1: "The text inbox for your front desk, even if you don't have one.",
  heroSub:
    "A running-late text only helps if somebody sees it before the chair sits empty. Loonext gives the whole floor one number, so confirmations, reschedules, and waitlist fills get handled by whoever's free, not whoever's phone it landed on. $29 a month for the whole salon.",
  heroTruth:
    "One number for the whole floor · Live in minutes · Month to month",

  painH2:
    "The chair is empty and the “running late” text is on someone's personal phone.",
  painBody: [
    "At a busy salon the front desk is one person, if it's anyone at all. That person can't answer the phone, check someone out, and confirm tomorrow's column all at once. So confirmations slip, a client forgets, and at 2pm a stylist is standing at an empty chair that was booked solid a week ago.",
    "Cancellations aren't the problem; unfilled ones are. When a 3pm color cancels, there's almost always someone who'd take it, if you can reach them in the next ten minutes. With the whole floor on one inbox, the running-late text gets seen in time, the slot gets offered, and the day stays full no matter who's at the desk.",
  ],

  threadH2: "A running-late text, rescued between stylists.",
  threadLede:
    "A client texts at 11:20 that she's 30 minutes late for her 11:30 color. The desk sees Jess can't absorb it, hands the appointment to Maya, and the client walks in at noon to the same service at the same price, instead of a cancelled slot.",
  script: SALONS_SCRIPT,
  threadAriaLabel:
    "A salon conversation: a client running 30 minutes late at 11:20 AM, moved from Jess to Maya so the color still happens at noon",

  useCasesH2: "Where texting earns its keep in a salon.",
  useCases: [
    {
      title: "Confirm appointments to cut no-shows.",
      body: "The day before, text each client a quick “confirming your 2pm with Jess tomorrow” with a saved reply. A client who taps back yes is a client who shows, and the whole team sees who still needs a nudge.",
    },
    {
      title: "Fill a cancellation from the waitlist.",
      body: "A 3pm cancels; you text the two people who wanted that window and give it to whoever answers first. A personal, one-to-one text sent in seconds turns a hole in the day back into revenue.",
    },
    {
      title: "Aftercare follow-ups that bring them back.",
      body: "Two days after a big color, a quick “how's it feeling? remember the sulfate-free wash” keeps the result good and the client loyal, and it's two taps with a saved reply.",
    },
    {
      title: "Talk through the look before the appointment.",
      body: "Clients text inspo photos ahead of a color or cut. The stylist sees them in the thread, blocks the right amount of time, and sets the price expectation up front. No sticker shock at the chair.",
    },
  ],

  savedRepliesH2: "Six texts every salon sends. Steal these.",
  savedRepliesIntro:
    "Six saved replies worth setting up on day one: the confirmation, the waitlist offer, the aftercare check-in, in a warm voice your clients will recognize. Save each one once and it's two taps forever.",
  savedReplies: [
    {
      name: "Appointment confirmation",
      text: "Hi {first_name}! Confirming your appointment tomorrow at 2pm. Reply YES to confirm, or let us know if you need to change it.",
    },
    {
      name: "Waitlist offer",
      text: "Good news, {first_name}: a 3pm spot just opened up tomorrow. Want it? First to reply gets it, and I'll lock it in.",
    },
    {
      name: "Aftercare check-in",
      text: "Hi {first_name}! Checking in on your color from last week. If anything feels off, text me here and we'll sort it. Remember the sulfate-free wash for the first week!",
    },
    {
      name: "Running behind",
      text: "So sorry, we're running about 15 minutes behind. No need to rush over; we'll text you the moment your chair is ready.",
    },
    {
      name: "Consult ask",
      text: "Love that idea! Before your appointment, could you text a photo or two of the look? It helps us plan the time and give you an accurate price.",
    },
    {
      name: "Thank you + review",
      text: "Thank you for coming in today, {first_name}! If you loved the result, a quick review really helps our little salon.",
    },
  ],
  savedRepliesCaption:
    "The salon pack in the composer: tomorrow's column gets confirmed between clients.",

  featuresH2: "Built for how a salon actually runs.",
  features: [
    {
      title: "The whole floor, one number.",
      body: "The front desk and every stylist see the same conversations, so a confirmation or a waitlist fill doesn't depend on who's standing at the desk.",
    },
    {
      title: "Assign a client to their stylist.",
      body: "Each conversation has one owner, so the color question reaches the colorist and nothing gets answered twice or not at all.",
    },
    {
      title: "Notes only the team sees.",
      body: "“Sensitive scalp, always books the 2pm, big lift last time.” Internal notes on the client that never get sent as a text.",
    },
    {
      title: "No app, no learning curve.",
      body: "It works like texting on the phone your team already carries. Open a link and you're in, with push notifications when a client replies.",
    },
  ],

  pricingH2: "$29 a month for the whole salon.",
  pricingBody:
    "Starter covers 3 people, 1 local number, and 500 texts a month, enough to confirm a full book and work a waitlist; a plain confirmation counts as one, and the composer shows the count before you send. More chairs, or a second location? Pro is $79 for up to 10 people and a second number to keep two shops separate.",

  faqH2: "Salon questions, straight answers.",
  faqs: [
    {
      q: "Will Loonext send appointment reminders on its own?",
      a: "No. You send them, and that's on purpose. Pull up tomorrow's column and text each client a confirmation with a saved reply; it takes a couple of taps per client, keeps a real person in the loop, and stays inside the phone companies' rules on unsolicited blasts. What you get is one shared inbox where the whole team sees who's confirmed and who hasn't.",
    },
    {
      q: "How does texting actually reduce no-shows?",
      a: "A client who's tapped yes to a confirmation is far more likely to show than one who booked a week ago and forgot. Because the confirmations live in a shared inbox, anyone on the team can send them and see who still needs a nudge. It doesn't all fall on the front desk on a busy morning.",
    },
    {
      q: "Can we fill a last-minute cancellation from a waitlist?",
      a: "Yes, that's one of the best uses. When a slot opens, text the clients who wanted that window and give it to whoever replies first. It's a personal, one-to-one text sent in seconds, not an automated blast, so it stays warm and stays inside the rules.",
    },
    {
      q: "Every stylist has their own clients. Can they each see their own?",
      a: "Assign each conversation to the right stylist and it has one clear owner, while the front desk still sees everything to help confirm and rebook. One number, one inbox, but never a free-for-all where two people answer the same client.",
    },
    {
      q: "Do confirmation texts eat up our 500?",
      a: "A plain confirmation counts as one text, so 500 covers a lot of “see you tomorrow” messages, and the composer shows the count before you send. Go over on a big week and it's 3¢ each up to a cap you control. No surprise bill.",
    },
    {
      q: "What does it take to get our salon set up to text?",
      a: (
        <CountryText
          us="We take care of it: just a couple of minutes at signup with your salon's legal name, address, and EIN. Booth renter or sole proprietor without an EIN? We'll verify you with a texted code instead. You'll be receiving texts right away, and texting US clients begins about a week later once you're approved."
          ca="Nothing to register and no wait. A Canadian salon texting Canadian clients is texting the same day it signs up."
        />
      ),
    },
  ],

  finalH2: "Keep the chairs full.",
  finalSub:
    "Confirm appointments, fill cancellations from the waitlist, and follow up after the big color, all from one number the whole floor shares. Live in minutes.",
};

export default function SalonsPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Salons", path: PATH },
        ])}
      />
      <TradePage content={CONTENT} />
    </>
  );
}
