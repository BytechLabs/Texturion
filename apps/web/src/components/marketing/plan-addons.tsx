/**
 * "Build your plan" add-ons strip for /pricing (#28): the plan-builder module
 * model, marketed instead of hidden. Fully static, server-rendered, zero JS —
 * it depicts the same picker the buyer meets at signup (onboarding/plan) and
 * in Settings › Billing, so nothing at checkout is a surprise.
 *
 * Truth source: PLAN_MODULE_CARDS in @/lib/api/types is the web mirror of the
 * API module catalog (apps/api/src/billing/modules.ts; quantities from
 * apps/api/src/billing/plans.ts — 150 pictures, 300 minutes, 10 GB). Labels,
 * prices, and quantity lines render from that one list so this section can
 * never drift from what checkout actually charges. `regions_ca` (Canada
 * numbers) is excluded on purpose: the API refuses to sell it until
 * multi-region provisioning ships (SELLABLE_MODULES in
 * apps/api/src/billing/company-modules.ts), and we don't advertise what a
 * buyer can't buy.
 */

import { HardDrive, ImagePlus, PhoneForwarded } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  PLAN_MODULE_CARDS,
  type PlanModule,
  type PlanModuleCard,
} from "@/lib/api/types";
import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";

/** The add-ons a buyer can actually purchase today (API SELLABLE_MODULES). */
export const SELLABLE_ADDON_CARDS: PlanModuleCard[] = PLAN_MODULE_CARDS.filter(
  (card) => card.id !== "regions_ca",
);

/**
 * The honest fine print per add-on — the limits and behaviors the product
 * enforces (apps/api/src/billing/plans.ts + messaging/send.ts cap-and-drop;
 * outbound MMS meters as a flat 3 segments per MMS_SEGMENTS in
 * messaging/media.ts, DECISIONS.md D5; the 80% warning is the owner email
 * from billing/usage-alerts.ts, and the composer reports a dropped photo
 * right after the send via thread/mms-gate.ts), stated before purchase
 * rather than discovered after.
 */
export const ADDON_FINE_PRINT: Record<
  Exclude<PlanModule, "regions_ca">,
  string
> = {
  mms: "Each picture message you send counts as three texts from your allowance, however long the words. Past 150 in a month, the photo is dropped and your message still sends as text — the account owner gets an email at 80% of the cap, and the composer tells you right away when a photo didn't go. Receiving photos is free on every plan, add-on or not.",
  voice:
    "Calls to your business number ring your cell, and missed ones get an automatic text-back so the lead still lands in your inbox. Loonext itself doesn't place calls.",
  extra_storage:
    "For crews that keep lots of job photos and files: it stacks on top of your plan's included storage (5 GB on Starter, 25 GB on Pro, per pool).",
};

const ADDON_ICONS: Record<Exclude<PlanModule, "regions_ca">, LucideIcon> = {
  mms: ImagePlus,
  voice: PhoneForwarded,
  extra_storage: HardDrive,
};

/** Decorative off-position switch: the "off by default" promise, drawn. */
function OffSwitch() {
  return (
    <span
      aria-hidden
      className="relative inline-flex h-5 w-9 shrink-0 rounded-full border border-border bg-secondary"
    >
      <span className="absolute left-0.5 top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-muted-foreground/40" />
    </span>
  );
}

function AddonCard({ card }: { card: PlanModuleCard }) {
  const id = card.id as Exclude<PlanModule, "regions_ca">;
  const Icon = ADDON_ICONS[id];
  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-5" strokeWidth={1.75} aria-hidden />
        </span>
        <OffSwitch />
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-2">
        <h3 className="text-[16px] font-semibold text-foreground">
          {card.label}
        </h3>
        <p className="text-[15px] font-semibold tabular-nums text-foreground">
          {card.price}
          <span className="font-normal text-muted-foreground">/mo</span>
        </p>
      </div>
      <p className="mt-2 text-[14px] leading-relaxed text-foreground">
        {card.blurb}
        {card.detail ? ` ${card.detail}` : ""}
      </p>
      <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
        {ADDON_FINE_PRINT[id]}
      </p>
    </div>
  );
}

/**
 * The /pricing section: "Start at $29. Add only what you need." Sits between
 * the plan cards and the honesty ledger (BLUEPRINT §8 order amendment, #28).
 */
export function PlanAddons() {
  return (
    <Section>
      <div className="mx-auto max-w-4xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="display-h2 text-foreground">
            Start at $29. Add only what you need.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            The base plan is the complete shared inbox, nothing above is held
            back. These three add-ons are the only ones that exist, each
            optional and priced right here. They&apos;re off until you turn
            them on, and you can turn them off the same way. You only ever pay
            for what you switched on.
          </p>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {SELLABLE_ADDON_CARDS.map((card) => (
            <Reveal key={card.id} className="h-full">
              <AddonCard card={card} />
            </Reveal>
          ))}
        </div>
        <p className="mt-5 text-center text-[13px] text-muted-foreground">
          The same picker, at the same prices, is what you&apos;ll see at
          signup and in billing settings. There is no other list.
        </p>
      </div>
    </Section>
  );
}
