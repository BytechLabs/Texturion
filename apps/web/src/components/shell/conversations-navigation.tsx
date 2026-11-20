"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useT } from "@/i18n/provider";
import { cn } from "@/lib/utils";

import { PhoneLinePicker } from "./phone-line";

const destinations = [
  { href: "/inbox", label: "shell.navMessages" },
  { href: "/calls", label: "shell.navCalls" },
] as const;

export function ConversationsNavigation() {
  const t = useT();
  const pathname = usePathname();

  return (
    <div className="shrink-0 border-b border-app-line px-4 pb-2 lg:hidden">
      <PhoneLinePicker />
      <nav aria-label={t("shell.navConversations")} className="flex gap-1">
        {destinations.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn(
              "rounded-md px-3 py-2 text-sm font-medium",
              active ? "bg-app-tint text-app-olive-deep" : "text-app-muted hover:bg-app-line-soft",
            )}>
              {t(label)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
