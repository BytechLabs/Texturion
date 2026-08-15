"use client";

import {
  Bell,
  Building2,
  ChevronRight,
  Clock,
  CreditCard,
  Gauge,
  HandCoins,
  LifeBuoy,
  MessageSquareText,
  MonitorSmartphone,
  Phone,
  PhoneMissed,
  Plug,
  ScrollText,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import {
  visibleSettingsSections,
  type SettingsSectionId,
} from "@loonext/shared";

import { useT, type MessageKey } from "@/i18n/provider";
import { useActiveCompany } from "@/lib/company/provider";
import { shouldShowWhatsNewMarker } from "@/lib/whats-new/seen";
import { useCompany } from "@/lib/api/companies";
import { cn } from "@/lib/utils";

export interface SettingsSection {
  /**
   * #461: the canonical id the shared visibility rule keys on. Separate from
   * `slug` because the slug is a URL this app owns ("missed-calls" is kept for
   * old links) while the id is the contract the phones share.
   */
  id: SettingsSectionId;
  slug: string;
  /** #228: a catalogue key, resolved at render — see `SettingsNav` below. */
  label: MessageKey;
  description: MessageKey;
  icon: LucideIcon;
  /** Absolute href override for sections that live outside `/settings/*`
   * (e.g. Templates keeps its top-level `/templates` route). Defaults to
   * `/settings/${slug}`. */
  href?: string;
  /**
   * #286: in the nav, but never where the settings index DROPS somebody.
   *
   * The desktop index redirects to the first section a role can open. That is
   * the right rule while "can open" means "can use" — it stops sending a
   * bookkeeper to a Workspace page their own nav hides. It breaks the moment a
   * section is open to everybody as a READ, because the read then wins the
   * redirect on nav order alone and a bookkeeper clicking Settings lands on
   * the crew roster instead of the books they came for.
   *
   * A section flagged here is a place you go on purpose.
   */
  neverLanding?: boolean;
}

/** The G8 settings sections, in nav order. */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "workspace",
    slug: "workspace",
    label: "settingsMore.navWorkspace",
    description: "settingsMore.navWorkspaceDesc",
    icon: Building2,
  },
  {
    id: "team",
    slug: "team",
    label: "settingsMore.navTeam",
    description: "settingsMore.navTeamDesc",
    icon: Users,
    // #286: every role can READ this list — it is how a new member finds out
    // who owns the workspace without asking. Landing on it is another matter:
    // a member came for their notifications and a bookkeeper for the books.
    neverLanding: true,
  },
  {
    id: "numbers",
    slug: "numbers",
    label: "settingsMore.navNumbers",
    description: "settingsMore.navNumbersDesc",
    icon: Phone,
  },
  {
    // FEATURE-GAPS Step 1 — after-hours away reply.
    id: "hours",
    slug: "away-reply",
    label: "settingsMore.navHours",
    // #237: "reminders" is in the LABEL, not only the description. This section
    // is where the appointment-reminder rules live, and a flagship feature
    // findable only by opening a row called "Business hours" is not findable.
    description: "settingsMore.navHoursDesc",
    icon: Clock,
  },
  {
    // D43 Calls v2 — the whole calling surface (text-back, voicemail,
    // screening, caller ID). The slug stays 'missed-calls' so old links keep
    // working.
    id: "calling",
    slug: "missed-calls",
    label: "settingsMore.navCalling",
    description: "settingsMore.navCallingDesc",
    icon: PhoneMissed,
  },
  {
    id: "templates",
    slug: "templates",
    label: "settingsMore.navTemplates",
    // #298: tags are curated here too. The marketing already pairs them at
    // /features/templates-and-tags, so this is the product's own vocabulary
    // rather than a new one invented for a settings row.
    description: "settingsMore.navTemplatesDesc",
    icon: MessageSquareText,
  },
  {
    // #214 — opt-in AI enrichment (task address + due date from message text).
    id: "ai",
    slug: "ai",
    label: "settingsMore.navAi",
    description: "settingsMore.navAiDesc",
    icon: Sparkles,
  },
  {
    // #178: the hub never frames usage as a quota — fair use plus the
    // owner's protection, same words as marketing.
    id: "usage",
    slug: "usage",
    label: "settingsMore.navUsage",
    description: "settingsMore.navUsageDesc",
    icon: Gauge,
  },
  {
    id: "billing",
    slug: "billing",
    label: "settingsMore.navBilling",
    description: "settingsMore.navBillingDesc",
    icon: CreditCard,
  },
  {
    // #224 — text-to-pay. Directly after Billing because the two are the same
    // subject seen from opposite ends: that one is what we charge the business,
    // this is what the business charges the homeowner. Adjacent so the
    // distinction is legible; separate so neither screen has to explain it.
    id: "payments",
    slug: "payments",
    label: "settingsMore.navPayments",
    description: "settingsMore.navPaymentsDesc",
    icon: HandCoins,
  },
  {
    id: "notifications",
    slug: "notifications",
    label: "settingsMore.navNotifications",
    description: "settingsMore.navNotificationsDesc",
    icon: Bell,
  },
  {
    id: "profile",
    slug: "profile",
    label: "settingsMore.navProfile",
    description: "settingsMore.navProfileDesc",
    icon: UserRound,
  },
  {
    // D18 / APP-FEATURES-V2 §1.8 — email, password, and linked sign-in methods.
    id: "account",
    slug: "account",
    label: "settingsMore.navAccount",
    description: "settingsMore.navAccountDesc",
    icon: ShieldCheck,
  },
  {
    // #236 — what is signed in right now, and how to kill it. Directly after
    // Account because they are one question in two halves: how you get in,
    // and what is currently in.
    id: "devices",
    slug: "devices",
    label: "settingsMore.navDevices",
    description: "settingsMore.navDevicesDesc",
    icon: MonitorSmartphone,
  },
  {
    // #231 — the workspace audit log. Last in the list on purpose: it is the
    // page you go looking for, not one you pass through.
    id: "history",
    slug: "history",
    label: "settingsMore.navHistory",
    description: "settingsMore.navHistoryDesc",
    icon: ScrollText,
  },
  {
    // #382 — the route to a human. Fourteen sections and not one of them was
    // help, so a signed-in customer had to leave the product, find the
    // marketing site, and use the form built for strangers. Last in the list
    // because it is what you go looking for when something is wrong.
    id: "help",
    slug: "help",
    label: "settingsMore.navHelp",
    description: "settingsMore.navHelpDesc",
    icon: LifeBuoy,
  },
  {
    // #321 — improvement was invisible. The product ships almost daily and a
    // customer who signed up in June would never encounter reply drafting,
    // voicemail transcripts or saved views, because nothing pointed at them.
    // Beside Help because it is the other thing you go looking for rather than
    // pass through, and because neither belongs in the middle of the list a
    // person scans while trying to change their hours.
    id: "whatsNew",
    slug: "whats-new",
    label: "settingsMore.navWhatsNew",
    description: "settingsMore.navWhatsNewDesc",
    icon: Sparkles,
  },
  {
    // #243 — where this workspace's own systems get told what happened. Last,
    // beside Help and What's new, because all three are things a person goes
    // LOOKING for rather than passes through, and because a row that sends
    // customer messages to a third party should not sit in the middle of the
    // list somebody scans while trying to change their hours.
    id: "webhooks",
    slug: "webhooks",
    label: "webhooks.navWebhooks",
    description: "webhooks.navWebhooksDesc",
    icon: Plug,
  },
];

/**
 * The settings left nav (G8). Desktop: slim link list. Mobile (`asList`):
 * the /settings index renders it as a tappable stacked list → detail pages.
 */
export function SettingsNav({ asList = false }: { asList?: boolean }) {
  const t = useT();
  const pathname = usePathname();
  // #461: a member saw every section and could act on almost none of them —
  // a plan they cannot change, a registration they cannot file, roles they
  // cannot set. The nav now lists what is theirs. This is COURTESY, not
  // authorization: the server's role gates are unchanged and still refuse the
  // writes, so a typed URL gets an honest refusal rather than a hidden one.
  const { role } = useActiveCompany();
  const sections = visibleSettingsSections(
    SETTINGS_SECTIONS,
    (section) => section.id,
    role,
  );

  // #321: a dot, and nothing else. The audience is holding a phone on a job
  // site, so anything that blocks the inbox is a failure — this marks that
  // there is something behind a link somebody chooses to follow.
  //
  // Computed in an effect because it reads localStorage: doing it during
  // render would make the server pass and the first client pass disagree, and
  // a hydration mismatch on the settings nav is a worse bug than a dot that
  // appears a frame late.
  const company = useCompany();
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  useEffect(() => {
    setShowWhatsNew(shouldShowWhatsNewMarker(company.data?.created_at ?? null));
  }, [company.data?.created_at, pathname]);

  if (asList) {
    return (
      <nav
        aria-label={t("settingsMore.navSectionsAria")}
        className="divide-y rounded-lg border bg-card"
      >
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Link
              key={section.slug}
              href={section.href ?? `/settings/${section.slug}`}
              className="flex min-h-[44px] items-center gap-3 px-4 py-3 transition-colors duration-150 ease-out hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon
                className="size-5 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {t(section.label)}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t(section.description)}
                </span>
              </span>
              {section.id === "whatsNew" && showWhatsNew && (
                <span
                  aria-label={t("settingsMore.navSomethingNew")}
                  className="size-2 shrink-0 rounded-full bg-primary"
                />
              )}
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
                aria-hidden
              />
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      aria-label={t("settingsMore.navSectionsAria")}
      className="flex flex-col gap-0.5"
    >
      {sections.map((section) => {
        const href = section.href ?? `/settings/${section.slug}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const Icon = section.icon;
        return (
          <Link
            key={section.slug}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ease-out",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.75} />
            {t(section.label)}
            {section.id === "whatsNew" && showWhatsNew && (
              <span
                aria-label={t("settingsMore.navSomethingNew")}
                className="size-2 shrink-0 rounded-full bg-primary"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
