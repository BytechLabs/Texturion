"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock } from "lucide-react";

import { useT } from "@/i18n/provider";
import { cn } from "@/lib/utils";

import { PhoneLineNavigation } from "./phone-line";

const SCHEDULED_HREF = "/inbox/scheduled";

const destinations = [
  { href: "/inbox", label: "shell.navMessages" },
  { href: "/calls", label: "shell.navCalls" },
] as const;

export function ConversationsNavigation() {
  const t = useT();
  const pathname = usePathname();
  const inMessages = pathname === "/inbox" || pathname.startsWith("/inbox/");
  const inScheduled = pathname === SCHEDULED_HREF;

  return (
    <div className="shrink-0 border-b border-app-line px-4 pb-2 lg:hidden">
      <nav aria-label={t("shell.navConversations")}>
        <PhoneLineNavigation>
          <div className="ml-4 flex gap-1">
            {destinations.map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link key={href} href={href} aria-current={active && !inScheduled ? "page" : undefined} className={cn(
                  "tap-target flex items-center rounded-md px-3 py-2 text-sm font-medium",
                  active ? "bg-app-tint text-app-olive-deep" : "text-app-muted hover:bg-app-line-soft",
                )}>
                  {t(label)}
                </Link>
              );
            })}
          </div>
          {inMessages && (
            <Link
              href={SCHEDULED_HREF}
              aria-current={inScheduled ? "page" : undefined}
              className={cn(
                "tap-target ml-8 mt-1 inline-flex items-center gap-2 rounded-md px-3 text-sm font-medium",
                inScheduled ? "bg-app-tint text-app-olive-deep" : "text-app-muted hover:bg-app-line-soft",
              )}
            >
              <CalendarClock className="size-4" aria-hidden />
              {t("shell.navScheduled")}
            </Link>
          )}
        </PhoneLineNavigation>
      </nav>
    </div>
  );
}
