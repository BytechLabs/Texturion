"use client";

import type { CallEndReason, CallRouting } from "@loonext/shared";
import { roleHasCapability } from "@loonext/shared";
import Link from "next/link";

import { useT } from "@/i18n/provider";
import { useCallEffects } from "@/lib/api/calls";
import { useActiveCompany } from "@/lib/company/provider";

/**
 * #725: a setting that ends or redirects calls says how many it touched, and
 * links to exactly those calls. Silent at zero: a setting that changed nothing
 * this month has nothing to report.
 */
export function CallEffectNote({ reason }: { reason: CallRouting | CallEndReason }) {
  const t = useT();
  const { role } = useActiveCompany();
  const effects = useCallEffects(roleHasCapability(role, "settings.manage"));
  const count = effects.data?.counts[reason] ?? 0;
  if (count === 0) return null;
  return (
    <p className="text-[13px] text-muted-foreground">
      {t(count === 1 ? "settingsMore.callEffectOne" : "settingsMore.callEffectOther", {
        count,
        days: effects.data?.days ?? 30,
      })}{" "}
      <Link
        href={`/calls?reason=${reason}`}
        className="font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
      >
        {t("settingsMore.callEffectView")}
      </Link>
    </p>
  );
}
