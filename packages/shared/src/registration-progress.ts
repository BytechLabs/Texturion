/**
 * #310 — making the wait legible.
 *
 * A new US-texting workspace pays, picks a number, and then waits for 10DLC
 * registration to clear. We already handle that honestly: the composer is
 * replaced by a banner naming the exact gate. What we never did was show
 * whether the wait was *working*.
 *
 * That distinction is the whole issue. People do not abandon because of the
 * wait — they abandon because "pending" for several days with no visible
 * movement is indistinguishable from broken. A tradesperson who signed up at
 * 9pm on a Sunday because they were fed up with missing jobs is, by Wednesday,
 * looking at a spinner and a card charge.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DERIVATION LIVES HERE.
 *
 * Three clients render this, and they must not disagree about how far along
 * somebody is. "Under review" on the phone and "submitted" on the laptop is
 * worse than either alone: it makes the customer distrust both.
 *
 * Hand-ported to Kotlin and Swift, with the same table asserted on all three.
 */

/** A registration row as the company view embeds it, narrowed to what we read. */
export interface RegistrationSnapshotRow {
  status: string;
  submitted_at?: string | null;
  rejection_reason?: string | null;
}

export interface RegistrationSnapshot {
  brand: RegistrationSnapshotRow | null;
  campaign: RegistrationSnapshotRow | null;
}

/**
 * Where a workspace is, at the granularity a person cares about.
 *
 * NOT the state machine's vocabulary. `brand approved / campaign submitted` is
 * true and means nothing to a plumber; "we've sent it to the carriers" is the
 * same fact in their language. The internal statuses stay internal.
 */
export type RegistrationStage =
  /** Nothing submitted yet — we still need details from them. */
  | "needs_details"
  /** With us, on its way to the carriers. */
  | "submitting"
  /** With the carriers. The long one, and the one that feels broken. */
  | "under_review"
  /** Done. */
  | "approved"
  /** Stopped, and someone has to do something. */
  | "rejected";

export interface RegistrationProgress {
  stage: RegistrationStage;
  /** 0-100, for a bar. Never 0 once anything has been submitted — see below. */
  percent: number;
  /** One line: where it is. */
  title: string;
  /** One line: what happens next, or what they must do. */
  next: string;
  /**
   * How long this usually takes from here, or null when the honest answer is
   * "nothing to wait for".
   */
  expected: string | null;
  /** Whether anything is required FROM THEM. Everything else is just waiting. */
  actionNeeded: boolean;
}

/**
 * The stage a snapshot represents.
 *
 * Campaign outranks brand: the campaign is the thing that actually unlocks
 * texting, and a workspace whose brand is approved but whose campaign is still
 * under review is *not* further along than the campaign says.
 */
export function registrationStage(snapshot: RegistrationSnapshot | null): RegistrationStage {
  if (!snapshot) return "needs_details";
  const { brand, campaign } = snapshot;

  // A rejection anywhere is the headline — it is the only state that needs
  // them, and burying it under a cheerful campaign status would be a lie of
  // emphasis.
  if (brand?.status === "rejected" || campaign?.status === "rejected") return "rejected";
  if (campaign?.status === "approved") return "approved";
  if (campaign?.status === "pending" || brand?.status === "pending") return "under_review";
  if (campaign?.status === "submitted" || brand?.status === "submitted") return "submitting";
  if (brand?.status === "approved") return "submitting";
  return "needs_details";
}

/**
 * Everything a progress view needs, in the customer's words.
 *
 * THE PERCENTAGES ARE DELIBERATELY NOT LINEAR-IN-TIME, and never 0 once
 * anything has been sent. A bar that sits at 0% for four days is the spinner
 * this feature exists to replace. The value marks *how many of the steps are
 * behind you*, which is a true statement and a useful one, rather than a
 * fabricated estimate of remaining time.
 */
export function registrationProgress(
  snapshot: RegistrationSnapshot | null,
): RegistrationProgress {
  const stage = registrationStage(snapshot);

  switch (stage) {
    case "needs_details":
      return {
        stage,
        percent: 10,
        title: "We need a few business details",
        next: "Finish the texting registration form and we'll send it on.",
        expected: null,
        actionNeeded: true,
      };

    case "submitting":
      return {
        stage,
        percent: 40,
        title: "Sent to the carriers",
        next: "The carriers review it next. Nothing needed from you.",
        // The honest range, and it says "sometimes longer" because it
        // sometimes is. An estimate that quietly expires is how a customer
        // learns not to believe the next one.
        expected: "Usually 3–7 business days, sometimes longer",
        actionNeeded: false,
      };

    case "under_review":
      return {
        stage,
        percent: 70,
        title: "Under review by the carriers",
        next: "We'll text and email you the moment it clears.",
        expected: "Usually 3–7 business days, sometimes longer",
        actionNeeded: false,
      };

    case "approved":
      return {
        stage,
        percent: 100,
        title: "Your texting is live",
        next: "You can text customers now.",
        expected: null,
        actionNeeded: false,
      };

    case "rejected":
      return {
        stage,
        percent: 40,
        title: "The carriers need something changed",
        next: "Check the details on your registration and resubmit.",
        expected: null,
        actionNeeded: true,
      };
  }
}

/**
 * Is this workspace in the waiting room?
 *
 * The one question the "while you wait" surfaces gate on. Approved is out;
 * so is `needs_details`, because that workspace is not waiting on anybody —
 * it is being waited ON, and telling it to go set up templates would be
 * pointing away from the thing blocking it.
 */
export function isWaitingOnRegistration(snapshot: RegistrationSnapshot | null): boolean {
  const stage = registrationStage(snapshot);
  return stage === "submitting" || stage === "under_review";
}
