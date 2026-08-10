"use client";

import { ArrowLeft, MessageSquare, User } from "lucide-react";
import Link from "next/link";

import { VoicemailPlayer } from "@/components/calls/voicemail-player";
import { VoicemailTranscript } from "@/components/calls/voicemail-transcript";
import { LoadError } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/provider";
import { useCall } from "@/lib/api/calls";
import { outcomeLine, transcriptState } from "./call-detail-copy";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/format/time";
import { formatPhone } from "@/lib/format/phone";

/**
 * #336 — a call finally has an address.
 *
 * Conversations, contacts and tasks each had a permalink; a call was a row in
 * a list. That absence propagated: a voicemail search hit had nowhere to land,
 * "listen to this one" was a sentence with no link in it, and a missed-call
 * notification could only drop somebody on the list to hunt.
 *
 * THE SHAPE IS A DOCUMENT, NOT A DASHBOARD. Somebody arrives here from a
 * notification or a link a colleague sent, usually to answer one question:
 * what did this person say, or who dealt with it. So the page reads top to
 * bottom — who called, what happened, the words, then the ways onward — and
 * puts the transcript above the fold rather than behind a player.
 * *Applying: Prioritize Intent — build around the core action before adding
 * anything decorative.*
 */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm tabular-nums">{children}</span>
    </div>
  );
}

export function CallDetail({ sessionId }: { sessionId: string }) {
  const t = useT();
  const call = useCall(sessionId);

  if (call.isPending) {
    return (
      <div className="space-y-3" aria-label={t("shell.loadingCall")}>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }
  if (call.isError || !call.data) {
    // A 404 here is also what a member without access to this call's number
    // gets — deliberately indistinguishable, so a permalink cannot be used to
    // prove a call exists.
    return <LoadError onRetry={() => call.refetch()} />;
  }

  const row = call.data;
  const who =
    row.contact_name?.trim() ||
    row.caller_name?.trim() ||
    (row.caller_e164 ? formatPhone(row.caller_e164) : t("shell.unknownCaller"));
  const transcript = transcriptState(row, t);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6 sm:px-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/calls">
          <ArrowLeft strokeWidth={1.75} aria-hidden />
          {t("shell.allCalls")}
        </Link>
      </Button>

      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{who}</h1>
        <p className="text-sm text-muted-foreground">
          {outcomeLine(row, t)} ·{" "}
          <span title={formatAbsoluteDateTime(row.started_at)}>
            {formatRelativeTime(row.started_at)}
          </span>
        </p>
      </header>

      {/* The words first. Somebody following a link from a search result or a
          colleague is here to read them, and making them scroll past metadata
          to reach the one thing they came for is the wrong order.
          *Applying: Prioritize Intent.* */}
      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-2 text-[13px] font-bold">{t("shell.voicemail")}</h2>
        {/* #566: only REAL words get a copy control. `muted` means this is one
            of the four honest not-transcribed sentences (call-detail-copy.ts) —
            the page talking, not the caller — and offering to copy one would be
            offering to copy our own apology. */}
        {transcript.muted ? (
          <p className="text-sm text-muted-foreground">{transcript.text}</p>
        ) : (
          <VoicemailTranscript text={transcript.text} prominent />
        )}
        {row.has_voicemail && (
          <div className="mt-3">
            <VoicemailPlayer
              callSessionId={row.call_session_id}
              seconds={row.voicemail_seconds}
            />
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card px-4 py-2">
        <Row label={t("shell.directionLabel")}>
          {row.direction === "outbound"
            ? t("shell.directionOutgoing")
            : t("shell.directionIncoming")}
        </Row>
        {row.caller_e164 && (
          <Row label={t("shell.numberLabel")}>{formatPhone(row.caller_e164)}</Row>
        )}
        {row.answered_by_name && (
          <Row
            label={
              row.direction === "outbound"
                ? t("shell.placedBy")
                : t("shell.answeredBy")
            }
          >
            {row.answered_by_name}
          </Row>
        )}
        <Row label={t("shell.startedLabel")}>
          <span title={formatAbsoluteDateTime(row.started_at)}>
            {formatAbsoluteDateTime(row.started_at)}
          </span>
        </Row>
        {row.ended_at && (
          <Row label={t("shell.endedLabel")}>
            {formatAbsoluteDateTime(row.ended_at)}
          </Row>
        )}
        {row.stir_attestation && (
          /* Carrier attestation of who the caller says they are. Shown because
             a spoofed number is the one thing a person cannot judge from the
             digits, and this is the only place with room to say it. */
          <Row label={t("shell.callerVerified")}>
            {row.stir_attestation === "A"
              ? t("shell.callerVerifiedYes")
              : t("shell.callerVerifiedPartly", {
                  attestation: row.stir_attestation,
                })}
          </Row>
        )}
      </section>

      {/* The ways onward. A call is rarely the end of the thought — the reader
          wants the thread it belongs to, or the person. */}
      <div className="flex flex-wrap gap-2">
        {row.conversation_id && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/inbox/${row.conversation_id}`}>
              <MessageSquare strokeWidth={1.75} aria-hidden />
              {t("shell.openConversation")}
            </Link>
          </Button>
        )}
        {row.contact_id && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/contacts/${row.contact_id}`}>
              <User strokeWidth={1.75} aria-hidden />
              {t("shell.viewContact")}
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
