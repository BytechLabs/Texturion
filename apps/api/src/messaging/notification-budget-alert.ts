/**
 * #401 — the daily notification budget, said honestly, per channel.
 *
 * #343 split one budget into two: a metered EMAIL ceiling (100/day on starter,
 * 250 on pro) and a much higher PUSH one (2000/5000) that exists only as a
 * runaway guard, because push costs us nothing. The threading RPC has reported
 * both ladders ever since, in `notification_alerts`.
 *
 * The alerting layer was never moved across, and it left two faults that only
 * show up on the day they matter most — the freeze, the heat wave, the storm
 * that #401 is written about:
 *
 * **A push crossing was announced to nobody.** The RPC stamps `push_warned_at`
 * and `push_capped_at` under the counter's lock and returns the crossing in
 * `notification_alerts`, which was read nowhere in the repo. Only
 * `notification_alert` — the legacy scalar, set by the EMAIL ladder alone —
 * reached an inbox. So the channel that keeps working after email caps could
 * itself stop, and the crew simply stopped being buzzed. #401 names that exact
 * ending: *"their phone simply stops buzzing on the busiest day of their year"*.
 *
 * **And the email alert told them something false.** Its copy said *"Email and
 * push alerts for new texts are paused"* — written when there was one budget,
 * left behind when there were two. At the email ceiling push is fine and keeps
 * delivering for another 1,900 claims. An owner who believes that sentence
 * stops trusting their phone on the busiest day of their year, which is a
 * worse outcome than the cap itself and one we caused.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE COPY HAS TO DO (#401 ask 3).
 *
 * *"At 80% on a freeze day, 'you are approaching your notification limit' is
 * alarming and unactionable. What the owner needs is that the messages are
 * still arriving and still in the inbox — the alerts stop, the texts do not."*
 *
 * So every message here states, in this order: which channel, what still works,
 * and where to look. The two are never described together again, because they
 * pause at very different heights and conflating them is what made the old copy
 * wrong.
 *
 * **A spike is also a signal (#401 ask 4).** A workspace crossing 80% is having
 * its best day, so the warnings offer to raise the ceiling rather than only
 * warning. That is a real offer: the limits are ops-overridable per company via
 * `companies.notify_email_limit` / `notify_push_limit`, a column write rather
 * than a deploy. It is deliberately not a plan pitch — this is a transactional
 * email arriving mid-emergency.
 */

/** One 80%/100% crossing the threading RPC reported, for one channel. */
export interface BudgetCrossing {
  channel: "email" | "push";
  threshold: 80 | 100;
}

/** Only the fields of the RPC result this reads. */
export interface BudgetAlertSource {
  notification_alert?: number | null;
  notification_alerts?: { channel?: unknown; threshold?: unknown }[] | null;
}

/**
 * Every crossing this claim reported.
 *
 * Prefers the per-channel array. Falls back to the legacy scalar as an EMAIL
 * crossing, which is exactly what it has always meant — a Worker running against
 * an older database mid-deploy keeps its current behaviour rather than going
 * silent, and the SQL comment pins that reading: *"legacy scalar: the EMAIL
 * crossing, for back-compat"*.
 *
 * Defensive about the array's shape on purpose: this runs inside the inbound
 * webhook, and a surprising payload must not throw where a customer's text is
 * being threaded.
 */
export function budgetCrossings(source: BudgetAlertSource): BudgetCrossing[] {
  const raw = source.notification_alerts;
  if (Array.isArray(raw)) {
    const crossings: BudgetCrossing[] = [];
    for (const entry of raw) {
      const channel = entry?.channel;
      const threshold = entry?.threshold;
      if (
        (channel === "email" || channel === "push") &&
        (threshold === 80 || threshold === 100)
      ) {
        crossings.push({ channel, threshold });
      }
    }
    return crossings;
  }
  const legacy = source.notification_alert;
  if (legacy === 80 || legacy === 100) {
    return [{ channel: "email", threshold: legacy }];
  }
  return [];
}

export interface BudgetCopyArgs {
  companyName: string;
  channel: "email" | "push";
  threshold: 80 | 100;
  /** The ceiling actually in force — per plan, or this company's override. */
  limit: number;
  inboxUrl: string;
}

/**
 * What the owner and admins are told.
 *
 * The limit is quoted because a number is checkable and "your limit" is not,
 * and because it is the thing to argue with when they reply asking for more.
 * "Midnight" is theirs: #343 made the day boundary the company's own timezone,
 * so this is accurate wherever they are rather than at 5pm in Vancouver.
 */
export function budgetAlertCopy(args: BudgetCopyArgs): {
  subject: string;
  text: string;
} {
  const { companyName, channel, threshold, limit, inboxUrl } = args;
  const busy =
    `${companyName} is having an unusually busy day for new text ` +
    `conversations.`;
  // Said at every threshold on both channels, because it is the one fact that
  // makes the rest survivable and the one an alarmed reader will forget.
  const inboxHolds =
    `Every text still lands in your Loonext inbox exactly as normal. ` +
    `Nothing is dropped, delayed or lost — this limit is only on the alerts.`;
  const raiseIt =
    `If days like this are becoming normal for you, reply to this email and ` +
    `we will raise your limit.`;

  if (channel === "email" && threshold === 80) {
    return {
      subject: `${companyName} is nearing today's email alert limit`,
      text:
        `Hi,\n\n${busy} You have used about 80% of today's ${limit} email ` +
        `alerts.\n\nIf it keeps up, EMAIL alerts pause until midnight. Your ` +
        `crew's phones keep buzzing either way — push notifications run on a ` +
        `separate, much higher limit and are not affected.\n\n${inboxHolds}` +
        `\n\nThere is nothing you need to fix. If you are not expecting this ` +
        `much volume, open the inbox and check for spam threads. ${raiseIt}` +
        `\n\nOpen your inbox: ${inboxUrl}\n\nLoonext`,
    };
  }

  if (channel === "email" && threshold === 100) {
    return {
      subject: `${companyName} has reached today's email alert limit`,
      text:
        `Hi,\n\n${busy} You have used all ${limit} of today's email alerts, ` +
        `so email alerts are paused until midnight.\n\nYour crew's phones are ` +
        `still buzzing. Push notifications run on a separate, much higher ` +
        `limit and are unaffected by this — so the team is still being told ` +
        `about new texts.\n\n${inboxHolds}\n\nOpen your inbox: ${inboxUrl}` +
        `\n\nLoonext`,
    };
  }

  if (channel === "push" && threshold === 80) {
    return {
      subject: `${companyName} is nearing today's push alert limit`,
      text:
        `Hi,\n\n${busy} You have used about 80% of today's ${limit} push ` +
        `notifications, which is a very high number and not a level a normal ` +
        `day reaches.\n\nIf it keeps up, your crew's phones will stop buzzing ` +
        `for new texts until midnight. That is the alert that matters, so it ` +
        `is worth knowing before it happens.\n\n${inboxHolds} If the phones ` +
        `do go quiet, work from the inbox directly for the rest of the day.` +
        `\n\n${raiseIt}\n\nOpen your inbox: ${inboxUrl}\n\nLoonext`,
    };
  }

  // push / 100 — the one that actually costs them something.
  return {
    subject: `${companyName}'s phones have stopped buzzing for new texts today`,
    text:
      `Hi,\n\n${busy} You have used all ${limit} of today's push ` +
      `notifications, so push alerts for new texts are paused until ` +
      `midnight. Your crew's phones will not buzz for a new text until ` +
      `then.\n\n${inboxHolds} Open it directly and work from there for the ` +
      `rest of today — that is the reliable place to see everything, and it ` +
      `is complete.\n\nA day this busy is unusual. If it is not a surprise, ` +
      `reply to this email and we will raise your limit; if it is, check the ` +
      `inbox for spam threads.\n\nOpen your inbox: ${inboxUrl}\n\nLoonext`,
  };
}
