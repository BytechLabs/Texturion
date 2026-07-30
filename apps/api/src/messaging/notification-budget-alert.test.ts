import { describe, expect, it } from "vitest";

import { budgetAlertCopy, budgetCrossings } from "./notification-budget-alert";

/**
 * #401 — the two faults this module exists to close, pinned so neither can come
 * back quietly. Both were introduced by #343 splitting one budget into two and
 * leaving the alerting layer on the old shape, and both are invisible from the
 * customer's side, which is what made them worth a test rather than a fix.
 */

describe("budgetCrossings", () => {
  it("reports a PUSH crossing, which used to reach nobody", () => {
    // THE BUG. The RPC has always returned this; the handler read only the
    // legacy scalar, which the EMAIL ladder alone sets. So push could cap —
    // the crew's phones stop buzzing for new texts — with no one told.
    expect(
      budgetCrossings({
        notification_alert: null,
        notification_alerts: [{ channel: "push", threshold: 100 }],
      }),
    ).toEqual([{ channel: "push", threshold: 100 }]);
  });

  it("reports both channels when one claim crosses both", () => {
    expect(
      budgetCrossings({
        notification_alerts: [
          { channel: "email", threshold: 100 },
          { channel: "push", threshold: 80 },
        ],
      }),
    ).toHaveLength(2);
  });

  it("falls back to the legacy scalar as EMAIL against an older database", () => {
    // A Worker deployed ahead of the migration must keep today's behaviour
    // rather than going silent. The SQL pins the same reading: the scalar is
    // "the EMAIL crossing, for back-compat".
    expect(budgetCrossings({ notification_alert: 80 })).toEqual([
      { channel: "email", threshold: 80 },
    ]);
  });

  it("prefers the array once it is present, without double-counting", () => {
    // Both keys are returned by the current SQL — the scalar mirrors the email
    // ladder. Reading both would email twice for one crossing.
    expect(
      budgetCrossings({
        notification_alert: 100,
        notification_alerts: [{ channel: "email", threshold: 100 }],
      }),
    ).toEqual([{ channel: "email", threshold: 100 }]);
  });

  it("stays quiet when nothing crossed", () => {
    expect(budgetCrossings({ notification_alert: null })).toEqual([]);
    expect(budgetCrossings({ notification_alerts: [] })).toEqual([]);
    expect(budgetCrossings({})).toEqual([]);
  });

  it("never throws on a shape it did not expect", () => {
    // This runs inside the inbound webhook while a customer's text is being
    // threaded. A surprising payload must drop the alert, not the message.
    expect(
      budgetCrossings({
        notification_alerts: [
          { channel: "sms", threshold: 100 },
          { channel: "push", threshold: 42 },
          { channel: "push", threshold: 80 },
          null as never,
        ],
      }),
    ).toEqual([{ channel: "push", threshold: 80 }]);
    expect(
      budgetCrossings({ notification_alerts: "nonsense" as never }),
    ).toEqual([]);
  });
});

describe("budgetAlertCopy", () => {
  const base = { companyName: "Ace Plumbing", inboxUrl: "https://app/inbox" };

  it("never claims push is paused when only email capped", () => {
    // THE SECOND BUG, and the more damaging one. The old copy said "Email and
    // push alerts for new texts are paused" at the email ceiling, where push
    // keeps delivering for another 1,900 claims. An owner who believes it
    // stops trusting their phone on the busiest day of their year.
    const copy = budgetAlertCopy({
      ...base,
      channel: "email",
      threshold: 100,
      limit: 100,
    });
    expect(copy.text).toContain("still buzzing");
    expect(copy.text).not.toMatch(/push (alerts )?(are|will be) paused/i);
    expect(copy.text).toMatch(/email alerts are paused/i);
  });

  it("says the phones have stopped when push is the channel that capped", () => {
    const copy = budgetAlertCopy({
      ...base,
      channel: "push",
      threshold: 100,
      limit: 2000,
    });
    expect(copy.subject).toContain("stopped buzzing");
    expect(copy.text).toMatch(/push alerts for new texts are paused/i);
    expect(copy.text).toContain("2000");
  });

  it("tells every message that the texts themselves are unaffected", () => {
    // #401 ask 3: "the alerts stop, the texts do not". The one fact that makes
    // the rest survivable, and the one an alarmed reader forgets.
    for (const channel of ["email", "push"] as const) {
      for (const threshold of [80, 100] as const) {
        const copy = budgetAlertCopy({ ...base, channel, threshold, limit: 100 });
        expect(copy.text, `${channel}/${threshold}`).toContain(
          "still lands in your Loonext inbox",
        );
        expect(copy.text, `${channel}/${threshold}`).toContain(base.inboxUrl);
        expect(copy.subject, `${channel}/${threshold}`).toContain("Ace Plumbing");
      }
    }
  });

  it("offers to raise the ceiling on a warning, treating a spike as a signal", () => {
    // #401 ask 4: a workspace crossing 80% is having its best day. The offer is
    // real — the limits are ops-overridable per company, a column write.
    for (const channel of ["email", "push"] as const) {
      expect(
        budgetAlertCopy({ ...base, channel, threshold: 80, limit: 100 }).text,
      ).toContain("we will raise your limit");
    }
  });

  it("quotes the ceiling actually in force, not the plan default", () => {
    // A company with an ops override must be told its own number, or the email
    // is arguing from a figure that is not theirs.
    expect(
      budgetAlertCopy({ ...base, channel: "email", threshold: 80, limit: 700 })
        .text,
    ).toContain("700");
  });

  it("says midnight rather than a fixed hour, because the day is theirs", () => {
    // #343 made the boundary the company's own timezone. "Tomorrow" was written
    // when the day ended at 5pm in Vancouver.
    const copy = budgetAlertCopy({
      ...base,
      channel: "email",
      threshold: 100,
      limit: 100,
    });
    expect(copy.text).toContain("midnight");
  });
});
