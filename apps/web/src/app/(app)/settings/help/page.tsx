"use client";

import {
  feedbackMailto,
  supportBody,
  supportMailto,
  SUPPORT_EMAIL,
  SUPPORT_RESPONSE_TIME,
  SUPPORT_TOPICS,
} from "@loonext/shared";
import { Lightbulb, LifeBuoy, Mail } from "lucide-react";

import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/lib/api/companies";
import { recentClientErrors } from "@/lib/observability/recent-errors";

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
                    // #253: whatever has failed on this device recently rides
                    // along. The customer should not have to know what we need
                    // in order to be helped, and they cannot read a console.
                    recentErrors: recentClientErrors(),
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
                recentErrors: recentClientErrors(),
              }).trim()}
            </pre>
          </SettingsCard>

          {/* #253 — the feedback channel that is NOT a bug report.
              "Feature requests from a working contractor are the
              highest-signal product input available to us, and there is
              currently no way for one to arrive." Somebody with an idea does
              not write to an address labelled support: they read that,
              correctly, as being for things that are broken. */}
          <SettingsCard
            title="Got an idea?"
            description="Something we don't do yet, or do in a way that doesn't fit how you work."
          >
            <div className="space-y-3">
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <a
                  href={feedbackMailto({
                    companyId: company.data.id,
                    companyName: company.data.name,
                    plan: company.data.plan,
                    platform: "web",
                  })}
                >
                  <Lightbulb aria-hidden className="size-4" />
                  Send an idea
                </a>
              </Button>
              <p className="text-sm text-muted-foreground">
                This goes to the same place, under its own subject so it
                doesn&rsquo;t get triaged as a fault. Half of what&rsquo;s in
                the product came from someone describing their day.
              </p>
            </div>
          </SettingsCard>

          {/* #253 — the answers already exist: in a banner you have to hit, or
              on a legal page you have to leave the app to find. Neither is
              reachable by somebody who has the question and is not currently
              staring at the failure. The gap was the index, not the answers. */}
          <SettingsCard
            title="Common questions"
            description="The things that confuse people most, answered straight."
          >
            <dl className="divide-y divide-border">
              {SUPPORT_TOPICS.map((topic) => (
                <div key={topic.question} className="py-3 first:pt-0 last:pb-0">
                  <dt className="text-sm font-medium">{topic.question}</dt>
                  <dd className="mt-1 text-sm text-muted-foreground">
                    {topic.answer}
                  </dd>
                </div>
              ))}
            </dl>
          </SettingsCard>

          <SettingsCard
            title="What to expect"
            description="An honest answer rather than a promise we'd have to break."
          >
            <p className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <LifeBuoy aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                {/* #253 acceptance 4: a stated commitment, from ONE shared
                    constant. Two business days is what survives a bad week —
                    an unanswered promise is worse than a vague one, and the
                    good weeks beat it at no cost. */}
                We reply {SUPPORT_RESPONSE_TIME}. We&rsquo;re a small team, so
                this is email rather than a chat window, and we read everything
                that comes in. If your texts have stopped arriving, say so in
                the subject line and we&rsquo;ll start there.
              </span>
            </p>
          </SettingsCard>
        </div>
      )}
    </SettingsPage>
  );
}
