"use client";

import { Check, Copy, type LucideIcon } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { useT } from "@/i18n/provider";
import { useMeCompany } from "@/lib/api/me-company";
import type { PhoneNumberSummary } from "@/lib/api/types";
import { formatPhone } from "@/lib/format/phone";
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

/**
 * One active business number + a copy button. The number itself is the useful
 * thing (not "1 number active"); copy writes the raw E.164 and flips to a check
 * for a beat. A standalone row so it never nests a button inside a button (the
 * workspace tiles are themselves buttons). Shared by the desktop sidebar's
 * number strip and the mobile header so both render numbers identically and
 * handle more than one number the same way.
 */
export function CopyableNumberRow({ e164 }: { e164: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const label = formatPhone(e164);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(e164);
      setCopied(true);
      toast.success(t("shell.numberCopied"));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("shell.copyBlocked"));
    }
  };
  return (
    <div className="flex items-center gap-1.5 text-[12px]">
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full bg-app-olive"
      />
      <span className="min-w-0 flex-1 truncate tabular-nums text-app-ink">
        {label}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={t("shell.copyNumber", { number: label })}
        className="grid size-6 shrink-0 place-items-center rounded-[6px] text-app-muted-2 outline-none transition-colors duration-150 ease-out hover:bg-app-line-soft hover:text-app-ink focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? (
          <Check className="size-3.5" strokeWidth={2} aria-hidden />
        ) : (
          <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />
        )}
      </button>
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
