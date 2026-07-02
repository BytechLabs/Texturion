/**
 * /features/business-number — the business number + multi-number story
 * (BLUEPRINT §2, §4). Targets "business phone number for texting" and
 * "second number for business texting".
 *
 * Angles (§4): local numbers, type-a-city area-code picker (the shared NANP
 * widget), what "local" does for answer rates (framed as common sense, not fake
 * stats), multi-number is REAL — Pro includes 2 (two locations, or office +
 * field) with per-number threading, the number is the business's not an
 * employee's, and the Canada instant path. 700+ words, hand-written, unique
 * FAQ. buildMetadata + BreadcrumbList JSON-LD; NO FAQPage (§11.2).
 */

import { Building2, Layers, MapPin, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { CityAreaCodeWidget } from "@/components/marketing/interactive/city-area-code-widget";
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
import { NumberCardsVisual } from "@/components/marketing/features/number-cards-visual";
import { InboxListVisual } from "@/components/marketing/features/inbox-list-visual";
import { CoverageMapNA, OneNumberManyPeople } from "@/components/marketing/art";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/features/business-number";

export const metadata: Metadata = buildMetadata({
  title: "Your business texting number — local, and yours",
  description:
    "A local texting number in the area code you choose, so your personal cell stays personal. Pro gives you two numbers, each with its own inbox. Flat $29/mo.",
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
        eyebrow="Your business number"
        title="A texting number that belongs to the business."
        sub="Pick a local number in the area code you want, and give your customers one place to text. Your personal cell goes back to being personal — and the number, the contacts, and every conversation stay with the company, not with whoever's phone they landed on."
        truthChips={[
          "Local number, your area code",
          "Two numbers on Pro",
          "Canadian numbers text day one",
        ]}
        visual={<InboxListVisual />}
      />

      {/* Section 1 — pick a local number, your area code. */}
      <FeatureSection
        eyebrow="Local, on purpose"
        heading="Type a city. Get a local number."
        visual={<CityAreaCodeWidget />}
        wash
      >
        <p>
          When you sign up, you tell JobText where your customers are — a city or
          an area code — and we find you a local number to match. A shop in
          Toronto gets a (416) or (647); a shop in Austin gets a (512). The
          picker above uses the exact same numbering data the app uses to choose
          your number, so what you see here is what you&apos;ll get.
        </p>
        <p>
          Local matters for a plain, common-sense reason: people answer a number
          that looks like it&apos;s from around the corner. A neighbourhood area
          code reads as a real local business, not a call centre — which is
          exactly what you are. We won&apos;t quote you an invented
          &ldquo;answer-rate&rdquo; statistic; we&apos;ll just say your number
          should look like it belongs where your customers live, and let you
          pick it.
        </p>
      </FeatureSection>

      {/* Section 2 — the number is the business's. */}
      <FeatureSection
        eyebrow="It's the company's number"
        heading="Get the business off your personal cell."
        visual={
          <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8">
            <OneNumberManyPeople
              className="w-full"
              title="One business number feeding a shared inbox the whole crew can see."
            />
            <p className="mt-6 text-center text-[13px] leading-relaxed text-muted-foreground">
              One number, owned by the company — shared by the whole crew, on
              their own phones.
            </p>
          </div>
        }
        flip
      >
        <p>
          The moment a customer has a tech&apos;s personal number, the business
          has a problem. Quotes and bookings land in someone&apos;s private
          messages, between the family group chat and the dentist reminder. When
          that person is off, the business is off. When that person leaves, the
          conversations — and sometimes the customers — leave with them.
        </p>
        <p>
          A JobText number fixes that at the root. It&apos;s owned by the
          company and shared by the crew, so the front door to your business is a
          single, consistent number that everyone can answer and nobody can walk
          off with. Your own cell stops buzzing with work at 9pm, and the
          history of every customer stays where it belongs — with the business.
        </p>
      </FeatureSection>

      {/* Section 3 — multi-number (the under-sold weapon). */}
      <FeatureSection
        eyebrow="Multi-number, for real"
        heading="Two numbers on Pro — two front doors, one crew."
        visual={<NumberCardsVisual />}
        wash
      >
        <p>
          This is the part most tools either don&apos;t do or quietly upcharge
          for: <strong>Pro includes two separate business numbers</strong>, each
          with its own inbox thread. Run two locations and want a distinct number
          for each? Done. Want an office line that the front desk watches and a
          field line for the crew in the trucks? Also done. The texts to each
          number stay in their own conversations, so nothing bleeds together, and
          your whole team still works out of the one shared inbox.
        </p>
        <p>
          It&apos;s a genuinely useful setup that usually costs extra elsewhere —
          the per-user tools tend to bill a few dollars a month for every added
          number. On JobText, the second number is simply part of Pro.
        </p>
      </FeatureSection>

      {/* Section 4 — Canada instant path. */}
      <FeatureSection
        eyebrow="Canadian numbers"
        heading="A Canadian number that texts the same day."
        visual={
          <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8">
            <CoverageMapNA className="w-full" />
            <p className="mt-6 text-center text-[13px] leading-relaxed text-muted-foreground">
              Local numbers across the US and Canada — and Canadian numbers text
              the same day you sign up.
            </p>
          </div>
        }
        flip
      >
        <p>
          If your customers are in Canada, a Canadian number on JobText is live
          for texting the day you sign up — no US carrier registration to wait
          on, because that requirement doesn&apos;t apply to a Canadian business
          texting Canadian customers. Local numbers are available across every
          province, and CASL-aware consent and identification are handled for you
          from the first message.
        </p>
        <p>
          Want to text US customers later too? You can enable that any time; the
          one-time $29 registration fee and the roughly-one-week carrier approval
          apply then, and everything you&apos;ve already set up stays exactly as
          it is.{" "}
          <a
            href="/canada"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            See the full Canada story →
          </a>
        </p>
      </FeatureSection>

      {/* Feature strip. */}
      <FeatureStrip
        heading="What your business number gives you."
        items={[
          {
            icon: MapPin,
            title: "Your area code",
            body: "Choose a local number that matches where your customers are — real NANP data, the same table onboarding uses.",
          },
          {
            icon: Building2,
            title: "Owned by the company",
            body: "The number, contacts, and history belong to the business — techs come and go, the number stays.",
          },
          {
            icon: Layers,
            title: "Two numbers on Pro",
            body: "Two locations, or an office line and a field line — each with its own inbox thread, both in one shared workspace.",
          },
          {
            icon: ShieldCheck,
            title: "Personal cells stay private",
            body: "Customers text the business number, not a tech's mobile — so nobody's personal phone becomes the company hotline.",
          },
        ]}
      />

      {/* Honest details. */}
      <HonestDetails
        lead="A phone number is a serious thing to hand your customers, so here's exactly how JobText numbers work — including what isn't possible yet."
        items={[
          {
            term: "We can't port your existing number yet.",
            detail:
              "JobText gives you a new local number; it can't take over the number already on your trucks today. Number porting is on the roadmap and we won't pretend it's here before it is. In the meantime, forward your existing number to your JobText number (your carrier does this for calls in a couple of minutes) and move customers to the new number over time.",
          },
          {
            term: "Numbers are US and Canada only.",
            detail:
              "You can pick a local number in the United States or Canada, and text customers in both countries. Texting destinations outside the US and Canada isn't supported.",
          },
          {
            term: "A number requires a paid plan.",
            detail:
              "There's no free, unclaimed number sitting around — the phone companies charge for every number, and free numbers attract spam that wrecks delivery. A number is provisioned only after you subscribe, usually within a minute or two.",
          },
          {
            term: "Sole proprietors get one number.",
            detail:
              "If you register without an EIN via the sole-proprietor path, US carrier rules cap you at a single number regardless of plan. Register with an EIN to use Pro's second number.",
          },
        ]}
      />

      {/* Mini-pricing. */}
      <MiniPricing
        body={
          <>
            <p>
              One local number comes with Starter at $29/mo (up to 3 people); a
              second number comes with Pro at $79/mo (up to 10 people). Both are
              flat, month to month, with receiving always free and unlimited.
            </p>
            <p>
              US shops pay a one-time $29 to register the business with the phone
              companies — once, ever — so the first month is $58 and every month
              after is $29. Canadian businesses that stick to Canadian customers
              never pay it.
            </p>
          </>
        }
      />

      {/* Internal links. */}
      <RelatedLinks
        heading="Where a business number does the most work"
        intro="A dedicated number matters most for crews spread across jobs and trades that live on their phones. Here's where it fits — and how the flat-price model compares to the per-user tools."
        links={[
          {
            label: "Texting for contractors",
            href: "/for/contractors",
            hint: "Keep subs, GCs, and clients off one personal cell — on the company's number.",
          },
          {
            label: "Texting for landscapers",
            href: "/for/landscapers",
            hint: "Crews spread across sites, all reachable at one local number.",
          },
          {
            label: "JobText in Canada",
            href: "/canada",
            hint: "Local Canadian numbers that text the same day you sign up.",
          },
          {
            label: "JobText vs Quo",
            href: "/compare/quo",
            hint: "Two numbers on Pro, next to a tool that charges per extra number.",
          },
        ]}
      />

      {/* Page-specific FAQ — unique to business-number. */}
      <FeatureFaq
        heading="Number questions, straight answers."
        faqs={[
          {
            q: "Can I choose my area code?",
            a: "Yes. Tell us a city or an area code when you sign up and we find you a local number to match, drawn from real numbering data. If the exact code you asked for has no inventory at that moment, we fall back to another local number in the same region.",
          },
          {
            q: "Can I keep the number already on my trucks and my Google listing?",
            a: "Not by porting it in yet — that feature is on the roadmap. The workaround that loses you nothing: forward your existing number to your new JobText number (your phone carrier sets up call forwarding in a couple of minutes) and start putting the JobText number on new signs and quotes. Your old number keeps ringing and forwarding; new texts come to JobText.",
          },
          {
            q: "What do the two numbers on Pro actually get me?",
            a: "Two separate local numbers, each with its own inbox thread inside the same shared workspace. Common setups are an office line and a field line, or one number per location. Your whole team still works from one inbox; the conversations just stay grouped by which number they came in on.",
          },
          {
            q: "Is the number really the business's, not mine personally?",
            a: "Yes. The number is owned by the company account and shared by the crew. Teammates open a link to join and reply from their own phones, but the number, the contacts, and every conversation stay with the business when someone leaves.",
          },
          {
            q: "How fast is a new number ready?",
            a: "Usually a minute or two after you subscribe. Receiving texts works as soon as the number is active, and if you're in Canada you can text Canadian customers right away. Texting US customers turns on after carrier approval, typically about a week.",
          },
        ]}
      />

      <FeatureCta
        heading="Get a number your customers can text."
        sub="Pick your local area code, keep your personal cell private, and give the whole crew one number to share. Live in minutes."
      />
    </>
  );
}
