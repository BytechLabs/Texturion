/**
 * /compare/quo — JobText vs Quo (formerly OpenPhone) (BLUEPRINT §5–6).
 *
 * The per-user foil. Quo is a full business PHONE system — calling included —
 * aimed at a broad VoIP / developer / SMB audience. JobText is SMS-only and
 * Canada-first for service trades. The load-bearing honesty here (§6): concede
 * Quo's calling, maturity, and reviews OUTRIGHT — JobText cannot make a call —
 * and NEVER claim "500 texts included" for Quo (its texting is metered at
 * $0.01/segment; claiming otherwise is a false competitor claim, the exact
 * exposure the blueprint's panel flagged).
 *
 * Every Quo claim is dated "as of July 2026" and traces to
 * docs/marketing/competitor-site-teardowns.md and a live fetch of
 * quo.com/pricing (re-verified 2026-07-02: Starter $15 annual / $19 monthly,
 * Business $23/$33, Scale $35/$47 per user; 7-day trial; extra numbers $5/mo;
 * automated SMS $0.01/segment; $19.50 one-time TCR + $1.50–$3/mo carrier
 * maintenance; US/Canada calling included). No fabricated stats, no
 * aggregateRating.
 *
 * JSON-LD: buildMetadata + BreadcrumbList only. Fully static (§11.4). Zero
 * sentences shared with the Podium/Heymarket pages (§6).
 */

import type { Metadata } from "next";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { Section } from "@/components/marketing/ui/section";
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
import { cn } from "@/lib/utils";

const PATH = "/compare/quo";
const COMPETITOR = "Quo";

export const metadata: Metadata = buildMetadata({
  title: "JobText vs Quo: pricing & honest differences (2026)",
  description:
    "A fair, dated comparison: JobText is $29/mo flat and SMS-only; Quo (formerly OpenPhone) is a per-user phone system with texting metered separately.",
  path: PATH,
});

/* -------------------------------------------------------------------------- */
/* Comparison table — every cell dated + sourced (§6, §13.7).                  */
/* NOTE: Quo's texting cell states its REAL metered terms — never "included".  */
/* -------------------------------------------------------------------------- */

const ROWS: ComparisonRow[] = [
  {
    label: "What it is",
    jobtext: {
      value: "A shared SMS inbox — texting only",
      note: "Reply, assign, tag, note, search, close (SPEC §1).",
    },
    competitor: {
      value: "A full business phone system — calling + texting",
      emphasis: true,
      note: 'Quo home page: "shared business phone and inbox" for every call and text.',
    },
  },
  {
    label: "Base price",
    jobtext: {
      value: "$29/mo flat (3 people) · $79/mo (10 people)",
      emphasis: true,
      note: "One price for the whole crew, not per seat (SPEC §2).",
    },
    competitor: {
      value: "$15/user (annual) or $19/user (monthly), Starter",
      note: "Pricing page: Starter $15 annual / $19 monthly; Business $23/$33; Scale $35/$47, all per user.",
    },
  },
  {
    label: "Voice calling",
    jobtext: {
      value: "Not included — JobText can't make calls",
      note: "We're a text inbox. If you need to call customers, this is a real gap.",
    },
    competitor: {
      value: "Unlimited US/Canada calling included",
      emphasis: true,
      note: "Pricing page: calling to US and Canadian numbers included on every tier (fair-use).",
    },
  },
  {
    label: "How texts are priced",
    jobtext: {
      value: "Included — 500 on Starter, 2,500 on Pro",
      emphasis: true,
      note: "A texting allowance ships with each plan; inbound is always free.",
    },
    competitor: {
      value: "Metered — automated SMS $0.01 per outgoing segment",
      note: "Pricing page: texting is not a bundled allowance; automated SMS is billed per segment.",
    },
  },
  {
    label: "Extra phone numbers",
    jobtext: {
      value: "2nd number included on Pro",
      emphasis: true,
      note: "Pro gives two numbers (two locations, or office + field) at no add-on.",
    },
    competitor: {
      value: "$5/mo each",
      note: "Pricing page: additional phone numbers are $5/month each.",
    },
  },
  {
    label: "Bring your existing number",
    jobtext: {
      value: "Free number transfer (US/CA), ~1–7 business days",
      note: "Choose “Bring my number” at signup; we handle the carrier paperwork. Your number keeps working until it switches over (docs/PORTING.md).",
    },
    competitor: {
      value: "Free number porting",
      emphasis: true,
      note: "Pricing/support pages: Quo ports existing US/Canada numbers in at no charge. A wash between us.",
    },
  },
  {
    label: "Carrier registration fee",
    jobtext: {
      value: "$29 one time, ever",
      note: "Canadian-only texting never pays it; charged once even if you leave and return (SPEC §4.1).",
    },
    competitor: {
      value: "$19.50 one-time + $1.50–$3/mo maintenance",
      note: "Pricing page: $19.50 one-time Campaign Registry review + $1.50–$3/mo carrier maintenance.",
    },
  },
  {
    label: "Canada",
    jobtext: {
      value: "Canada-first — text Canadian customers the same day",
      emphasis: true,
      note: "No US carrier registration for CA→CA texting (SPEC §4.1). CASL-aware.",
    },
    competitor: {
      value: "Supported, but not the focus",
      note: "Quo serves a broad US-centric VoIP/developer audience; Canada isn't its positioning.",
    },
  },
];

/* -------------------------------------------------------------------------- */
/* "What you'll actually pay" — per-user vs flat, dated.                       */
/* -------------------------------------------------------------------------- */

function QuoCostStack() {
  const rows: { label: string; jobtext: string; quo: string }[] = [
    {
      label: "6-person crew, software",
      jobtext: "$79 flat (Pro covers 10)",
      quo: "$19/user × 6 = $114/mo (monthly billing)",
    },
    {
      label: "A second number",
      jobtext: "Included on Pro",
      quo: "+$5/mo",
    },
    {
      label: "Texting",
      jobtext: "2,500 included",
      quo: "Metered at 1¢/segment — depends on volume",
    },
    {
      label: "Monthly total",
      jobtext: "$79",
      quo: "≈ $119/mo + texting",
    },
  ];
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[560px] border-collapse text-left text-[14px]">
        <thead>
          <tr className="border-b border-border">
            <th className="p-4 text-[13px] font-medium text-muted-foreground" />
            <th className="border-l border-border bg-primary/5 p-4 font-semibold text-primary">
              JobText Pro
            </th>
            <th className="border-l border-border p-4 font-semibold text-foreground">
              Quo Starter
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
                  {r.quo}
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
    q: "Does JobText make phone calls like Quo does?",
    a: "No — and this is the honest headline of this whole comparison. Quo is a full business phone system: it makes and receives calls, and unlimited US/Canada calling is included on every plan. JobText can't call anyone; it's a shared text inbox. If your business lives on the phone, Quo is genuinely the better tool and we'll say so.",
  },
  {
    q: "Isn't Quo cheaper at $15 a user?",
    a: "It depends on your crew size, and on texting. Quo's Starter is $15 a user on annual billing, $19 monthly — for a 6-person crew that's $90 to $114 a month, plus $5 for a second number, plus texting metered at 1¢ a segment. JobText Pro is $79 flat for up to 10 people with a second number and 2,500 texts included. For a solo operator who mostly calls, Quo can be cheaper; for a texting crew, JobText's flat price usually wins.",
  },
  {
    q: "Why don't you show Quo as \"500 texts included\" in the table?",
    a: "Because it wouldn't be true, and we won't print a competitor number we can't stand behind. Quo doesn't bundle a texting allowance the way JobText does — its automated SMS is metered at 1¢ per segment. We show Quo's real terms, not a made-up allowance, on every row.",
  },
  {
    q: "Quo discloses its fees really clearly. Does JobText?",
    a: "Quo sets a high bar here, and credit where it's due — it lists its $19.50 one-time registration and $1.50–$3/month carrier maintenance right on the pricing page, and even reminds you before a trial ends. We aim to match and beat that: one $29 registration fee, charged once ever, with no recurring carrier line item at all, and Canadian texting that skips registration entirely. Same honesty, simpler math.",
  },
  {
    q: "How fast can I text customers on each?",
    a: "For US texting, both of us wait on the same carrier registration — it's an industry rule, not a product choice, and it usually takes 3–7 business days. The difference is Canada: JobText is built Canada-first, so Canadian crews text Canadian customers the same day they sign up, with no US registration. We file your US registration the minute you pay and email you when it clears.",
  },
  {
    q: "Can I bring my number over from Quo?",
    a: "Yes — you can transfer your existing US or Canadian number into JobText for free. At signup choose “Bring my number,” give us your current carrier details, and upload a recent bill; we handle the paperwork from there. A transfer typically takes about 1 to 7 business days, and your number keeps working on your current carrier until it switches over to JobText — texting on it turns on once the transfer completes. Quo offers free porting too, so number transfer is a wash between the two; the real deciders here are calling (Quo has it, we don't) and price (flat vs per user).",
  },
];

export default function CompareQuoPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Compare", path: "/compare" },
          { name: "JobText vs Quo", path: PATH },
        ])}
      />

      <CompareHero
        eyebrow="JobText vs Quo"
        title="JobText vs Quo: a text inbox vs a full phone system."
        lead="Quo (formerly OpenPhone) is a mature per-user business phone system — calling included, broad audience, genuinely polished. JobText is narrower on purpose: a shared SMS inbox, Canada-first, flat $29 a month for service crews. The biggest honest difference up top — JobText can't make calls, and Quo can. Here's the fair, dated side-by-side, July 2026."
        visual={
          <CompareHeroPhoto
            photoId="owner-counter-phone"
            caption="For a crew whose customers text more than they call, a shared text inbox does the whole job — no per-seat phone system required."
          />
        }
      />

      <Section>
        <div className="mx-auto max-w-4xl">
          <h2 className="display-h2 text-foreground">
            Side by side — including where Quo wins.
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            JobText facts come from our own product and pricing. Every Quo figure
            is dated July 2026 and cites the exact line from its public pricing
            page — and we never dress up Quo&apos;s metered texting as an
            included allowance, because it isn&apos;t.
          </p>
          <div className="mt-8">
            <ComparisonTable competitorName={COMPETITOR} rows={ROWS} caption />
          </div>
        </div>
      </Section>

      {/* At-a-glance visual — flat vs per-seat. The chart's per-user line IS Quo's
          published $19/user/mo (July 2026), so this page owns the sourced math. */}
      <AtAGlanceChart
        heading="Flat vs. per user, as the crew grows."
        lead="Quo's Starter is $19/user a month on monthly billing. JobText is flat — $29 up to three people, $79 up to ten. For a solo operator Quo can be cheaper; the more you hire, the more the per-user line climbs while JobText holds. The figures below are Quo's published seat price, July 2026."
      />

      <WhoEachIsFor
        heading="Who each one is really for."
        jobtextTitle="Reach for JobText if…"
        jobtextBody={
          <>
            <p>
              You&apos;re a US or Canadian service crew whose customers text more
              than they call, and you want those texts in one shared inbox at a
              flat price — not a per-user bill that grows with every hire.
            </p>
            <p>
              You&apos;re in Canada and want to text customers the same day, or
              you value texting being included instead of metered per message.
            </p>
          </>
        }
        competitorTitle="Reach for Quo if…"
        competitorBody={
          <>
            <p>
              You need to make and take phone calls — Quo is a real phone system
              with unlimited US/Canada calling, call routing, and voicemail.
              That&apos;s the core of what it does and it does it well.
            </p>
            <p>
              You want a broader, more mature platform with an AI voice agent,
              analytics, and a large integration and app ecosystem, and per-user
              pricing suits how you buy.
            </p>
          </>
        }
      />

      <BetterPickCallout
        heading="Where Quo may be the better pick."
        intro="Quo is a strong product and it beats JobText outright in several places. These aren't hedges — if any of them matter to you, buy Quo, you'll be better served."
        points={[
          {
            title: "It makes phone calls. We don't.",
            body: "This is the big one. Quo is a full phone system — calling to US and Canadian numbers is included on every plan. JobText is texting only and cannot place or receive a call. If a real phone line is a requirement, JobText is simply the wrong tool and Quo is the right one.",
          },
          {
            title: "It's more mature, with a bigger ecosystem.",
            body: "Quo (as OpenPhone) has years of shipping behind it, a large integration catalog, an AI voice agent, and calling analytics. JobText is young and deliberately small. If you want breadth and a proven track record, Quo has more of both.",
          },
          {
            title: "Best-in-class fee transparency.",
            body: "Quo lists its registration and carrier fees plainly, right on the pricing page, and even reminds you before a trial ends. We aim to match that, but Quo sets the bar for putting every dollar in writing up front. (Free number porting isn't a difference here — both of us transfer your existing number in for free.)",
          },
        ]}
        recommendation={
          <>
            Said plainly: if you need to call customers or want a mature
            all-round phone platform, buy Quo — it genuinely does more than we
            do. JobText is the better pick when texting is the whole job, you
            want it included at a flat price, and especially if you&apos;re a
            Canadian crew that wants to start today. Bringing your existing
            number over is free either way, so let calling and price decide it.
          </>
        }
      />

      <Advantages
        heading="Where JobText wins for a texting crew."
        lead="Against a per-user phone system, JobText's edge is narrow and specific: flat pricing, texting included, and a Canada-first head start."
        items={[
          {
            title: "Flat price beats per-user as you grow.",
            body: "$79 covers up to ten people on Pro. On Quo at $19/user monthly, ten seats is $190 before texts or extra numbers. The more the crew grows, the wider that gap opens.",
          },
          {
            title: "Texting is included, not metered.",
            body: "500 texts on Starter, 2,500 on Pro, receiving always free. Quo meters automated SMS at 1¢ a segment, so a texting-heavy month is an open-ended line item there.",
          },
          {
            title: "A second number without the add-on.",
            body: "Pro includes two numbers — a second location, or an office and a field line — at no extra charge. Quo bills $5 a month for each additional number.",
          },
          {
            title: "Canada-first, text the same day.",
            body: "Canadian crews text Canadian customers the day they sign up, no US registration in the way. For a Canadian shop, that's a head start Quo doesn't position around.",
          },
          {
            title: "Fee honesty that matches Quo and simplifies it.",
            body: "One $29 registration fee, charged once ever, no recurring carrier maintenance line — versus Quo's $19.50 one-time plus $1.50–$3 every month. Both are honest; ours is simpler.",
          },
          {
            title: "Refund if it's not for you.",
            body: "Full refund of your first invoice, registration fee included, within 30 days, no forms. A clean way to find out whether an SMS-only inbox is enough for your crew.",
          },
        ]}
      />

      <PayMathBlock
        heading="What a 6-person crew actually pays."
        lead="A texting crew of six, at published prices as of July 2026. Quo's software cost is real and dated; its texting is metered, so the true Quo total depends on how much you send — which is exactly why we don't print a single tidy number for it."
        footnote={
          <>
            JobText&apos;s figures reflect our own published Starter and Pro
            plans (SPEC §1–2). Quo figures are from quo.com/pricing, re-verified
            2026-07-02: Starter $15/user/mo
            (annual) or $19/user/mo (monthly), additional numbers $5/mo, automated
            SMS $0.01/segment, and calling included. The ~$119 Quo total uses
            monthly billing ($19 × 6) plus one extra number and excludes texting,
            which Quo meters separately. One-time registration fees are excluded
            from both totals (JobText&apos;s is $29; Quo discloses $19.50). If any
            figure changes, tell us and we&apos;ll correct it.
          </>
        }
      >
        <QuoCostStack />
      </PayMathBlock>

      <SwitchingNote
        heading="Trying JobText next to Quo is easy."
        body={
          <>
            <p>
              Because JobText is month to month and self-serve, you can stand it
              up beside Quo in minutes — pick a number, add the crew, move your
              texting over, and decide with real usage in front of you. Keep Quo
              for calling as long as you want; nothing forces an all-or-nothing
              switch.
            </p>
            <p>
              <strong className="font-semibold text-foreground">
                On keeping your number:
              </strong>{" "}
              you can transfer your existing US or Canadian number into JobText
              for free — choose &ldquo;Bring my number&rdquo; at signup, share
              your current carrier details, and upload a recent bill; we handle
              the paperwork. A transfer typically takes about 1 to 7 business
              days, and your number keeps working on your current carrier until
              it switches over — texting on it turns on once the transfer
              completes. Quo ports for free too, so number transfer isn&apos;t
              the deciding factor between us; calling and price are.
            </p>
          </>
        }
      />

      {/* Internal links — feature + trade pages (SEO: thin-internal-linking fix). */}
      <CompareRelatedLinks
        heading="What JobText does with texting — in depth."
        intro="Quo is a phone system; JobText is a texting inbox. If texting is the part that matters, here's what it looks like — and where a second number and a Canada-first head start earn their keep."
        links={[
          {
            label: "Your business number",
            href: "/features/business-number",
            hint: "Two numbers on Pro at no add-on, next to Quo's $5/mo per extra number.",
          },
          {
            label: "JobText in Canada",
            href: "/canada",
            hint: "Canadian crews text customers the same day — no US registration wait.",
          },
          {
            label: "Texting for landscapers",
            href: "/for/landscapers",
            hint: "Quote from a photo and dispatch the nearest crew, all from one inbox.",
          },
          {
            label: "Texting for contractors",
            href: "/for/contractors",
            hint: "Every message a task the crew works and checks off, off your personal cell.",
          },
        ]}
      />

      <CompareFaq heading="Switching questions, answered." faqs={FAQS} />

      <CompareCta
        heading="If texting is the job, this is the tool."
        sub="A shared text inbox, texting included, Canada-first, $29 a month flat for the whole crew. If you need calling too, keep Quo — we'll be the honest ones and tell you that. Otherwise, month to month with a 30-day refund."
      />
    </>
  );
}
