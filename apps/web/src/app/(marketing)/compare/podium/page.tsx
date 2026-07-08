/**
 * /compare/podium, v4 "FIRST RESPONSE" (DESIGN-DIRECTION §6 COMPARE template;
 * COPY-DECK v2). Dateline Header (the arithmetic: their total is a sales
 * call) → Honesty Ledger centerpiece where the Podium column literally reads
 * "Not published" per row (page-data.ts; the visible price IS the argument) →
 * slider chart → the honest bundle concession (reviews, payments, AI
 * answering are real capabilities we don't have) → switching Truth Strip →
 * CTA. We print no reported/estimated Podium dollar figure anywhere (Law 7).
 *
 * JSON-LD: buildMetadata + BreadcrumbList only. Fully static. No em-dashes
 * anywhere in rendered text (Law 6).
 */

import type { Metadata } from "next";

import {
  CompareCta,
  CompareHero,
  HonestFit,
  LedgerBand,
  SliderBand,
  SwitchBand,
} from "@/components/marketing/compare/compare-sections";
import { LedgerTable } from "@/components/marketing/compare/ledger-table";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";
import { LIVE_ROUTES } from "@/lib/marketing/site";

import { PODIUM_COLUMNS, PODIUM_FOOTNOTE, PODIUM_ROWS } from "./page-data";

const PATH = LIVE_ROUTES.comparePodium;

export const metadata: Metadata = buildMetadata({
  title: "Loonext vs Podium: a price you can read",
  description:
    "A dated, sourced comparison. Loonext is $29/mo flat, printed on the page, self-serve. Podium publishes no prices: its pricing page routes to a sales team. Where Podium's all-in-one platform genuinely fits better, we say so.",
  path: PATH,
});

export default function ComparePodiumPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Compare", path: LIVE_ROUTES.compareIndex },
          { name: "Loonext vs Podium", path: PATH },
        ])}
      />

      <CompareHero
        dateline="MONTHLY TOTAL: ASK THEIR SALES TEAM"
        title="Loonext vs Podium: a price you can read."
        lead="Podium is an all-in-one platform with reviews, payments, and AI call answering, and its pricing page publishes no prices: every path leads to a demo with sales. Loonext is a shared text inbox with the whole price list printed on the page: $29 a month, flat, buy it online. This table is what each company lets you verify, July 2026."
      />

      <LedgerBand
        heading="The table Podium's pricing page won't fill in."
        lead="Every Loonext cell is a published number. Every Podium cell is exactly what their public pricing page shows, and as of July 2026 that is no dollar amounts at all."
        footnote={PODIUM_FOOTNOTE}
      >
        <LedgerTable
          caption="Monthly cost for a 3-person crew: Loonext Starter next to Podium, whose pricing page publishes no dollar amounts as of July 2026."
          columns={PODIUM_COLUMNS}
          rows={PODIUM_ROWS}
        />
      </LedgerBand>

      <SliderBand
        heading="What a visible price looks like as you grow."
        lead="We can't chart Podium, there's no published number to chart. Here's Loonext's flat line against a typical per-user texting tool instead, so you can see the shape of the bill you're choosing between."
      />

      <HonestFit
        heading="When Podium fits better."
        intro="Podium and Loonext are barely the same category, and it would be a cheap shot to pretend the gap only runs one way."
        loonextTitle="Reach for Loonext if"
        loonextBody={
          <>
            <p>
              The part of your business that&apos;s leaking is the texting:
              customer messages landing on one person&apos;s cell, nobody sure
              who replied.
              You want that fixed this afternoon, at a price you read before
              you pay.
            </p>
            <p>
              You&apos;d rather buy software the way you buy materials: see the
              price, pay, use it, and stop any month.
            </p>
          </>
        }
        competitorTitle="Reach for Podium if"
        competitorBody={
          <>
            <p>
              You want one platform to run reviews, payments, webchat, and an
              AI agent that answers your phone, and you have the budget and
              patience for a sales process and an annual commitment.
            </p>
            <p>
              A guided rollout with an account team matters more to you than
              self-serve speed.
            </p>
          </>
        }
        points={[
          {
            title: "Review management is real, and we don't do it.",
            body: "Podium built its name on getting local businesses more Google reviews. Loonext has no review tooling at all. If reviews are the job, Podium does something we simply don't.",
          },
          {
            title: "Payments and AI answering are in the box.",
            body: "Text-to-pay and a 24/7 AI that answers calls are core Podium capabilities. Loonext is texting with an $8/mo call-forwarding add-on that texts back missed calls, honest, but a much smaller thing.",
          },
          {
            title: "An account team, if you want one.",
            body: "Podium sells with demos, onboarding, and account management. If your team wants a vendor that drives the rollout, that's a service Loonext deliberately doesn't sell, no sales calls, ever.",
          },
        ]}
        recommendation={
          <>
            Plainly: if you want reviews, payments, and an AI receptionist in
            one platform and a sales process doesn&apos;t put you off, Podium
            is a fine choice. If you want your customer texts in one shared
            inbox this afternoon for a price you can read right now, that&apos;s
            Loonext, and you don&apos;t have to talk to anyone to start.
          </>
        }
      />

      <SwitchBand
        heading="Trying Loonext risks a month, not a contract."
        lead="Because Loonext is month to month with a 30-day guarantee, you can put it next to whatever you run today and let the inbox argue for itself."
        items={[
          {
            text: "See the price, pay, and start today: number picked in minutes, crew invited by link, nothing to install.",
            good: true,
          },
          {
            text: "Keep your number: free transfer at signup or later, typically 1 to 7 business days, and it keeps working until the switch.",
            good: true,
          },
          {
            text: "30-day money-back guarantee, full refund including the $29 registration fee.",
            good: true,
          },
          {
            text: "Loonext is texting only. If you buy it expecting reviews or payments, you'll be back on this page; read the section above first.",
          },
        ]}
      />

      <CompareCta
        heading="See the price. Pay. Text today."
        sub="No demo, no phone call, no annual term. $29 a month flat for the whole crew, with a full refund in your first 30 days if it's not for you."
      />
    </>
  );
}
