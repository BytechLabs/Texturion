/**
 * /compare/podium. JobText vs Podium (BLUEPRINT §5–6).
 *
 * The honest anti-Podium page: transparent self-serve pricing vs demo-only
 * sales gate, month-to-month vs annual lock-in, a focused SMS inbox vs an
 * all-in-one AI/reviews/payments platform. Podium is a real, capable platform
 * for a different buyer, we concede that outright (§6), which is the
 * conversion device.
 *
 * Every Podium claim is dated "as of July 2026" and traces to
 * docs/marketing/competitor-site-teardowns.md (§6) or a live fetch of
 * podium.com/pricing (re-verified 2026-07-02). Podium publishes NO prices, so
 * the only dollar figure used (~$399/mo Core) is stamped "reported by
 * third-party reviewers, not published by Podium", never presented as a
 * Podium-published fact. No fabricated head-to-head stats, no aggregateRating.
 *
 * JSON-LD: buildMetadata + BreadcrumbList only (no SoftwareApplication here,
 * that lives on home + pricing per §11.2; no FAQPage, dead rich result).
 * Fully static (§11.4). Zero sentences shared with the Heymarket/Quo pages (§6).
 */

import type { Metadata } from "next";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { Section } from "@/components/marketing/ui/section";
import { Display } from "@/components/marketing/display";
import {
  Advantages,
  AtAGlanceChart,
  BetterPickCallout,
  CompareCta,
  CompareFaq,
  CompareHero,
  CompareHeroPhoto,
  CompareRelatedLinks,
  PayMathBlock,
  SwitchingNote,
  WhoEachIsFor,
} from "@/components/marketing/compare/compare-sections";
import {
  ComparisonTable,
  type ComparisonRow,
} from "@/components/marketing/compare/comparison-table";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/compare/podium";
const COMPETITOR = "Podium";

export const metadata: Metadata = buildMetadata({
  title: "JobText vs Podium: pricing & honest differences (2026)",
  description:
    "A fair, dated comparison: JobText is a $29/mo flat, self-serve text inbox; Podium is a demo-only, annual-contract all-in-one platform (reported ~$399/mo).",
  path: PATH,
});

/* -------------------------------------------------------------------------- */
/* Comparison table, every cell dated + sourced (§6, §13.7).                  */
/* -------------------------------------------------------------------------- */

const ROWS: ComparisonRow[] = [
  {
    label: "How you buy",
    jobtext: {
      value: "Self-serve. See the price, pay, start texting.",
      emphasis: true,
      note: "SPEC §1–2: pricing published, sign up and pay online.",
    },
    competitor: {
      value: "Book a demo / talk to sales",
      note: 'Pricing page: "talk to our sales team for details"; sales phone 1-801-438-4425 in the nav.',
    },
  },
  {
    label: "Published price",
    jobtext: {
      value: "$29/mo (Starter) · $79/mo (Pro)",
      emphasis: true,
      note: "On the pricing page; flat, not per seat.",
    },
    competitor: {
      value: "None published",
      note: 'Pricing page shows no dollar amounts. Third-party reviewers report Core starts ~$399/mo, not published by Podium.',
    },
  },
  {
    label: "Contract",
    jobtext: {
      value: "Month to month, cancel anytime",
      emphasis: true,
      note: "Cancel in billing settings; no phone call.",
    },
    competitor: {
      value: "Annual term reported",
      note: "Third-party reviews report 12-month terms with 30-day written notice before renewal; Podium doesn't state terms on the pricing page.",
    },
  },
  {
    label: "What it is",
    jobtext: {
      value: "A shared SMS inbox, and that's it",
      note: "Reply, assign, tag, note, search, close, from any phone.",
    },
    competitor: {
      value: 'All-in-one "AI Employee" platform',
      note: 'Podium home page: AI answering, reviews, webchat, text-to-pay, and messaging in one product.',
    },
  },
  {
    label: "Team pricing",
    jobtext: {
      value: "Flat, 3 people on $29, 10 on $79",
      emphasis: true,
      note: "No per-seat charge (SPEC §2).",
    },
    competitor: {
      value: "Not disclosed publicly",
      note: "Per-location / add-on charges reported by reviewers; no public seat pricing.",
    },
  },
  {
    label: "US texting go-live",
    jobtext: {
      value: "About a week after signup",
      note: "Carrier registration filed at signup; receiving + Canada texting work day one (SPEC §4.1).",
    },
    competitor: {
      value: "Not stated publicly",
      note: 'Pricing FAQ references a "base 10DLC fee" but the amount and timeline aren\'t shown.',
    },
  },
  {
    label: "Voice, reviews, payments",
    jobtext: {
      value: "Not included, texting only",
      note: "We're a shared text inbox. No calls, no review management, no payments.",
    },
    competitor: {
      value: "Included / core to the product",
      emphasis: true,
      note: "Reviews, webchat, and text-to-pay are central to Podium's offering.",
    },
  },
];

/* -------------------------------------------------------------------------- */
/* "What you'll actually pay", first-year, honest and dated.                  */
/* -------------------------------------------------------------------------- */

function PodiumCostStack() {
  const rows: { label: string; jobtext: string; podium: string }[] = [
    {
      label: "First month, out the door",
      jobtext: "$58 ($29 plan + one-time $29 US registration)",
      podium: "Not published, quote required",
    },
    {
      label: "Every month after",
      jobtext: "$29 flat",
      podium: "Reported ~$399/mo Core, before add-ons",
    },
    {
      label: "To even see a number",
      jobtext: "Read the pricing page",
      podium: "Book a demo with sales",
    },
    {
      label: "Commitment",
      jobtext: "Cancel any month",
      podium: "Annual term reported",
    },
  ];
  return (
    <div className="overflow-x-auto rounded-2xl border border-[color:var(--hairline)]">
      <table className="w-full min-w-[560px] border-collapse text-left text-[14px]">
        <thead>
          <tr className="border-b border-[color:var(--hairline)]">
            <th className="p-4 text-[13px] font-medium text-[color:var(--graphite)]" />
            <th className="border-l border-[color:var(--hairline)] bg-[color:var(--petrol-12)] p-4 font-semibold text-[color:var(--petrol)]">
              JobText
            </th>
            <th className="border-l border-[color:var(--hairline)] p-4 font-semibold text-[color:var(--ink)]">
              Podium
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-[color:var(--hairline)] last:border-b-0">
              <th
                scope="row"
                className="p-4 text-left align-top text-[13px] font-medium text-[color:var(--graphite)]"
              >
                {r.label}
              </th>
              <td className="border-l border-[color:var(--hairline)] bg-[color:var(--petrol-12)] p-4 align-top font-medium tabular-nums text-[color:var(--ink)]">
                {r.jobtext}
              </td>
              <td className="border-l border-[color:var(--hairline)] p-4 align-top tabular-nums text-[color:var(--ink-70)]">
                {r.podium}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "Why can't I find Podium's price to compare it here?",
    a: "Because Podium doesn't publish one. Its pricing page routes you to a sales call, so the only Podium dollar figure on this page, around $399 a month to start, comes from third-party reviewers, not from Podium, and we label it that way every time. JobText's price is $29 a month, printed on our pricing page, no call required.",
  },
  {
    q: "I use Podium for reviews and payments. Can JobText replace all of that?",
    a: "No, and we won't pretend it can. Podium manages reviews, runs webchat, and takes payments; JobText does one thing, a shared text inbox your crew answers from any phone. If reviews and payments are load-bearing for you, keep Podium. If the part you actually live in is the texting, that's the part we do for a flat $29.",
  },
  {
    q: "Am I locked into a contract if I switch?",
    a: "Not with us. JobText is month to month, cancel in your billing settings any month, no phone call, no retention gauntlet. Reviewers report Podium runs on annual terms with notice required before renewal, so check your renewal date before you move.",
  },
  {
    q: "Can I keep my current business number?",
    a: "Yes, transfer it to JobText for free. Choose “Bring my number” at signup, give us your current carrier details, and upload a recent bill; we handle the paperwork with the phone companies from there. Transfers cover US and Canadian numbers and typically take about 1 to 7 business days. Your number keeps working on your current carrier the whole time and switches to JobText on the transfer date, texting on it turns on once the transfer completes. Need to text before it lands? Get a new local number now and transfer your old one alongside it.",
  },
  {
    q: "How long until I can text US customers?",
    a: "About a week. US carriers require every business that texts to register first, that's an industry rule, not a Podium-or-JobText rule. We file yours the minute you pay, it usually clears in 3–7 business days, and receiving texts works immediately. In Canada you can text customers the same day.",
  },
  {
    q: "What if JobText turns out to be too simple for us?",
    a: "Then it wasn't the right fit, and you get your money back, full refund of your first invoice, registration fee included, within 30 days, no forms. We'd rather you leave square than stay unhappy. If you find you need calling and reviews in one platform, Podium is a reasonable place to land.",
  },
];

export default function ComparePodiumPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Compare", path: "/compare" },
          { name: "JobText vs Podium", path: PATH },
        ])}
      />

      <CompareHero
        eyebrow="JobText vs Podium"
        title={
          <>
            The price is right on the page, no{" "}
            <Display.Mark>sales call</Display.Mark>.
          </>
        }
        lead="Podium is a capable all-in-one platform for local businesses. AI answering, reviews, payments, webchat. But you can't see what it costs without a sales call, it's sold on an annual term, and reported entry pricing starts around $399 a month. JobText is the opposite bet: a shared text inbox, $29 a month flat, month to month, buy it yourself in minutes. Here's the honest side-by-side, dated July 2026."
        visual={
          <CompareHeroPhoto
            photoId="owner-apron-phone"
            caption="See the price, pay it yourself, and text customers back today, no demo, no annual term, no sales call in the way."
          />
        }
      />

      {/* Comparison table, the sourced, dated grid. */}
      <Section>
        <div className="mx-auto max-w-4xl">
          <Display as="h2" size="h2">
            Side by side, with every source shown.
          </Display>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[color:var(--ink-70)]">
            JobText facts come from our own product and pricing page. Podium
            facts are dated July 2026, from its public pricing page where a
            number exists, and clearly marked as third-party-reported where
            Podium publishes nothing.
          </p>
          <div className="mt-8">
            <ComparisonTable competitorName={COMPETITOR} rows={ROWS} caption />
          </div>
        </div>
      </Section>

      {/* At-a-glance visual, flat vs per-seat (VISUALS §3 compare-page rule). */}
      <AtAGlanceChart
        heading="Flat, whatever your crew size."
        lead="Podium doesn't publish a seat price, but the pattern is the one to watch with any per-user tool: the bill climbs as you hire. JobText stays flat, $29 up to three people, $79 up to ten. Here's that flat line against a typical per-user tool as a crew grows."
      />

      {/* Who each is for, the honest concession. */}
      <WhoEachIsFor
        heading="Who each one is really for."
        jobtextTitle="Reach for JobText if…"
        jobtextBody={
          <>
            <p>
              You run a service crew and the thing you actually need is texting:
              customers text a photo of the problem, whoever&apos;s free answers,
              and nothing falls through the cracks on one person&apos;s phone.
            </p>
            <p>
              You want to see the price, pay it, and start today, without a
              demo, a quote, or a year-long commitment. A flat $29 covers the
              whole crew.
            </p>
          </>
        }
        competitorTitle="Reach for Podium if…"
        competitorBody={
          <>
            <p>
              You want reviews, webchat, and payments living in the same place as
              your messaging, and an AI that answers calls after hours, and
              you&apos;re comfortable running that through a sales relationship.
            </p>
            <p>
              A bigger monthly spend on an annual plan is fine because the
              platform is doing a lot more than texting for you.
            </p>
          </>
        }
      />

      {/* Where Podium may be the better pick, explicit concession. */}
      <BetterPickCallout
        heading="Where Podium may be the better pick."
        intro="We'd rather point you to the right tool than win you and disappoint you. Podium genuinely beats JobText in real ways, and if these are what you need, buy Podium:"
        points={[
          {
            title: "Reviews, payments, and webchat in one platform.",
            body: "JobText doesn't manage Google reviews, run a website chat widget, or take card payments. Podium does all three as core features. If you want one login for messaging, reviews, and getting paid, that's Podium's whole pitch, not ours.",
          },
          {
            title: "An AI that answers calls, not just texts.",
            body: "Podium's AI can pick up the phone and route calls after hours. JobText is texting only, it can't answer your phone. If missed calls are your bigger leak, Podium's calling features are built for exactly that.",
          },
          {
            title: "Deep field-service tooling.",
            body: "Podium's home-services offering adds dispatch boards, a technician app, and job workflows. JobText is a shared inbox, not a field-service management suite. If you need the whole operating system, Podium goes further.",
          },
        ]}
        recommendation={
          <>
            Put plainly: if you want calling, review management, and payments in
            one platform, buy Podium, it does more than we do, and it does those
            things well. If the piece you live in every day is the texting, and
            you&apos;d rather see the price and pay it yourself, that&apos;s the
            trade JobText is built to win.
          </>
        }
      />

      {/* JobText advantages, factual. */}
      <Advantages
        heading="Where JobText wins for a small crew."
        lead="These aren't slogans, they're the concrete differences a two-to-ten-person shop feels in the first week."
        items={[
          {
            title: "The price is on the page.",
            body: "You never book a call to learn what JobText costs. $29 a month, printed, with every other cost listed beside it. Podium's price is a sales conversation.",
          },
          {
            title: "Month to month, not a year.",
            body: "Cancel any month from your settings. There's no annual term to time your exit around, and no notice-before-renewal clause to miss.",
          },
          {
            title: "Flat pricing for the whole crew.",
            body: "$29 covers three people; $79 covers ten. Nobody counts your seats or charges per location. Hire someone and they're in on a link, at no extra cost.",
          },
          {
            title: "Live in minutes, not after onboarding.",
            body: "Pick a number, invite the crew, start texting. There's no implementation call, the product is simple enough that there's nothing to implement.",
          },
          {
            title: "Honest about the wait.",
            body: "We tell you before you pay that US texting turns on in about a week, and that Canadian texting works day one. No surprises hidden behind a demo.",
          },
          {
            title: "A refund if it's not for you.",
            body: "Full refund of your first invoice, registration fee included, within 30 days, no forms, no retention call. We'd rather have your trust than your $29.",
          },
        ]}
      />

      {/* What you'll actually pay, dated, sourced. */}
      <PayMathBlock
        heading="What you'll actually pay."
        lead="A same-shape comparison is impossible here, because Podium doesn't publish a price, so this is JobText's real, printed cost next to the best public information about Podium's, dated July 2026."
        footnote={
          <>
            JobText figures are from our pricing page (SPEC §1–2). Podium
            publishes no prices on podium.com/pricing (re-verified 2026-07-02);
            the ~$399/mo Core figure and annual-term note come from third-party
            reviewers, not from Podium, and are labeled as reported throughout. If
            Podium publishes official pricing, we&apos;ll update this page.
          </>
        }
      >
        <PodiumCostStack />
      </PayMathBlock>

      {/* Switching is easy, honest bring-your-number. */}
      <SwitchingNote
        heading="Switching from Podium is low-drama."
        body={
          <>
            <p>
              You don&apos;t have to rip anything out on day one. Sign up for
              JobText, pick your local number, and invite the crew, that part
              takes minutes. Keep Podium running while you move your texting over,
              and cancel it when you&apos;re ready (mind its renewal date, since
              reviewers report an annual term).
            </p>
            <p>
              <strong className="font-semibold text-[color:var(--ink)]">
                About your number:
              </strong>{" "}
              you can transfer your existing US or Canadian number into JobText
              for free, choose &ldquo;Bring my number&rdquo; at signup, share
              your current carrier details, and upload a recent bill; we handle
              the paperwork. A transfer typically takes about 1 to 7 business
              days, and your number keeps working on your current carrier the
              whole time, it switches to JobText on the transfer date, and
              texting on it turns on once the transfer completes. Prefer to start
              texting today? Get a new local number now and transfer your old one
              alongside it.
            </p>
          </>
        }
      />

      {/* Internal links, feature + trade pages (SEO: compare pages were flagged
          for thin internal linking). */}
      <CompareRelatedLinks
        heading="Not sure Podium's breadth is what you need?"
        intro="If the part you actually live in is the texting, here's what JobText does with it, and a couple of trades where a shared inbox earns its keep."
        links={[
          {
            label: "The shared inbox",
            href: "/features/shared-inbox",
            hint: "Assign, status, note, tag, search, and mark texts done, one inbox the whole crew sees.",
          },
          {
            label: "Compliance built in",
            href: "/features/compliance",
            hint: "Registration, opt-outs, and consent handled, without a sales call or annual contract.",
          },
          {
            label: "Texting for plumbers",
            href: "/for/plumbers",
            hint: "Photo triage and on-my-way texts in one shared inbox, flat $29/mo.",
          },
          {
            label: "Texting for HVAC",
            href: "/for/hvac",
            hint: "Triage the cold-snap surge across the whole crew, no per-seat bill.",
          },
        ]}
      />

      <CompareFaq heading="Switching questions, answered." faqs={FAQS} />

      <CompareCta
        heading="See the price. Pay. Text today."
        sub="No demo, no sales phone number, no annual contract standing between you and a working number. $29 a month, month to month, with a 30-day refund if it's not for you."
      />
    </>
  );
}
