"use client";

import { useState } from "react";

import { CallRow } from "@/components/calls/call-row";
import { AiSettings } from "@/components/settings/ai-settings";
import { AiUsage } from "@/components/settings/ai-usage";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/ui/load-error";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useT } from "@/i18n/provider";
import { useCalls } from "@/lib/api/calls";
import { useUsage } from "@/lib/api/usage";

import { usePhoneLine } from "./phone-line";

const tabs = [
  { value: "overview", label: "shell.louOverview" },
  { value: "activity", label: "shell.louActivity" },
  { value: "settings", label: "shell.navSettings" },
] as const;

export function LouPage() {
  const t = useT();
  const [tab, setTab] = useState<(typeof tabs)[number]["value"]>("overview");
  const [activityLine, setActivityLine] = useState("");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:px-6">
      <PageHeader title={t("shell.navLou")} secondary={
        <SegmentedControl ariaLabel={t("shell.navLou")} value={tab} onChange={setTab}
          options={tabs.map(({ value, label }) => ({ value, label: t(label) }))}
        />
      } />
      {tab === "overview" && <LouOverview />}
      {tab === "activity" && <LouActivity lineId={activityLine} onLineChange={setActivityLine} />}
      {tab === "settings" && <AiSettings embedded />}
    </div>
  );
}

function LouOverview() {
  const t = useT();
  const usage = useUsage();
  return (
    <section className="space-y-4 rounded-xl border border-app-line bg-app-paper p-4">
      <p className="text-sm text-app-ink-soft">{t("shell.louOverviewDescription")}</p>
      {usage.data?.ai && <AiUsage features={usage.data.ai} />}
    </section>
  );
}

function LouActivity({ lineId, onLineChange }: { lineId: string; onLineChange: (id: string) => void }) {
  const t = useT();
  const { lines } = usePhoneLine();
  const selected = lines.find((line) => line.id === lineId)?.id;
  const activity = useCalls("voicemail", undefined, undefined, selected, true);
  const calls = activity.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <section className="space-y-3">
      <label className="flex flex-wrap items-center gap-2 text-sm text-app-ink-soft">
        {t("shell.phoneLine")}
        <select className="min-h-9 rounded-md border border-app-line bg-app-paper px-2" value={selected ?? ""} onChange={(event) => onLineChange(event.target.value)}>
          <option value="">{t("shell.allPhoneLines")}</option>
          {lines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
        </select>
      </label>
      {activity.isError && <LoadError onRetry={() => void activity.refetch()} />}
      {activity.isPending && <p role="status" className="text-sm text-app-muted">{t("shell.loading")}</p>}
      {activity.isSuccess && calls.length === 0 && <p className="text-sm text-app-muted">{t("shell.louActivityEmpty")}</p>}
      {calls.length > 0 && (
        <ul className="divide-y divide-app-line rounded-xl border border-app-line bg-app-paper">
          {calls.map((call) => <li key={call.id}><CallRow call={call} /></li>)}
        </ul>
      )}
      {activity.hasNextPage && (
        <Button variant="outline" disabled={activity.isFetchingNextPage} onClick={() => void activity.fetchNextPage()}>
          {t("shell.loadMore")}
        </Button>
      )}
    </section>
  );
}
