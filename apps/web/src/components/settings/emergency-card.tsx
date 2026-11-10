"use client";

import { useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";

import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/provider";
import { useUpdateCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import type { CompanyView } from "@/lib/api/types";
import {
  EMERGENCY_SAFETY_LINE,
  effectiveEmergencyKeywords,
  emergencyKeywordError,
  emergencyReplyBody,
} from "@loonext/shared";

/**
 * #460 — the emergency words and reply, in the owner's hands.
 *
 * WHY THIS IS ITS OWN CARD rather than three more rows on the away card. The
 * away card already carries three decisions (reply on/off, the message, and
 * whether an emergency word wakes the crew). Adding the word list and the
 * emergency reply makes five, past the 3–4 a reader holds at once, and the two
 * halves are answering different questions: the away card is "what do we say
 * when we're shut", this is "what counts as an emergency and what do we say
 * back". Splitting them is what lets each stay short.
 *
 * It sits DIRECTLY beneath the away card and nowhere else, because the away
 * message is the thing that tells a customer the word. An owner who changes the
 * word has to see, in the same scroll, the sentence that offers it — that
 * adjacency is the whole reason #414 put the switch there in the first place.
 */
export function EmergencyCard({
  company,
  canEdit,
}: {
  company: CompanyView;
  canEdit: boolean;
}) {
  const t = useT();
  const update = useUpdateCompany();
  /*
   * Seeded from the EFFECTIVE list, never from the raw column (Smart Defaults).
   * An owner who has never opened this screen has `emergency_keywords: null`,
   * and showing them an empty box would read as "nothing is watched for" — the
   * opposite of the truth, and the fastest way to make somebody think the
   * feature is broken. They see the four words that are really being matched,
   * and edit from there.
   */
  const [words, setWords] = useState<string[]>(() => [
    ...effectiveEmergencyKeywords(company.emergency_effective_keywords),
  ]);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState(company.emergency_message ?? "");
  const [error, setError] = useState<string | null>(null);
  // #553: local so the switch moves on the tap rather than a round trip later.
  const [replyEnabled, setReplyEnabled] = useState(
    company.emergency_reply_enabled,
  );

  // Through the shared resolver: an API that predates #460 sends no list, and
  // a settings card that throws on an older server is a worse bug than the copy
  // it replaces.
  const savedWords = effectiveEmergencyKeywords(
    company.emergency_effective_keywords,
  );
  const dirty =
    words.join("\u0000") !== savedWords.join("\u0000") ||
    message.trim() !== (company.emergency_message ?? "").trim();

  /*
   * The composed preview: the owner's body (or the product default) followed by
   * the sentence no setting removes. Composed locally ONLY while they are
   * typing — the server's `emergency_effective_message` is the truth the moment
   * nothing is unsaved, which is why it is what shows when the box is empty.
   */
  const preview =
    message.trim().length > 0
      ? emergencyReplyBody(message)
      : // The server's composed message is the truth the moment nothing is
        // unsaved. `emergencyReplyBody(null)` is the fallback for an older API
        // that does not send one — never a bare undefined rendered as text.
        (company.emergency_effective_message ?? emergencyReplyBody(null));

  function addWord() {
    const raw = draft.trim();
    const problem = emergencyKeywordError(raw, t);
    if (problem) {
      setError(problem);
      return;
    }
    const word = raw.toUpperCase();
    if (words.includes(word)) {
      setError(t("settings.emergencyWordDuplicate", { word }));
      return;
    }
    if (words.length >= 10) {
      setError(t("settings.emergencyWordLimit"));
      return;
    }
    setError(null);
    setWords([...words, word]);
    setDraft("");
  }

  function removeWord(word: string) {
    // Never down to zero. An empty list is not "no emergencies" — that is what
    // the switch on the away card says, honestly and reversibly. Silently
    // watching for nothing while the switch reads ON is the #414 defect.
    if (words.length === 1) {
      setError(t("settings.emergencyWordLastOne"));
      return;
    }
    setError(null);
    setWords(words.filter((w) => w !== word));
  }

  function save() {
    setError(null);
    const trimmed = message.trim();
    update.mutate(
      {
        // Sending the product list back unchanged would freeze it — the column
        // must stay null so improving the defaults later still reaches them.
        emergency_keywords:
          words.join("\u0000") === savedWords.join("\u0000") &&
          !company.emergency_keywords_are_custom
            ? undefined
            : words,
        emergency_message: trimmed.length > 0 ? trimmed : null,
      },
      {
        onSuccess: () => toast.success(t("settings.emergencySaved")),
        onError: (cause) =>
          setError(
            cause instanceof ApiError
              ? cause.message
              : t("settings.emergencySaveFailed"),
          ),
      },
    );
  }

  return (
    <SettingsCard id="emergency-words"
      title={t("settings.emergencyTitle")}
      description={t("settings.emergencyDescription")}
      footer={
        canEdit ? (
          <div className="flex items-center justify-end">
            <Button onClick={save} disabled={!dirty || update.isPending}>
              {update.isPending
                ? t("common.saving")
                : t("settings.emergencySave")}
            </Button>
          </div>
        ) : null
      }
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <Label>{t("settings.emergencyWordsLabel")}</Label>
          <p className="text-muted-foreground text-sm">
            {t("settings.emergencyWordsHelp")}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {words.map((word) => (
              <span
                key={word}
                className="bg-muted inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-sm"
              >
                {word}
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => removeWord(word)}
                    aria-label={t("settings.emergencyWordRemoveAria", { word })}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
          {canEdit ? (
            <div className="flex gap-2 pt-1">
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addWord();
                  }
                }}
                placeholder="LOCKEDOUT"
                maxLength={15}
                aria-label={t("settings.emergencyWordAddAria")}
                className="max-w-48 font-mono"
              />
              <Button type="button" variant="outline" onClick={addWord}>
                {t("settings.addAction")}
              </Button>
            </div>
          ) : null}
          {!company.emergency_keywords_are_custom ? (
            <p className="text-muted-foreground text-xs">
              {t("settings.emergencyWordsAreDefaults")}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="emergency-message">
            {t("settings.emergencyReplyLabel")}
          </Label>
          {/*
            #553: the switch lives NEXT TO the thing it governs.

            It always existed, but on the Hours screen — a screen away from the
            words and the message it controls — so the founder reported the reply
            as "enforced". A setting nobody can find is not a setting.

            And it is now a DIFFERENT switch. `emergency_keyword_enabled` used to
            gate four things at once, so the only way to stop us texting on the
            crew's behalf was to stop the product noticing emergencies. Turning
            this one off keeps the crew escalation, the push and the inbox flag,
            and withholds only the message.

            Saved on the tap rather than behind the card's Save button: the words
            and the message are a draft somebody composes and commits, and a
            switch that needs a separate Save is a switch people believe they have
            already thrown.
          */}
          <div className="flex items-start justify-between gap-4 pt-1">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {t("settings.emergencyReplySwitch")}
              </p>
              <p className="text-muted-foreground text-sm">
                {t("settings.emergencyReplySwitchHelp")}
              </p>
            </div>
            <Switch
              checked={replyEnabled}
              disabled={!canEdit || update.isPending}
              aria-label={t("settings.emergencyReplySwitch")}
              onCheckedChange={(next) => {
                setReplyEnabled(next);
                setError(null);
                update.mutate(
                  { emergency_reply_enabled: next },
                  {
                    onError: (cause) => {
                      setReplyEnabled(!next);
                      setError(
                        cause instanceof ApiError
                          ? cause.message
                          : t("settings.emergencyToggleFailed"),
                      );
                    },
                  },
                );
              }}
            />
          </div>
          <p className="text-muted-foreground text-sm">
            {t("settings.emergencyReplyHelp")}
          </p>
          <Textarea
            id="emergency-message"
            value={message}
            onChange={(event) => setMessage(event.target.value.slice(0, 1000))}
            placeholder={
              company.emergency_effective_message ?? emergencyReplyBody(null)
            }
            rows={3}
            disabled={!canEdit}
          />
          <p className="text-muted-foreground text-xs">
            {message.length}/1000
            {company.emergency_message_is_custom
              ? ""
              : t("settings.emergencyUsingDefault")}
          </p>
        </div>

        {/*
          The preview is the honest part of this screen. An owner editing the
          body needs to see that one sentence follows it whatever they write —
          otherwise they will believe they removed it, and find out from a
          customer. Shown as the composed message rather than as a footnote,
          because that is what the person on the other end reads.
        */}
        <div className="space-y-2">
          <Label>{t("settings.emergencyPreviewLabel")}</Label>
          <div className="bg-muted/50 rounded-lg border px-3 py-2 text-sm">
            {preview}
          </div>
          <p className="text-muted-foreground text-xs">
            {t("settings.emergencySafetyNote", { line: EMERGENCY_SAFETY_LINE })}
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
      </div>
    </SettingsCard>
  );
}
