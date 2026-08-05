"use client";

import { numberReleaseAt } from "@loonext/shared";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings/section";
import { Textarea } from "@/components/ui/textarea";
import { useCompany, useUpdateCompany } from "@/lib/api/companies";

/** Two segments. Long enough to say where you went and how to reach you. */
const MAX = 320;

/**
 * #481 — what a departing crew's customers are told, while we still hold the
 * number.
 *
 * # What this screen has to get right
 *
 * THE DEADLINE IS THE FEATURE. After release the number belongs to somebody
 * else and nothing can answer from it, so this is not forwarding — it is
 * "tell the people who text you, while we still can". The copy leads with when
 * it stops, because an owner who believes this outlives their account has been
 * misled by us at the worst possible moment.
 *
 * THE WORDS ARE THEIRS. An empty box with a placeholder, not a template they
 * edit. A message we drafted and they accepted is still a message we wrote to
 * people who never agreed to hear from us — and the placeholder is grey
 * example text precisely so nothing is sent unless they typed it.
 *
 * IT IS OFF UNTIL THEY SAY SO. Writing the message IS the opt-in; there is no
 * separate switch, because a switch with no message and a message with no
 * switch are both states where somebody thinks they have set this up and has
 * not.
 *
 * NO PERSUASION. This is a business winding down. A screen that argues with
 * them about leaving, or dresses this as a reason to stay, is the last thing
 * they will remember about us — and #399 says the way we behave on the way out
 * is the referral channel.
 */
export function OffRampCard() {
  const company = useCompany();
  const update = useUpdateCompany();
  const saved = company.data?.offramp_message ?? null;
  const [draft, setDraft] = useState("");

  // Seeded once the company loads, and not on every render — a controlled box
  // that re-seeds would fight somebody mid-sentence.
  useEffect(() => {
    if (saved !== null) setDraft(saved);
  }, [saved]);

  // Only for a workspace that is actually leaving. There is nothing to
  // configure while you are still here, and offering it would read as us
  // expecting you to go.
  if (company.data?.subscription_status !== "canceled") return null;

  // From the shared helper, not a fourth private copy of "30 days". Every
  // surface that names this deadline has to name the same day, and the grace
  // job that acts on it reads the same constant.
  const releaseAt = numberReleaseAt(company.data.canceled_at);
  // Past the deadline the sentence below cannot be written in the future
  // tense: it would print a date that has already gone by as though it were
  // still coming. The release runs on a once-daily cron and can fail and be
  // retried, so this says the hold has ENDED rather than asserting the number
  // is already back with the carrier, which is the same hedge HoldSentence
  // makes a few lines down the page.
  const holdEnded = releaseAt !== null && releaseAt.getTime() <= Date.now();
  const trimmed = draft.trim();
  const dirty = trimmed !== (saved ?? "");

  return (
    <SettingsCard title="Tell your customers where you went">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Anyone who texts your old number gets this back, once each.{" "}
          {releaseAt ? (
            <>
              {holdEnded ? "The hold ended on " : "It stops on "}
              <span className="font-medium text-foreground">
                {/* UTC, because that is the clock the release job runs on.
                    Rendering this in the reader's zone would show a date one
                    day out from the one their number actually goes on — and a
                    deadline that is wrong by a day is worse than no date.
                    The year is here because the day-27 email that sends people
                    to this screen prints one, and because this branch is read
                    after the deadline and can be read a year later. */}
                {releaseAt.toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </span>
              {holdEnded ? (
                <>
                  . We are not holding the number for you any more. Once it
                  goes back to the phone company we can&apos;t answer it, and
                  texts to it reach whoever gets it next.
                </>
              ) : (
                <>
                  , when the number goes back to the phone company. After that
                  we can&apos;t answer it, and texts to it reach whoever gets it
                  next.
                </>
              )}
            </>
          ) : (
            <>
              It stops when the number goes back to the phone company. After
              that we can&apos;t answer it, and texts to it reach whoever gets
              it next.
            </>
          )}
        </p>

        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, MAX))}
          rows={3}
          // An example, in grey, never prefilled: a message we drafted is a
          // message we wrote to their customers.
          placeholder="We've moved to (416) 555-0123 — call or text us there and we'll pick right up."
          aria-label="Message sent to customers who text your old number"
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {trimmed.length === 0
              ? "Nothing is sent until you write something here."
              : `${trimmed.length} of ${MAX} characters. Your words, sent as they are.`}
          </p>
          <div className="flex gap-2">
            {saved !== null && (
              <Button
                variant="ghost"
                disabled={update.isPending}
                onClick={() => {
                  setDraft("");
                  update.mutate({ offramp_message: null });
                }}
              >
                Turn off
              </Button>
            )}
            <Button
              disabled={!dirty || trimmed.length === 0 || update.isPending}
              onClick={() => update.mutate({ offramp_message: trimmed })}
            >
              {update.isPending
                ? "Saving…"
                : saved === null
                  ? "Start sending this"
                  : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}
