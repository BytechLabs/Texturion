/**
 * /for/hvac (trades crew), v4 "FIRST RESPONSE". COPY-DECK v2 §/for/hvac:
 * dateline 6:48 AM · NO HEAT, H1 "The text inbox for HVAC crews.", pain H2
 * "You can't quote a furnace swap from the top of a ladder.", the no-heat
 * morning script (thermostat error photo, "bring the capacitor" note), the
 * v2 saved-replies list (on my way / filter reminder / quote follow-up /
 * booking confirmation / maintenance-season ask / review ask), and the
 * seasonal-rush FAQ framing. Honesty guard: reminders are something you
 * SEND, never "automated." Fully static; own metadata + BreadcrumbList.
 */

import type { Metadata } from "next";

import { CountryText } from "@/components/marketing/country";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { TradePage } from "@/components/marketing/trades/trade-page";
import type { TradeContent } from "@/components/marketing/trades/trade-page";
import { HVAC_SCRIPT } from "@/components/marketing/trades/scripts";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/for/hvac";

export const metadata: Metadata = buildMetadata({
  title: "Customer texting for HVAC companies",
  description:
    "A shared text inbox for HVAC contractors: triage no-heat mornings from one number, follow up on install quotes, send maintenance reminders. Flat $29/mo.",
  path: PATH,
});

const CONTENT: TradeContent = {
  slug: "hvac",
  displayName: "HVAC",

  dateline: "6:48 AM · NO HEAT",
  h1: "The text inbox for HVAC crews.",
  heroSub:
    "It's 6:48 in the morning, the house is cold, and the customer texted the only number they had. In a shared inbox, whoever's up answers, the right part rides the van, and the no-heat call is booked before the shop opens. One local number, $29 a month for the whole crew.",
  heroTruth:
    "Works on the phones your techs already carry · Live in minutes · No busy-season contract",

  painH2: "You can't quote a furnace swap from the top of a ladder.",
  painBody: [
    "HVAC demand doesn't trickle in; it spikes. The first morning of a cold snap, a dozen no-heat texts and calls hit before 8am, and the same thing happens in reverse the first heat wave of July. Route all of that through one owner's cell and you get a full voicemail box, a stressed dispatcher, and customers trying the next company because nobody answered.",
    "The rest of the year is the slow bleed: the furnace quote from three weeks ago that never got a follow-up, the maintenance-plan customer nobody reminded. Those are real dollars, and they slip because the follow-up lives on a sticky note. Loonext keeps the surge triaged and the follow-ups visible, the whole team working one inbox instead of one phone.",
  ],

  threadH2: "A no-heat morning, booked before the coffee.",
  threadLede:
    "A customer texts a photo of the thermostat error at 6:48 AM. The office reads the code, drops a note to bring the capacitor, and assigns the tech whose van has the part, who texts back a window and a diagnostic price before the shop even opens.",
  script: HVAC_SCRIPT,
  threadAriaLabel:
    "A Northline Heating conversation: a no-heat text with a thermostat error photo at 6:48 AM, assigned to Tariq and booked for 9",

  useCasesH2: "Where texting earns its keep in an HVAC business.",
  useCases: [
    {
      title: "Triage the surge instead of drowning in it.",
      body: "When the cold-snap texts pile up, the shared inbox is a queue: read the fault, note the likely part, assign the tech whose van has it, send a window. Nothing sits in a voicemail box while a house freezes.",
    },
    {
      title: "Read the fault before you dispatch.",
      body: "Ask for a photo of the thermostat error or the model plate. E4 versus a flashing light changes what part rides on the truck, and a photo in the thread means the tech rolls up with the capacitor already loaded.",
    },
    {
      title: "Follow up on install quotes before they go cold.",
      body: "A furnace or AC swap rarely closes the same day. Tag it “Quote sent” and it stays on the list until someone checks back in, instead of the job quietly going to whoever called them back first.",
    },
    {
      title: "Send maintenance reminders yourself, on time.",
      body: "Twice a year, text your plan customers to book the tune-up. You send it with a saved reply, so it's fast but it's a real person deciding who to contact, and the whole team sees who's been reminded and who's booked.",
    },
  ],

  savedRepliesH2: "Six texts every HVAC company sends. Steal these.",
  savedRepliesIntro:
    "Six saved replies worth setting up on day one: the on-my-way, the filter reminder, the tune-up ask, in the plain, reassuring tone a cold customer needs. Save each one once and it's two taps forever.",
  savedReplies: [
    {
      name: "On my way",
      text: "On the way now, should be with you in about 30 minutes. If the system is off, leave it off until I get there.",
    },
    {
      name: "Filter reminder",
      text: "Quick reminder to swap your filter this month. It keeps the system efficient and the warranty happy. Want us to drop off the right size?",
    },
    {
      name: "Quote follow-up",
      text: "Hi {first_name}, just checking in on the furnace quote we sent. Happy to answer questions or walk through financing. No rush, no pressure.",
    },
    {
      name: "Booking confirmation",
      text: "You're booked for Tuesday between 8 and 10. We'll text you when the tech is on the way.",
    },
    {
      name: "Maintenance-season ask",
      text: "It's tune-up season. Want us to check your system before the rush? Reply with a day that works and we'll set it up.",
    },
    {
      name: "Review ask",
      text: "Glad we got the heat back on, {first_name}. If you have a minute, a Google review helps a small shop like ours.",
    },
  ],
  savedRepliesCaption:
    "The HVAC pack in the composer: the tune-up ask goes out in two taps, not ten minutes.",

  featuresH2: "Built for how an HVAC company actually works.",
  features: [
    {
      title: "A dispatch queue the whole team shares.",
      body: "Assign each call to a tech and the surge becomes an ordered list with one owner per job. No two techs rolling to the same house.",
    },
    {
      title: "Seasonal, without seasonal lock-in.",
      body: "Step up to Pro for the busy season and drop back when it slows. Flat pricing, month to month, so you're never paying for July capacity in October.",
    },
    {
      title: "Follow-ups that stay visible.",
      body: "Tag the install quotes and the tune-up reminders; they sit on the list until they're closed, so the money doesn't leak while everyone's busy.",
    },
    {
      title: "Works from the mechanical room.",
      body: "Any phone, one-handed, no app to install. Push notifications for a new no-heat text, and a dark mode for the pre-dawn cold-snap starts.",
    },
  ],

  pricingH2: "$29 a month, flat. Cold snap or slow week.",
  pricingBody:
    "Starter covers 5 people, 1 local number, and 500 texts a month. A surge week will send more, and that's fine: extra texts are 3¢ each up to a cap you set, and the composer shows the count before you send. Want to split the service line from the install line? Pro is $79, covers any size crew, and includes a second number for exactly that.",

  faqH2: "HVAC questions, straight answers.",
  faqs: [
    {
      q: "Does Loonext send maintenance reminders automatically?",
      a: "No. Reminders are something you send, fast, with a saved reply: pull up your plan customers and text the tune-up nudge in a couple of taps. That keeps a real person deciding who to contact, and it keeps you inside the phone companies' rules on unsolicited blasts. What Loonext gives you is the shared inbox where the whole team sees who's been reminded and who's booked.",
    },
    {
      q: "The calls all hit at once in a cold snap. How does a shared inbox help?",
      a: "It turns the pile-up into a queue. Every no-heat text becomes a conversation the whole team can triage: read the fault, note the likely part, assign the closest tech, send a window. Nothing rots in a voicemail box while a furnace is down.",
    },
    {
      q: "Can customers text photos of the fault code or model plate?",
      a: "Yes, and receiving them is free. A photo of the thermostat error or the data plate often tells you the part before anyone drives out, so the right capacitor or board is already on the van.",
    },
    {
      q: "We add techs for the busy season. Do we pay per person?",
      a: "No per-user fees. Starter is $29 for 5 people; scale to Pro at $79 for any size crew during the surge, then drop back when it quiets down. It's month to month.",
    },
    {
      q: "How do we keep install quotes from going cold?",
      a: "Tag the conversation “Quote sent.” It stays on the list until someone closes it, so a big furnace or AC quote gets a real follow-up instead of slipping while everyone's chasing service calls.",
    },
    {
      q: "What do you need from our company to get us approved for texting?",
      a: (
        <CountryText
          us="We file it for you: two minutes at signup with your legal business name, address, and EIN. No EIN because you run as a sole proprietor? We verify you with a texted code instead. Receiving texts works from day one, and texting US customers turns on in about a week, typically 3 to 7 business days, once the phone companies sign off."
          ca="Nothing to register and no wait. A Canadian shop texting Canadian customers is texting the same day it signs up."
        />
      ),
    },
  ],

  finalH2: "Turn the cold-snap pile-up into a queue.",
  finalSub:
    "One shared inbox to triage the surge, read the fault, and keep the follow-ups from leaking. Live in minutes.",
};

export default function HvacPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "HVAC", path: PATH },
        ])}
      />
      <TradePage content={CONTENT} />
    </>
  );
}
