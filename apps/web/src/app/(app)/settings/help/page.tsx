"use client";

import { supportBody, supportMailto, SUPPORT_EMAIL } from "@loonext/shared";
import { LifeBuoy, Mail } from "lucide-react";

import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/lib/api/companies";

/**
 * #382 — Help.
 *
 * Settings had fourteen sections and none of them was this, so a paying
 * customer signed into the product had no way to reach a person. The failures
 * this product can have are mostly SILENT ones — a filtered message, a number
 * wrongly flagged — and every one of them is discovered the same way in
 * practice: the customer tells us. That detection path did not exist inside the
 * product.
 *
 * Deliberately a mailto and not a chat widget: a solo founder cannot staff a
 * desk, and a widget implies one. This creates no queue and no promise we
 * cannot keep.
 */
export default function HelpPage() {
  const company = useCompany();

  return (
    <SettingsPage
      title="Help"
      description="Tell us what's happening and we'll look at it. Email is the fastest way to reach a person."
    >
      {company.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-52 w-full rounded-lg" />
        </div>
      ) : company.isError || !company.data ? (
        <LoadError onRetry={() => company.refetch()} />
      ) : (
        <div className="space-y-6">
          <SettingsCard
            title="Email us"
            description="Opens your mail app with your workspace details already filled in, so we can look it up without asking you first."
          >
            <div className="space-y-4">
              <Button asChild className="w-full sm:w-auto">
                <a
                  href={supportMailto({
                    companyId: company.data.id,
                    companyName: company.data.name,
                    plan: company.data.plan,
                    platform: "web",
                  })}
                >
                  <Mail aria-hidden className="size-4" />
                  Email {SUPPORT_EMAIL}
                </a>
              </Button>

              <p className="text-sm text-muted-foreground">
                Say what you expected and what happened instead. If it&rsquo;s
                about a specific text or call, the customer&rsquo;s phone number
                and roughly when it happened is usually all we need.
              </p>
            </div>
          </SettingsCard>

          {/* Not everyone has a mail app wired up on the device they're
              holding — a shared work tablet often does not. The same details
              are readable here so the email can be sent from anywhere. */}
          <SettingsCard
            title="If that button doesn't open anything"
            description={`Write to ${SUPPORT_EMAIL} from any email app and paste this in.`}
          >
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {supportBody({
                companyId: company.data.id,
                companyName: company.data.name,
                plan: company.data.plan,
                platform: "web",
              }).trim()}
            </pre>
          </SettingsCard>

          <SettingsCard
            title="What to expect"
            description="An honest answer rather than a promise we'd have to break."
          >
            <p className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <LifeBuoy aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                We&rsquo;re a small team, so this is email rather than a chat
                window. We read everything that comes in. If your texts have
                stopped arriving, say so in the subject line and we&rsquo;ll
                start there.
              </span>
            </p>
          </SettingsCard>
        </div>
      )}
    </SettingsPage>
  );
}
