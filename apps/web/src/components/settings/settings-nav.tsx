"use client";

import {
  Bell,
  Building2,
  ChevronRight,
  CreditCard,
  Gauge,
  Phone,
  ShieldCheck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export interface SettingsSection {
  slug: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

/** The G8 settings sections, in nav order. */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    slug: "workspace",
    label: "Workspace",
    description: "Company name, business identity, timezone",
    icon: Building2,
  },
  {
    slug: "team",
    label: "Team",
    description: "Members, roles, and invites",
    icon: Users,
  },
  {
    slug: "numbers",
    label: "Numbers",
    description: "Your business numbers and US registration",
    icon: Phone,
  },
  {
    slug: "usage",
    label: "Usage",
    description: "Messages used this period and your overage cap",
    icon: Gauge,
  },
  {
    slug: "billing",
    label: "Billing",
    description: "Plan, payment method, and invoices",
    icon: CreditCard,
  },
  {
    slug: "notifications",
    label: "Notifications",
    description: "Email and push, per person",
    icon: Bell,
  },
  {
    slug: "profile",
    label: "Profile",
    description: "Your name, theme, and sign out",
    icon: UserRound,
  },
  {
    // D18 / APP-FEATURES-V2 §1.8 — email, password, and linked sign-in methods.
    slug: "account",
    label: "Account",
    description: "Email, password, and sign-in methods",
    icon: ShieldCheck,
  },
];

/**
 * The settings left nav (G8). Desktop: slim link list. Mobile (`asList`):
 * the /settings index renders it as a tappable stacked list → detail pages.
 */
export function SettingsNav({ asList = false }: { asList?: boolean }) {
  const pathname = usePathname();

  if (asList) {
    return (
      <nav aria-label="Settings sections" className="divide-y rounded-lg border bg-card">
        {SETTINGS_SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <Link
              key={section.slug}
              href={`/settings/${section.slug}`}
              className="flex min-h-[44px] items-center gap-3 px-4 py-3 transition-colors duration-150 ease-out hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon
                className="size-5 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {section.label}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {section.description}
                </span>
              </span>
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
    <nav aria-label="Settings sections" className="flex flex-col gap-0.5">
      {SETTINGS_SECTIONS.map((section) => {
        const href = `/settings/${section.slug}`;
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
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
