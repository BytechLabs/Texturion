/**
 * #431 — deciding which of the three outcomes a piece of AI output got.
 *
 * The ledger stores three counters. Turning a person's actual behaviour into one
 * of them is a JUDGMENT, and it is the same judgment on web, Android and iOS —
 * so it lives here as pure functions with the reasoning attached, rather than as
 * three subtly different inline conditions. #431's whole point is that the number
 * has to be trustworthy enough to keep or kill a feature on; three clients
 * disagreeing about what "edited" means would make it exactly as useless as not
 * collecting it.
 *
 * Ported to `apps/android/.../features/ai/AiOutcome.kt` and
 * `apps/ios/Loonext/Features/Ai/AiOutcome.swift`.
 */
import type { AiOutcome } from "@/lib/api/conversations";

/**
 * What happened to a reply Lou drafted.
 *
 * `shown` guards the whole thing: a composer that never displayed a suggestion
 * has nothing to report, and reporting "discarded" for it would count every
 * ordinary typed message as a rejection — which would bury the real signal under
 * the far larger number of messages Lou was never involved in.
 */
export function draftOutcome(state: {
  /** Were drafts actually put in front of the person? */
  shown: boolean;
  /** The draft they picked, if any. Null when they typed their own. */
  picked: string | null;
  /** What was actually sent. */
  sent: string;
}): AiOutcome | null {
  if (!state.shown) return null;
  if (state.picked === null) return "discarded";
  // Whitespace-insensitive: the composer trims on send, and counting a trailing
  // newline as an edit would inflate "changed first" with a difference nobody
  // made.
  return state.picked.trim() === state.sent.trim() ? "used" : "edited";
}

/** What a person did with the address and due date Lou filled in. */
export interface EnrichmentState {
  /** Did enrichment actually fill in an address? */
  suggestedAddress: boolean;
  /** Did it actually suggest a due date? */
  suggestedDue: boolean;
  /** Any address field was typed over (provenance became "manual"). */
  addressEdited: boolean;
  /** The address ended up empty. */
  addressCleared: boolean;
  /** The due date was changed to a different instant. */
  dueEdited: boolean;
  /** The due date ended up empty. */
  dueCleared: boolean;
}

/**
 * One enrichment request fills in up to two things and costs one ledger unit, so
 * it gets one outcome — which means the two halves have to be combined.
 *
 * The rule, and why: EVERY suggested part thrown away is "cleared", because the
 * person looked at all of it and kept none of it. ANY part corrected or thrown
 * away while another survives is "corrected first", because a suggestion that
 * needed fixing is not a suggestion that was right, and calling a half-correct
 * address "kept as filled in" would flatter the model. Only untouched suggestions
 * count as kept.
 *
 * Abandoning the form reports NOTHING (this is only called on a successful
 * create). Somebody who decided not to make a task at all has told us nothing
 * about whether the address was any good.
 */
export function enrichmentOutcome(state: EnrichmentState): AiOutcome | null {
  const parts: { suggested: boolean; edited: boolean; cleared: boolean }[] = [
    {
      suggested: state.suggestedAddress,
      edited: state.addressEdited,
      cleared: state.addressCleared,
    },
    {
      suggested: state.suggestedDue,
      edited: state.dueEdited,
      cleared: state.dueCleared,
    },
  ];
  const suggested = parts.filter((part) => part.suggested);
  if (suggested.length === 0) return null;

  if (suggested.every((part) => part.cleared)) return "discarded";
  if (suggested.some((part) => part.cleared || part.edited)) return "edited";
  return "used";
}

/**
 * Voicemail transcripts are NOT decided here, and the absence is deliberate.
 *
 * #431 names the negative signal: "played the audio anyway". A transcript exists
 * so nobody has to listen, so fetching the audio is it failing at its one job.
 * That signal is unambiguous — and it is entirely visible to the server, because
 * `GET /v1/calls/:id/voicemail` is the only way to obtain playable audio. So it
 * is recorded there, once, for all three clients at no client cost.
 *
 * The positive case has no honest client-side form. "Read the words and moved on"
 * is a person NOT doing something, observable only by inferring it from unmount
 * and scroll timing — and on the list screens Android and iOS use, a row disposes
 * when you scroll past it, so the inference would count "scrolled by" as "read
 * and satisfied". Three platforms guessing differently is worse than one honest
 * absence, so `voicemail_transcript` declares no `used` label at all and the
 * usage screen prints no line for it.
 */
