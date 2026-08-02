"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useActiveCompany } from "@/lib/company/provider";

import {
  firstVisibleSettingsSection,
  settingsSectionHref,
} from "./section-access";

/**
 * /settings index. Mobile: the layout renders the stacked section list, so
 * this page contributes nothing. Desktop: hop straight to the first section —
 * an empty right pane helps nobody.
 *
 * #515: "the first section" used to mean /settings/workspace for everybody,
 * which threw a member, a read-only observer or a bookkeeper into a section
 * their own nav hides — no URL typing needed, just the Settings button. It now
 * means the first section THIS role can open, read off the same list the nav
 * filters, so the landing and the rows agree.
 */
export default function SettingsIndexPage() {
  const router = useRouter();
  const { role } = useActiveCompany();
  const first = firstVisibleSettingsSection(role);

  useEffect(() => {
    if (!first) return;
    if (window.matchMedia("(min-width: 1024px)").matches) {
      router.replace(settingsSectionHref(first));
    }
  }, [router, first]);

  return (
    <p className="hidden text-sm text-muted-foreground lg:block">
      {first ? "Opening your settings…" : "There's nothing here for you yet."}
    </p>
  );
}
