/**
 * /features/business-number, on the v4 "FIRST RESPONSE" FEATURE template
 * (DESIGN-DIRECTION v4 §6, COPY-DECK v2).
 *
 * Dateline `THE NUMBER BELONGS TO THE BUSINESS` → H1 "A local number that
 * belongs to the business, not to somebody's phone." → sections: pick a
 * local number (live in minutes), bring your number (free porting,
 * self-serve, the old number keeps working until the scheduled cutover,
 * usually a few days to two weeks for US numbers and often faster in
 * Canada), two numbers on Pro → Truth Strip branched by country (US
 * first-week approval in US mode, same-day/no-wait in CA mode) → pricing
 * snippet branched by country → unique FAQ → Frost CTA band.
 *
 * Every number is a verified product/billing fact. buildMetadata +
 * BreadcrumbList JSON-LD; no FAQPage.
 */

import type { Metadata } from "next";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { PanelFrame } from "@/components/marketing/fr";
import { CountryOnly, CountryText } from "@/components/marketing/country";
import { CityAreaCodeWidget } from "@/components/marketing/interactive/city-area-code-widget";
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
import { NumberCardsVisual } from "@/components/marketing/features/number-cards-visual";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/features/business-number";

/**
 * The two "precise edges" facts that hold in both countries. The sole-proprietor
 * single-number cap is a US 10DLC-registration mechanic, so it lives only in the
 * US branch of PlainDetails below (Canada-to-Canada texting has no registration).
 */
const PORT_DETAIL = {
  term: "A port takes days, not minutes.",
  detail:
    "Moving a number between carriers is a real telecom process, usually a few days to two weeks for US numbers and often faster in Canada. Your number keeps working on your current carrier the whole time and switches to Loonext on the scheduled transfer date. Nobody can truthfully promise an instant port, so we don't.",
} as const;

const PAID_PLAN_DETAIL = {
  term: "A number requires a paid plan.",
  detail:
    "The phone companies charge for every number, and free numbers attract the spam that wrecks delivery for everyone. A number is provisioned only after you subscribe, usually within a minute or two.",
} as const;

export const metadata: Metadata = buildMetadata({
  title: "A local business number for texting, and it's yours",
  description:
    "Pick a local number in the area code you choose, usually live in a minute or two, or bring the number on your trucks. Porting is free. Two numbers on Pro. $29/mo flat.",
  path: PATH,
});

export default function BusinessNumberPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Your business number", path: PATH },
        ])}
      />

      <FeatureHero
        dateline="THE NUMBER BELONGS TO THE BUSINESS"
        title="A local number that belongs to the business, not to somebody's phone."
        sub="Pick a local number in the area code you choose, usually live in a minute or two, and give your customers one place to text. Your personal cell goes back to being personal, and the number, the contacts, and every conversation stay with the company when a tech moves on."
        panel={
          <PanelFrame
            chromeUrl="loonext.com/settings"
            caption="Two numbers on Pro: an office line and a field line, each with its own inbox."
            ariaLabel="The Loonext numbers settings showing two active business numbers with their unread counts"
          >
            <NumberCardsVisual />
          </PanelFrame>
        }
      />

      <FeatureSection
        ground="frost"
        eyebrow="Local, on purpose"
        heading="Type a city. Get a local number."
        visual={<CityAreaCodeWidget />}
      >
        <p>
          When you sign up, you tell Loonext where your customers are, a city
          or an area code, and we find you a local number to match. A shop in
          Toronto gets a (416) or a (647); a shop in Austin gets a (512). The
          picker here runs on the same numbering data the app uses to choose
          your number, so what you see is what you&apos;d get.
        </p>
        <p>
          Local matters for a plain, common-sense reason: people answer a
          number that looks like it&apos;s from around the corner. A
          neighbourhood area code reads as a real local business, which is
          exactly what you are. We won&apos;t quote an invented answer-rate
          statistic; we&apos;ll just let you pick the code your customers
          already trust.
        </p>
      </FeatureSection>

      <FeatureSection
        eyebrow="Bring your number"
        heading="Keep the number on your trucks. Porting is free."
        flip
      >
        <p>
          Already have a number your customers know, the one on your trucks,
          your yard signs, and your Google listing? Bring it. Porting is free
          and self-serve: choose &quot;Bring my number&quot; at signup or
          start it later from settings, answer a few questions about your
          current carrier, and we handle the carrier paperwork and show you
          where the transfer is the whole way.
        </p>
        <p>
          Your number keeps working on your old carrier while it moves,
          usually a few days to two weeks for US numbers and often faster in
          Canada, then switches to Loonext on a scheduled date. Nothing on
          your trucks or your listing has to change, and if you want to start
          texting today, get a new local number now and port your existing one
          alongside it.
        </p>
      </FeatureSection>

      <UseCaseSteps
        eyebrow="What the number fixes"
        heading="Three problems that end the day the business owns its number."
        steps={[
          {
            title: "The buried quote",
            body: "Quotes and bookings stop landing in one person's private messages, between the family group chat and the dentist reminder. They land on the business number, where the whole crew can see and answer them.",
          },
          {
            title: "The tech who moved on",
            body: "When a number lives on someone's personal phone, their conversations, their contacts, and sometimes their customers leave with them. A company-owned number keeps the history where it belongs.",
          },
          {
            title: "Two front doors, on Pro",
            body: "Pro includes 2 local numbers, each with its own inbox: two locations, or an office line the front desk watches and a field line for the trucks. One crew, one workspace, no bleed between them.",
          },
        ]}
      />

      <CountryOnly country="us">
        <TruthStripSection
          heading="The first week, stated plainly"
          items={[
            {
              text: "Your number is live and receiving texts on day one.",
              good: true,
            },
            {
              text: "Texting US customers turns on in about a week, 3 to 7 business days, once the phone companies approve you. We file everything the minute you pay.",
            },
            {
              text: "Numbers are US and Canada only, and a number is provisioned after you subscribe, usually in a minute or two.",
            },
          ]}
        />
      </CountryOnly>

      <CountryOnly country="ca">
        <TruthStripSection
          heading="Day one, stated plainly"
          items={[
            {
              text: "Your number is live and you can text Canadian customers the same day it goes active, usually a minute or two after signup.",
              good: true,
            },
            {
              text: "No registration, no fee, and no approval wait to text Canadian customers.",
              good: true,
            },
            {
              text: "Numbers are US and Canada only, and a number is provisioned after you subscribe, usually in a minute or two.",
            },
          ]}
        />
      </CountryOnly>

      <CountryOnly country="us">
        <PlainDetails
          heading="The precise edges"
          lead="A phone number is a serious thing to hand your customers, so here is exactly how Loonext numbers work, including the limits."
          items={[
            PORT_DETAIL,
            {
              term: "Sole proprietors get one number.",
              detail:
                "If you register without an EIN through the sole-proprietor path, US carrier rules cap you at a single number regardless of plan. Register with an EIN to use Pro's second number.",
            },
            PAID_PLAN_DETAIL,
          ]}
        />
      </CountryOnly>

      <CountryOnly country="ca">
        <PlainDetails
          heading="The precise edges"
          lead="A phone number is a serious thing to hand your customers, so here is exactly how Loonext numbers work, including the limits."
          items={[PORT_DETAIL, PAID_PLAN_DETAIL]}
        />
      </CountryOnly>

      <PricingSnippet>
        <p>
          One local number comes with Starter at $29/mo for up to 3 people; a
          second number comes with Pro at $79/mo for up to 10. Both are flat,
          month to month, with receiving texts always free and unlimited. Porting a
          number in is free.
        </p>
        <CountryText
          us={
            <p>
              US shops pay a one-time $29 to register the business with the
              phone companies, once, ever, so the first month is $58 and every
              month after is $29.
            </p>
          }
          ca={
            <p>
              Texting Canadian customers needs no registration and no one-time
              fee, so your first month is the same flat $29 or $79 as every
              month after.
            </p>
          }
        />
      </PricingSnippet>

      <RelatedLinks
        heading="Where a business number does the most work"
        intro="A dedicated number matters most for crews spread across jobs. Here's where it fits, and how the flat price compares to tools that charge for every extra number."
        links={[
          {
            label: "Texting for contractors",
            href: "/for/contractors",
            hint: "Keep subs, GCs, and clients off one personal cell, on the company's number.",
          },
          {
            label: "Texting for landscapers",
            href: "/for/landscapers",
            hint: "Crews spread across sites, all reachable at one local number.",
          },
          {
            label: "Loonext in Canada",
            href: "/canada",
            hint: "How Loonext works for Canadian crews.",
          },
          {
            label: "Loonext vs Quo",
            href: "/compare/quo",
            hint: "Two numbers included on Pro, next to a tool that charges $5/mo per extra number.",
          },
        ]}
      />

      <FeatureFaq
        heading="Number questions, straight answers."
        faqs={[
          {
            q: "Can I choose my area code?",
            a: "Yes. Tell us a city or an area code when you sign up and we find you a local number to match, drawn from real numbering data. If the exact code you asked for has no inventory at that moment, we fall back to another local number in the same region.",
          },
          {
            q: "Can I keep the number already on my trucks and my Google listing?",
            a: "Yes. Porting is free and self-serve: choose 'Bring my number' at signup or start it later from settings, answer a few questions, and we handle the carrier paperwork and show you where the transfer is the whole way. Your number keeps working on your old carrier while it moves, usually a few days to two weeks for US numbers and often faster in Canada, then switches to Loonext on a scheduled date. Nothing on your trucks or your listing has to change.",
          },
          {
            q: "What do the two numbers on Pro actually get me?",
            a: "Two separate local numbers, each with its own inbox thread inside the same shared workspace. Common setups are an office line and a field line, or one number per location. Your whole team still works from one inbox; the conversations stay grouped by which number they came in on.",
          },
          {
            q: "Is the number really the business's, not mine personally?",
            a: "Yes. The number is owned by the company account and shared by the crew. Teammates open a link to join and reply from their own phones, but the number, the contacts, and every conversation stay with the business when someone leaves.",
          },
          {
            q: "How fast is a new number ready?",
            a: (
              <>
                Usually a minute or two after you subscribe. Receiving texts
                works as soon as the number is active.{" "}
                <CountryText
                  us="Texting US customers turns on after carrier approval, typically 3 to 7 business days."
                  ca="You can text Canadian customers the same day, with no registration and no approval wait."
                />
              </>
            ),
          },
        ]}
      />

      <FeatureCta
        heading="Get a number your customers can text."
        sub="Pick your local area code or bring the number you have, keep your personal cell private, and give the whole crew one number to share. Live in minutes."
      />
    </>
  );
}
