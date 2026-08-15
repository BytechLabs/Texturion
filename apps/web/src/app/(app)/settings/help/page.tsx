"use client";

import {
  feedbackMailto,
  supportBody,
  supportMailto,
  SUPPORT_EMAIL,
  SUPPORT_FIX_PROMISE_KEY,
  SUPPORT_RESPONSE_TIME_KEY,
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
import { sayEnglish, sayWith, useT } from "@/i18n/provider";
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
  const t = useT();
  // #228: the shared support module composes text from keys and takes the
  // lookup. `say` is this reader's language; `sayEnglish` is the mail SUBJECT,
  // which stays one heading so the inbox stays searchable.
  const say = sayWith(t);
  const company = useCompany();

  return (
    <SettingsPage
      title={t("appShell.helpTitle")}
      description={t("appShell.helpDescription")}
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
            title={t("appShell.helpEmailUs")}
            description={t("appShell.helpEmailUsDescription")}
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
                  }, say, sayEnglish)}
                >
                  <Mail aria-hidden className="size-4" />
                  {t("appShell.helpEmailAddress", { email: SUPPORT_EMAIL })}
                </a>
              </Button>

              <p className="text-sm text-muted-foreground">
                {t("appShell.helpWhatToSay")}
              </p>
            </div>
          </SettingsCard>

          {/* Not everyone has a mail app wired up on the device they're
              holding — a shared work tablet often does not. The same details
              are readable here so the email can be sent from anywhere. */}
          <SettingsCard
            title={t("appShell.helpNoMailApp")}
            description={t("appShell.helpNoMailAppDescription", {
              email: SUPPORT_EMAIL,
            })}
          >
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {supportBody(
                {
                  companyId: company.data.id,
                  companyName: company.data.name,
                  plan: company.data.plan,
                  platform: "web",
                  recentErrors: recentClientErrors(),
                },
                say,
              ).trim()}
            </pre>
          </SettingsCard>

          {/* #253 — the feedback channel that is NOT a bug report.
              "Feature requests from a working contractor are the
              highest-signal product input available to us, and there is
              currently no way for one to arrive." Somebody with an idea does
              not write to an address labelled support: they read that,
              correctly, as being for things that are broken. */}
          <SettingsCard
            title={t("appShell.helpIdeaTitle")}
            description={t("appShell.helpIdeaDescription")}
          >
            <div className="space-y-3">
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <a
                  href={feedbackMailto({
                    companyId: company.data.id,
                    companyName: company.data.name,
                    plan: company.data.plan,
                    platform: "web",
                  }, say, sayEnglish)}
                >
                  <Lightbulb aria-hidden className="size-4" />
                  {t("appShell.helpSendIdea")}
                </a>
              </Button>
              <p className="text-sm text-muted-foreground">
                {t("appShell.helpIdeaFootnote")}
              </p>
            </div>
          </SettingsCard>

          {/* #253 — the answers already exist: in a banner you have to hit, or
              on a legal page you have to leave the app to find. Neither is
              reachable by somebody who has the question and is not currently
              staring at the failure. The gap was the index, not the answers. */}
          <SettingsCard
            title={t("appShell.helpCommonQuestions")}
            description={t("appShell.helpCommonQuestionsDescription")}
          >
            <dl className="divide-y divide-border">
              {SUPPORT_TOPICS.map((topic) => (
                <div key={topic.questionKey} className="py-3 first:pt-0 last:pb-0">
                  <dt className="text-sm font-medium">{say(topic.questionKey)}</dt>
                  <dd className="mt-1 text-sm text-muted-foreground">
                    {say(topic.answerKey)}
                  </dd>
                </div>
              ))}
            </dl>
          </SettingsCard>

          <SettingsCard
            title={t("appShell.helpWhatToExpect")}
            description={t("appShell.helpWhatToExpectDescription")}
          >
            <p className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <LifeBuoy aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                {/* #253 acceptance 4: a stated commitment, from ONE shared
                    constant. Two business days is what survives a bad week —
                    an unanswered promise is worse than a vague one, and the
                    good weeks beat it at no cost. */}
                {t("appShell.helpReplyPromise", {
                  time: say(SUPPORT_RESPONSE_TIME_KEY),
                })}
                {/* #321: the loop, stated. The reason to bother writing in is
                    knowing you will hear back — which makes the release step
                    in docs/RELEASING.md load-bearing, not optional. */}
                <span className="mt-2 block font-medium text-foreground">
                  {say(SUPPORT_FIX_PROMISE_KEY)}
                </span>
              </span>
            </p>
          </SettingsCard>
        </div>
      )}
    </SettingsPage>
  );
}
