"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/provider";

/** Shown at the click while the route loads; the same frame the page shows while the contact loads. */
export default function ContactLoading() {
  const t = useT();
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 md:px-6">
      <Link
        href="/contacts"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
      >
        <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        {t("appShell.contactsTitle")}
      </Link>
      <div className="space-y-4" aria-label={t("appShell.contactLoading")}>
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </div>
  );
}
