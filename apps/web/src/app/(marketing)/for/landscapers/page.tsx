/**
 * /for/landscapers (trades crew), v4 "FIRST RESPONSE". COPY-DECK v2
 * §/for/landscapers: dateline 7:15 AM · GATE LOCKED, H1 "The text inbox for
 * landscaping crews.", pain H2 "You can't answer the phone from the top of a
 * mower.", the gate-code script with the "add the back beds this week?"
 * upsell, and the v2 use cases (weather reschedules in two taps,
 * before-and-after photos, spring-list follow-ups). Fully static; own
 * metadata + BreadcrumbList JSON-LD.
 */

import type { Metadata } from "next";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { TradePage } from "@/components/marketing/trades/trade-page";
import type { TradeContent } from "@/components/marketing/trades/trade-page";
import { LANDSCAPERS_SCRIPT } from "@/components/marketing/trades/scripts";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/for/landscapers";

export const metadata: Metadata = buildMetadata({
  title: "Texting software for landscaping businesses",
  description:
    "A shared text inbox for landscaping crews: quote from a yard photo, keep every gate code with the property, reschedule around the weather. Flat $29/mo.",
  path: PATH,
});

const CONTENT: TradeContent = {
  slug: "landscapers",
  displayName: "Landscapers",

  dateline: "7:15 AM · GATE LOCKED",
  h1: "The text inbox for landscaping crews.",
  heroSub:
    "The crew is at the gate, the gate is locked, and the code is in a text thread on somebody's day off. Loonext puts every gate code, reschedule, and add-on ask in one shared inbox on one business number. $29 a month for the whole company.",
  heroTruth:
    "One number for every property · Live in minutes · No busy-season lock-in",

  painH2: "You can't answer the phone from the top of a mower.",
  painBody: [
    "Landscaping runs in waves. The first warm week, everyone wants a spring cleanup, a mulch estimate, and a mowing quote, all at once, all by text, all to the number on the truck. If that number is the owner's cell, the owner spends the busiest month of the year as a receptionist instead of running crews.",
    "And the work is spread out. One crew's on the Alvarez lawn, another's across town, and the gate codes, addresses, and “which corner did they want re-mulched” live in a hundred separate threads on separate phones. Loonext puts every property's conversation in one inbox, so the person quoting and the crew doing the work see the same photos, the same code, the same notes.",
  ],

  threadH2: "A locked gate, turned into next week's job.",
  threadLede:
    "The crew's idling at a locked side gate at 7:15 AM. One text gets the code, the code gets saved to the contact, and the customer's “could you add the back beds?” becomes a priced cleanup folded into Thursday's route.",
  script: LANDSCAPERS_SCRIPT,
  threadAriaLabel:
    "A Greenline landscaping conversation: a locked side gate at 7:15 AM, the code saved to the contact, and a back-beds cleanup quoted for Thursday",

  useCasesH2: "Where texting earns its keep in a landscaping business.",
  useCases: [
    {
      title: "Weather reschedules, in two taps.",
      body: "Rain moves the route. Pull up the day's conversations and text each customer the new time with a saved reply. It's a few taps per stop, and everyone knows before they wonder where the crew is.",
    },
    {
      title: "Before-and-after photos, in the thread.",
      body: "Customers text the overgrown before; you text back the finished after. Every photo sits in the conversation, free to receive, so the quote, the work, and the proof live in one place.",
    },
    {
      title: "Spring-list follow-ups that book the season.",
      body: "Last year's clients are this year's easiest work. A quick “want back on the every-other-week rotation?” sent down the spring list with a saved reply fills the calendar before the phone starts ringing.",
    },
    {
      title: "Gate codes saved where the crew can see them.",
      body: "Save “side gate 2580, dog in the yard Thursdays” to the contact once, and whichever crew pulls up has it on their own phone. Nobody idles in the driveway texting the office.",
    },
  ],

  savedRepliesH2: "Six texts every landscaping crew sends. Steal these.",
  savedRepliesIntro:
    "Six saved replies worth setting up on day one: the photo ask, the weather bump, the season renewal, in words a homeowner actually reads. Save each one once and it's two taps forever.",
  savedReplies: [
    {
      name: "Photo request",
      text: "Happy to quote that. Could you text me a couple photos of the area and the rough size? I can usually get you a price without a site visit.",
    },
    {
      name: "Quote sent",
      text: "Hi {first_name}, here's your estimate for the cleanup and mulch: $340. That includes bed edging and hauling away the clippings. Want me to pencil you in?",
    },
    {
      name: "Weather reschedule",
      text: "Heads up, rain's moving in, so we're bumping your service from Tuesday to Wednesday. Same crew, same scope. Let me know if that doesn't work.",
    },
    {
      name: "On the way",
      text: "The crew's heading your way now and will be there within the hour. No need to be home; we'll text you a photo when it's done.",
    },
    {
      name: "Season renewal",
      text: "It's almost mowing season again. Want us to put you back on the every-other-week rotation at last year's rate? Reply yes and you're set.",
    },
    {
      name: "Job done",
      text: "All wrapped up: beds edged, mulched, and cleaned up. Photos attached. Anything you'd like tweaked, just text us here.",
    },
  ],
  savedRepliesCaption:
    "The landscaping pack in the composer: the weather bump goes down a whole route in a few taps.",

  featuresH2: "Built for how a landscaping company actually works.",
  features: [
    {
      title: "Every property in one place.",
      body: "Addresses, gate codes, and “re-mulch the front only” notes live on the contact, not scattered across five crew members' phones.",
    },
    {
      title: "Assign to the closest crew.",
      body: "One owner per conversation, so the right crew gets the job and nobody double-books the same street.",
    },
    {
      title: "Handle the whole season from one inbox.",
      body: "Quote season, recurring visits, and end-of-season renewals in one shared history, with no per-user fee as you add seasonal help.",
    },
    {
      title: "Photos in and out.",
      body: "Customers send the before, you send the after. Receiving photos is free on every plan; sending them back is a $5/mo add-on with 150 picture messages included.",
    },
  ],

  pricingH2: "$29 a month, flat. Even in April.",
  pricingBody:
    "Starter is 3 people, 1 local number, and 500 texts a month. In the spring rush you'll send more; extra texts are 3¢ each with a cap you control, and the composer shows the count before you send. Add seasonal crew on Pro at $79 for up to 10 people and a second number, then drop back when the season winds down.",

  faqH2: "Landscaper questions, straight answers.",
  faqs: [
    {
      q: "Can I quote a job from photos instead of driving out?",
      a: "Yes, that's most of the point. Customers text photos of the yard or beds, receiving them is free, and they sit in the conversation so whoever's quoting and whoever's doing the work both see them. Save the truck rolls for jobs that truly need a walk-through.",
    },
    {
      q: "We add crew for the season. Do we pay per person?",
      a: "No per-user fee, ever. Starter covers 3 people for $29; when you scale up for the busy months, Pro is $79 for up to 10. Drop back down between seasons, since it's month to month.",
    },
    {
      q: "Can the whole crew see a property's address and gate code?",
      a: "Yes. Save it once to the contact or drop it as an internal note in the thread, and every crew member sees it on their own phone. No more texting the code around before every visit.",
    },
    {
      q: "The weather changes our schedule constantly. Does texting help?",
      a: "It's the fastest way to reschedule. Pull up the day's conversations, send each affected customer the new time with a saved reply, and everyone knows before the crew doesn't show. Loonext doesn't reschedule for you, but it makes sending 15 updates a two-minute job.",
    },
    {
      q: "Our customers are seasonal. Will they remember us next spring?",
      a: "The whole conversation history stays in the inbox, so next season you're texting a familiar name, not starting cold. A quick “want back on the rotation?” to last year's clients is often the easiest work you'll book all year.",
    },
    {
      q: "How much of our time does the texting registration take?",
      a: "About two minutes when you sign up: your legal business name, address, and EIN. If you run the crew as a sole proprietor with no EIN, we verify you with a texted code instead. From there we file everything with the phone companies. You can receive texts right away, and texting US customers turns on within about a week once you're cleared.",
    },
  ],

  finalH2: "One number for every property you service.",
  finalSub:
    "Quote from a photo, dispatch the nearest crew, and keep every gate code in one shared inbox. Live in minutes.",
};

export default function LandscapersPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Landscapers", path: PATH },
        ])}
      />
      <TradePage content={CONTENT} />
    </>
  );
}
