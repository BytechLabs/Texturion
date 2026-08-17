/**
 * #228 — the batched digest's title, in the reader's language.
 *
 * The digest's two halves live apart for a reason worth stating, because the
 * split looks accidental: the BODY is `digestLine` in `packages/shared`, since
 * "4 new messages across 3 conversations" is a rule about counting that the
 * three clients could each need to state; the TITLE is only ever composed here,
 * by the flush job, and nothing else says it.
 *
 * So it is a co-located `*-copy.ts` beside its one caller, the same shape as
 * `billing/extra-number-copy.ts` — rather than a shared export that would put a
 * server-only sentence in front of every client and its two hand-ports.
 *
 * Push copy is NOT under the GSM-7 restriction that governs
 * `packages/shared/src/locale.ts`. That one is about carrier-billed SMS bodies,
 * where a character outside the alphabet halves what fits in a segment. A push
 * payload is JSON over HTTPS, so the French here takes its accents.
 */
import type { Locale } from "@loonext/shared";

interface DigestPushCopy {
  /**
   * Says the notification covers a PERIOD rather than an event, which is what
   * makes one line standing in for twelve read as deliberate.
   */
  title: string;
}

const EN: DigestPushCopy = {
  title: "While you were away",
};

const FR_CA: DigestPushCopy = {
  // 21 characters, well inside the ~40 an OS shows before it truncates a title.
  title: "Pendant votre absence",
};

export const DIGEST_PUSH_COPY: Record<Locale, DigestPushCopy> = {
  en: EN,
  "fr-CA": FR_CA,
};
