"use client";

import type { LucideIcon } from 'lucide-react';
import Link, { useLinkStatus } from "next/link";

import { CopyablePhoneNumber } from "@/components/ui/copyable-phone-number";
import { useT } from "@/i18n/provider";
import { useMeCompany } from "@/lib/api/me-company";
import type { PhoneNumberSummary } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/** The company tile's square logo initials (e.g. "Rivera Plumbing" → "RP"). */
export function companyInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** A nav Link's icon, rendered inside it: olive and pulsing from the tap until the new page shows. */
export function NavGlyph({
  icon: Icon,
  className,
}: {
  icon: LucideIcon;
  className?: string;
}) {
  const { pending } = useLinkStatus();
  return (
    <Icon
      data-pending={pending ? "" : undefined}
      className={cn(
        className,
        "data-pending:text-app-olive-deep motion-safe:data-pending:animate-pulse",
      )}
      strokeWidth={1.75}
      aria-hidden
    />
  );
}

function CopyableNumberRow({ e164 }: { e164: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[12px]">
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full bg-app-olive"
      />
      <CopyablePhoneNumber number={e164} className="min-h-6 tabular-nums text-app-ink" />
    </div>
  );
}

/**
 * A provision_failed number the retry loop can't fix (out of inventory or out of
 * automatic attempts) — the user must choose another. Mirrors the API's
 * MAX_PROVISION_ATTEMPTS budget (5).
 */
function needsNumberChoice(n: PhoneNumberSummary): boolean {
  return (
    n.status === "provision_failed" &&
    (n.failure_reason === "no_inventory" || (n.provision_attempts ?? 0) >= 5)
  );
}

/**
 * The workspace's business number(s) for the sidebar + mobile header: the
 * copyable active number(s), or an HONEST not-ready line. A stuck provision
 * (no inventory / out of attempts) links to /settings/numbers to choose one —
 * never the passive "Setting up your number…" lie that hid a real failure.
 * It reads the company view the shell holds; GET /v1/numbers is for Settings.
 */
export function WorkspaceNumbers() {
  const t = useT();
  const meCompany = useMeCompany();
  if (meCompany.isPending) {
    return (
      <span aria-hidden className="flex h-6 items-center">
        <span
          data-slot="skeleton"
          className="h-3 w-28 animate-pulse rounded-md bg-accent"
        />
      </span>
    );
  }
  const numbers = meCompany.data?.company?.numbers ?? [];
  const active = numbers.filter(
    (n): n is PhoneNumberSummary & { number_e164: string } =>
      n.status === "active" && Boolean(n.number_e164),
  );
  if (active.length > 0) {
    return (
      <div className="space-y-1">
        {active.map((n) => (
          <CopyableNumberRow key={n.id} e164={n.number_e164} />
        ))}
      </div>
    );
  }
  if (numbers.some(needsNumberChoice)) {
    return (
      <Link
        href="/settings/numbers"
        className="flex items-center gap-1.5 text-[11.5px] font-medium text-destructive underline-offset-2 hover:underline"
      >
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-destructive" />
        {t("shell.numberSetupFailed")}
      </Link>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-app-muted-2">
      <span aria-hidden className="size-1.5 rounded-full bg-app-muted-2" />
      {t("shell.numberSettingUp")}
    </span>
  );
}
