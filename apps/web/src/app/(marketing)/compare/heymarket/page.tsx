/**
 * /compare/heymarket — JobText vs Heymarket (BLUEPRINT §5–6).
 *
 * The flat-team-price page: JobText's one flat price vs Heymarket's per-user
 * seats with a 2-user minimum, messages billed separately on top of seats, and
 * a $10/mo-per-campaign carrier fee. Heymarket is a genuine, enterprise-grade
 * shared inbox with SOC 2, HIPAA/BAA, email, and deep CRM integrations — we
 * concede that outright (§6); the honest read is "different buyer."
 *
 * Every Heymarket claim is dated "as of July 2026" and traces to
 * docs/marketing/competitor-site-teardowns.md and a live fetch of
 * heymarket.com/pricing (re-verified 2026-07-02: $49/$99/$199 per user, 2-user
 * minimum, $0.03/segment, $10/mo/campaign 10DLC, "Book a free demo" CTAs, up to
 * 18% annual). The all-in math for a 3-person crew sending 500 single-segment
 * texts states its single-segment assumption in the cell (§6, segment-unit
 * finding). No fabricated stats, no aggregateRating.
 *
 * JSON-LD: buildMetadata + BreadcrumbList only. Fully static (§11.4). Zero
 * sentences shared with the Podium/Quo pages (§6).
 */

import type { Metadata } from "next";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { Section } from "@/components/marketing/ui/section";
import {
  Advantages,
  BetterPickCallout,
  CompareCta,
  CompareFaq,
  CompareHero,
  PayMathBlock,
  SwitchingNote,
  WhoEachIsFor,
} from "@/components/marketing/compare/compare-sections";
import {
  ComparisonTable,
  type ComparisonRow,
} from "@/components/marketing/compare/comparison-table";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";
import { cn } from "@/lib/utils";

const PATH = "/compare/heymarket";
const COMPETITOR = "Heymarket";

export const metadata: Metadata = buildMetadata({
  title: "JobText vs Heymarket: pricing & honest differences (2026)",
  description:
    "A fair, dated comparison: JobText is $29/mo flat for the whole crew; Heymarket is $49/user (2-user minimum) with texts billed separately at 3¢/segment plus a $10/mo carrier fee. Where each fits, and how to switch.",
  path: PATH,
});

/* -------------------------------------------------------------------------- */
/* Comparison table — every cell dated + sourced (§6, §13.7).                  */
/* -------------------------------------------------------------------------- */

const ROWS: ComparisonRow[] = [
  {
    label: "Base price",
    jobtext: {
      value: "$29/mo flat (3 people) · $79/mo (10 people)",
      emphasis: true,
      note: "Whole team, one price. Not per seat (SPEC §2).",
    },
    competitor: {
      value: "$49/user/mo (Standard), 2-user minimum",
      note: "Pricing page (annual): Standard $49, Plus $99, Pro $199 per user; minimum 2 users. So the floor is $98/mo.",
    },
  },
  {
    label: "How texts are priced",
    jobtext: {
      value: "Included — 500 on Starter, 2,500 on Pro",
      emphasis: true,
      note: "Outgoing texts are in the plan; receiving is free and unlimited.",
    },
    competitor: {
      value: "Billed separately at $0.03 per segment",
      note: "Pricing page: SMS/MMS is $0.03/message segment on top of the per-user seat cost.",
    },
  },
  {
    label: "Carrier / 10DLC fee",
    jobtext: {
      value: "$29 one time, ever",
      note: "One-time US registration fee; Canadian-only texting never pays it (SPEC §4.1).",
    },
    competitor: {
      value: "$10 per month, per campaign",
      note: 'Pricing page: "$10 per month per campaign" covering 10DLC registration and compliance — a recurring charge, not one-time.',
    },
  },
  {
    label: "How you buy",
    jobtext: {
      value: "Self-serve — sign up and pay online",
      emphasis: true,
      note: "No demo required (SPEC §1).",
    },
    competitor: {
      value: 'Prices listed, but every paid tier CTA is "Book a free demo"',
      note: "Pricing page routes the buy path to sales even though the numbers are shown.",
    },
  },
  {
    label: "Contract",
    jobtext: {
      value: "Month to month",
      emphasis: true,
      note: "Cancel anytime in billing settings.",
    },
    competitor: {
      value: "Annual pricing headline (up to 18% off)",
      note: 'Pricing page: annual billing "Save up to 18%," described as two months free spread across the year.',
    },
  },
  {
    label: "Email channel",
    jobtext: {
      value: "Not included — texting only",
      note: "JobText is a shared SMS inbox; no email inbox.",
    },
    competitor: {
      value: "Included (email at $0.0025/segment)",
      emphasis: true,
      note: "Heymarket added shared email; outbound email is billed per segment too.",
    },
  },
  {
    label: "Enterprise compliance",
    jobtext: {
      value: "Encryption + tenant isolation + US residency, stated plainly",
      note: "No SOC 2 or HIPAA/BAA claims — we don't hold them yet (SPEC §10).",
    },
    competitor: {
      value: "SOC 2 Type 2, TCPA, HIPAA (BAA available)",
      emphasis: true,
      note: "Compliance badges on Heymarket's site; a real advantage for regulated buyers.",
    },
  },
];

/* -------------------------------------------------------------------------- */
/* "What you'll actually pay" — the all-in math, single-segment stated.        */
/* -------------------------------------------------------------------------- */

function HeymarketCostStack() {
  const rows: { label: string; jobtext: string; heymarket: string }[] = [
    {
      label: "Seats (3 people)",
      jobtext: "$29 flat — covers 3",
      heymarket: "$49/user × 3 = $147",
    },
    {
      label: "500 texts a month",
      jobtext: "Included",
      heymarket: "~$15 (3¢/segment × 500, single-segment)",
    },
    {
      label: "Carrier / 10DLC fee",
      jobtext: "$0/mo (one-time $29)",
      heymarket: "$10/mo per campaign",
    },
    {
      label: "Monthly total",
      jobtext: "$29",
      heymarket: "≈ $172/mo",
    },
  ];
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[560px] border-collapse text-left text-[14px]">
        <thead>
          <tr className="border-b border-border">
            <th className="p-4 text-[13px] font-medium text-muted-foreground" />
            <th className="border-l border-border bg-primary/5 p-4 font-semibold text-primary">
              JobText Starter
            </th>
            <th className="border-l border-border p-4 font-semibold text-foreground">
              Heymarket Standard
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isTotal = r.label === "Monthly total";
            return (
              <tr
                key={r.label}
                className={cn(
                  "border-b border-border last:border-b-0",
                  isTotal && "bg-secondary/20",
                )}
              >
                <th
                  scope="row"
                  className={cn(
                    "p-4 text-left align-top text-[13px] font-medium text-muted-foreground",
                    isTotal && "font-semibold text-foreground",
                  )}
                >
                  {r.label}
                </th>
                <td className="border-l border-border bg-primary/5 p-4 align-top font-semibold tabular-nums text-foreground">
                  {r.jobtext}
                </td>
                <td
                  className={cn(
                    "border-l border-border p-4 align-top tabular-nums text-muted-foreground",
                    isTotal && "font-semibold text-foreground",
                  )}
                >
                  {r.heymarket}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "Why is JobText so much cheaper for a small crew?",
    a: "Because we don't charge per seat, we include your texts, and we don't add a monthly carrier line item. Heymarket's model is per user (2-user minimum), plus 3¢ a segment for texts, plus $10 a month per campaign. For a 3-person shop sending 500 texts that stacks up to roughly $172 a month; on JobText the same crew is $29. If you're a large team where seats are the smaller part of the bill, that gap narrows.",
  },
  {
    q: "Does Heymarket really route you to a demo even though prices are listed?",
    a: "As of July 2026, yes — the per-user prices are printed on Heymarket's pricing page, but the button on every paid tier says \"Book a free demo\" rather than sign up. JobText skips that step: the price is on the page and the button starts your account. If a guided demo is something you actively want, that's a point for Heymarket, not against it.",
  },
  {
    q: "We might need email and SMS in one inbox. Can JobText do that?",
    a: "No — JobText is a shared SMS inbox, texting only. Heymarket added a shared email channel (billed per segment), so if a unified text-and-email inbox is a requirement, Heymarket fits that better and we'd tell you to use it. If texting is the whole job, JobText does that one thing for a flat price.",
  },
  {
    q: "Is Heymarket more secure than JobText?",
    a: "On paper, today, in the ways auditors measure: Heymarket publishes SOC 2 Type 2 and offers a HIPAA BAA; JobText doesn't hold those certifications yet, and we won't claim badges we don't have. What we do state plainly and can prove: data encrypted in transit and at rest, tenant isolation, US data residency, and no message content in our analytics or error logs. For a regulated healthcare buyer, Heymarket's certifications are a real edge.",
  },
  {
    q: "How long until I can text US customers on JobText?",
    a: "About a week. Every business that texts US numbers has to register with the carriers first — Heymarket handles that with its $10/mo campaign fee, we handle it with a one-time $29 fee. We file yours the minute you pay; approval usually lands in 3–7 business days, and receiving texts works right away. Canadian texting is same-day.",
  },
  {
    q: "Can I bring my existing number over?",
    a: "Not by porting yet — that's on our roadmap, and we won't pretend it ships before it does. In the meantime you forward your current number to your new JobText number (your carrier turns on call-forwarding in a couple of minutes) and move customers to the JobText number on new signs and quotes. Your old number keeps working; new texts arrive in JobText for the whole crew.",
  },
];

export default function CompareHeymarketPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Compare", path: "/pricing" },
          { name: "JobText vs Heymarket", path: PATH },
        ])}
      />

      <CompareHero
        eyebrow="JobText vs Heymarket"
        title="JobText vs Heymarket: one flat price vs per-seat plus extras."
        lead="Heymarket is a polished, enterprise-grade shared inbox with SOC 2, a HIPAA BAA, email, and deep CRM integrations — genuinely strong if that's your world. But it's priced per user with a two-seat minimum, texts are billed separately at 3¢ a segment, and there's a $10-a-month carrier fee on top. JobText is $29 a month flat, texts included. Here's the fair, dated comparison, July 2026."
      />

      <Section>
        <div className="mx-auto max-w-4xl">
          <h2 className="display-h2 text-foreground">
            Side by side, with the sources in the cells.
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            JobText facts are from our own product and pricing. Every Heymarket
            figure is dated July 2026 and cites the exact line item from its
            public pricing page — including the parts that count in Heymarket&apos;s
            favor.
          </p>
          <div className="mt-8">
            <ComparisonTable competitorName={COMPETITOR} rows={ROWS} caption />
          </div>
        </div>
      </Section>

      <WhoEachIsFor
        heading="Who each one is really for."
        jobtextTitle="Reach for JobText if…"
        jobtextBody={
          <>
            <p>
              You&apos;re a small service crew where a per-user bill and a
              separate per-text charge would add up faster than the value.
              You&apos;d rather one flat number cover everyone and your texts
              come included.
            </p>
            <p>
              You want to sign up and pay online today, month to month, without
              booking a demo to get started.
            </p>
          </>
        }
        competitorTitle="Reach for Heymarket if…"
        competitorBody={
          <>
            <p>
              You&apos;re a larger or regulated team that needs SOC 2, a HIPAA
              BAA, a unified text-and-email inbox, and deep Salesforce or HubSpot
              integrations — and per-user pricing is normal for how you buy
              software.
            </p>
            <p>
              A guided demo and an annual plan are how you prefer to roll out a
              tool across a bigger org.
            </p>
          </>
        }
      />

      <BetterPickCallout
        heading="Where Heymarket may be the better pick."
        intro="Heymarket is a serious product, and it beats JobText in concrete ways. If any of these are on your must-have list, buy Heymarket — you'll be happier."
        points={[
          {
            title: "Enterprise compliance you can hand to an auditor.",
            body: "Heymarket publishes SOC 2 Type 2 and offers a HIPAA BAA. JobText doesn't hold those certifications yet and won't claim them. For healthcare or security-reviewed procurement, that's a real, disqualifying gap on our side.",
          },
          {
            title: "Text and email in one shared inbox.",
            body: "Heymarket handles both channels together. JobText is SMS only. If your team needs to work email and texts from a single place, Heymarket does something we simply don't.",
          },
          {
            title: "Deep CRM integrations and automations.",
            body: "Heymarket integrates tightly with Salesforce and HubSpot and offers list broadcasts, campaigns, and AI-assisted flows. JobText keeps a deliberately small surface. If your workflow lives inside a CRM, Heymarket meets it where it is.",
          },
        ]}
        recommendation={
          <>
            Straight up: if you need SOC 2, a HIPAA BAA, a text-and-email inbox,
            or CRM-deep automations, buy Heymarket — it&apos;s built for that and
            does it well. If you&apos;re a small crew who just wants texting to
            land in one place at one flat price, that&apos;s where JobText is the
            better-value call.
          </>
        }
      />

      <Advantages
        heading="Where JobText wins for a small crew."
        lead="For a two-to-ten-person shop, the pricing model is the whole story — and it runs the other way from Heymarket's."
        items={[
          {
            title: "One flat price, no seat counting.",
            body: "$29 covers three people, $79 covers ten. Heymarket charges per user with a two-seat floor, so its entry point is $98/mo before a single text is sent.",
          },
          {
            title: "Texts are included, not metered on top.",
            body: "500 texts are in Starter, 2,500 in Pro, and receiving is always free. Heymarket bills SMS separately at 3¢ a segment on top of the seat cost.",
          },
          {
            title: "No monthly carrier line item.",
            body: "We charge one $29 registration fee, once ever. Heymarket's carrier compliance is $10 a month per campaign — a recurring charge that never goes away.",
          },
          {
            title: "The buy button actually buys.",
            body: "Sign up and pay online in minutes. Heymarket lists its prices but sends every paid tier to \"Book a free demo\" first.",
          },
          {
            title: "Month to month, no annual headline.",
            body: "Cancel any month. Heymarket's pricing leads with annual billing; month-to-month, if offered, isn't the advertised deal.",
          },
          {
            title: "Refund if it's not for you.",
            body: "Full refund of your first invoice, registration fee included, within 30 days — no forms, no clawback for texts you sent.",
          },
        ]}
      />

      <PayMathBlock
        heading="What a 3-person crew actually pays."
        lead="Same crew, same 500 texts a month, at published prices as of July 2026. Heymarket's total assumes each text is a single 160-character segment — longer texts count as more, so real Heymarket bills can run higher, not lower."
        footnote={
          <>
            JobText&apos;s numbers come straight from our published plans (SPEC
            §1–2). Heymarket figures are from heymarket.com/pricing, re-verified
            2026-07-02:
            Standard $49/user/mo (annual) with a 2-user minimum, SMS/MMS
            $0.03/segment, and a $10/mo-per-campaign 10DLC fee. The ~$172 total
            assumes 3 seats, 500 single-segment texts, and one campaign; texts
            over 160 characters count as multiple segments and cost more.
            One-time registration fees are excluded from both totals (JobText&apos;s
            is $29). If any figure changes, tell us and we&apos;ll correct it.
          </>
        }
      >
        <HeymarketCostStack />
      </PayMathBlock>

      <SwitchingNote
        heading="Moving from Heymarket is painless."
        body={
          <>
            <p>
              Start JobText alongside Heymarket — sign up, choose your local
              number, and add the crew in minutes. Run both while you shift your
              texting over, then cancel Heymarket once your conversations live in
              JobText. Because we&apos;re month to month, there&apos;s no exit
              window on our side to plan around.
            </p>
            <p>
              <strong className="font-semibold text-foreground">
                On keeping your number:
              </strong>{" "}
              we can&apos;t port an existing number into JobText yet — porting is
              on the roadmap and we won&apos;t say otherwise. The honest
              workaround that works today: forward your current number to your new
              JobText number (call-forwarding takes a couple of minutes with your
              carrier) and start advertising the JobText number. Old number keeps
              ringing; new texts come to JobText, where the whole crew sees them.
            </p>
          </>
        }
      />

      <CompareFaq heading="Switching questions, answered." faqs={FAQS} />

      <CompareCta
        heading="One flat price, texts included, no demo."
        sub="$29 a month covers the whole crew and your texts — no per-seat bill, no per-segment meter, no monthly carrier line item. Month to month, with a 30-day refund if it's not for you."
      />
    </>
  );
}
