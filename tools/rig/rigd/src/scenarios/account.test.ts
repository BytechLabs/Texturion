import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gpsJpeg, hasGpsExif, sha256Hex } from "@loonext/rig-robot";
import { memberEmail } from "../../../../../scripts/rig/tenants.mjs";
import { MAIL_ACCOUNT_ADDRESS, SIGN_UP_ADDRESS } from "../app-probe.ts";
import { STRIPE_DELETE_UNDO } from "../stripe-sandbox.ts";
import { releaseHeldNumber, releaseTenantNumbers } from "../wiring.ts";
import {
  graduatedAmount,
  GRACE_CRON,
  GRACE_NOTICES,
  S22,
  S27,
  S28,
  S29,
  S29_SEGMENTS,
  S31,
  S32,
  S33,
  S34,
  S35,
  signUpAddress,
  SMS_METER_EVENT,
  STARTER_LICENSED,
  STARTER_OVERAGE,
  SUGGEST_REPLY_FEATURE,
  SUGGEST_REPLY_MONTHLY_CAP,
} from "./account.ts";
import type { ApiAnswer, AppApi, MailMessage, NumberRow, ScenarioResult } from "./context.ts";
import { fakeContext, type FakeStripe } from "./fakes.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const source = (path: string) => readFileSync(resolve(REPO, path), "utf8");

/** Evidence keeps ids and numbers; an E.164 anywhere in it is a leak. */
function expectNoPhoneNumber(evidence: Record<string, unknown>) {
  expect(JSON.stringify(evidence)).not.toMatch(/\+1\d{10}/);
}

/** The picture as the app keeps it: the GPS pointer turned into a tag no reader follows, the length unchanged. */
function withoutGps(jpeg: Uint8Array): Uint8Array {
  const bytes = Uint8Array.from(jpeg);
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x88) {
      bytes[i] = 0x00;
      bytes[i + 1] = 0xc0;
      break;
    }
  }
  return bytes;
}

function mailTo(to: string, links: string[], receivedAt: number, id = "mail-1", subject = "Rig mail"): MailMessage {
  return { id, to, from: "rig@example.invalid", subject, text: links.join("\n"), links, received_at: new Date(receivedAt).toISOString() };
}

function s22World() {
  const world = fakeContext("S22");
  const { app, robot } = world;
  const outbound = gpsJpeg();
  app.sendMms = async (args) => {
    const id = "msg-out-1";
    app.attachmentRows.set(id, [{ storage_path: "company/msg-out-1/0.jpg", content_type: "image/jpeg", size_bytes: outbound.length, quarantined_at: null }]);
    app.objects.set("mms-media/company/msg-out-1/0.jpg", outbound);
    robot.deliver({
      from_role: args.fromRole,
      to_role: args.toRole,
      text: args.body,
      media: [{ content_type: "image/jpeg", size: outbound.length, sha256: sha256Hex(outbound) }],
    });
    app.sends.push(args);
    return { ok: true, messageId: id };
  };
  robot.onSms = (message) => {
    if (!message.media) return;
    app.thread("QA-W", message.text, "inbound", { id: "msg-in-1" });
    const stored = withoutGps(gpsJpeg());
    app.attachmentRows.set("msg-in-1", [{ storage_path: "company/msg-in-1/0.jpg", content_type: "image/jpeg", size_bytes: stored.length, quarantined_at: null }]);
    app.objects.set("mms-media/company/msg-in-1/0.jpg", stored);
  };
  return world;
}

describe("S22, picture messages both ways", () => {
  it("strips only the GPS pointer in the test's copy, as the app does", () => {
    expect(hasGpsExif(gpsJpeg())).toBe(true);
    expect(hasGpsExif(withoutGps(gpsJpeg()))).toBe(false);
  });

  it("passes when Telnyx fetched the stored copy and the inbound picture lost its position", async () => {
    const { ctx, app, robot } = s22World();
    expect(await S22.run(ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(app.sends[0]).toMatchObject({ member: "qa-w-owner", fromRole: "DEV-W1", toRole: "ROBOT-1" });
    expect(app.sends[0]!.body).toContain(ctx.nonce);
    expect(robot.sent).toEqual([{ from_role: "ROBOT-1", to_role: "DEV-W1", text: `Rig S22 inbound ${ctx.nonce}`, media: "gps-jpeg" }]);
    expect(ctx.evidence.outbound).toMatchObject({ message_id: "msg-out-1", hash_match: true });
    expect(ctx.evidence.inbound).toMatchObject({ message_id: "msg-in-1", gps_kept: false, quarantined: false });
    expectNoPhoneNumber(ctx.evidence);
  });

  it("names a refused or unsendable picture", async () => {
    const refused = s22World();
    refused.app.sendMms = async () => ({ ok: false, status: 402, code: "plan_required" });
    expect(await S22.run(refused.ctx)).toMatchObject({ outcome: "fail", failure_class: "send_refused" });

    const unthreaded = s22World();
    unthreaded.app.sendMms = async () => {
      throw new Error("app probe: QA-W has no thread with ROBOT-1");
    };
    expect(await S22.run(unthreaded.ctx)).toMatchObject({ outcome: "infra", component: "app-probe" });
  });

  it("names an outbound picture that never arrived, arrived bare, or arrived as other bytes", async () => {
    const lost = s22World();
    lost.robot.deliver = () => undefined;
    expect(await S22.run(lost.ctx)).toMatchObject({ failure_class: "picture_not_delivered" });

    const elsewhere = s22World();
    const deliverElsewhere = elsewhere.robot.deliver.bind(elsewhere.robot);
    elsewhere.robot.deliver = (item) => deliverElsewhere({ ...item, from_role: "DEV-W2" });
    expect(await S22.run(elsewhere.ctx)).toMatchObject({ failure_class: "wrong_sender" });

    const bare = s22World();
    const deliver = bare.robot.deliver.bind(bare.robot);
    bare.robot.deliver = (item) => deliver({ ...item, media: [] });
    expect(await S22.run(bare.ctx)).toMatchObject({ failure_class: "media_missing" });

    const other = s22World();
    const deliverOther = other.robot.deliver.bind(other.robot);
    other.robot.deliver = (item) => deliverOther({ ...item, media: [{ content_type: "image/jpeg", size: 10, sha256: "0".repeat(64) }] });
    expect(await S22.run(other.ctx)).toMatchObject({ failure_class: "media_hash_mismatch" });

    const rowless = s22World();
    const send = rowless.app.sendMms;
    rowless.app.sendMms = async (args) => {
      const sent = await send(args);
      rowless.app.attachmentRows.clear();
      return sent;
    };
    expect(await S22.run(rowless.ctx)).toMatchObject({ failure_class: "no_attachment_row" });
  });

  it("blames Telnyx's unverified hash field, not the app, when it reports no hash", async () => {
    const world = s22World();
    const deliver = world.robot.deliver.bind(world.robot);
    world.robot.deliver = (item) => deliver({ ...item, media: [{ content_type: "image/jpeg", size: 10, sha256: null }] });
    expect(await S22.run(world.ctx)).toMatchObject({ outcome: "infra", component: "telnyx-media-hash" });
  });

  it("names an inbound picture not threaded, not stored, not a JPEG, still located, or quarantined", async () => {
    const unthreaded = s22World();
    unthreaded.robot.onSms = () => undefined;
    expect(await S22.run(unthreaded.ctx)).toMatchObject({ failure_class: "picture_not_threaded" });

    const unstored = s22World();
    unstored.robot.onSms = (message) => unstored.app.thread("QA-W", message.text, "inbound", { id: "msg-in-1" });
    expect(await S22.run(unstored.ctx)).toMatchObject({ failure_class: "picture_not_stored" });

    const garbled = s22World();
    const handle = garbled.robot.onSms;
    garbled.robot.onSms = (message) => {
      handle(message);
      garbled.app.objects.set("mms-media/company/msg-in-1/0.jpg", Uint8Array.from(Buffer.from("not a jpeg")));
    };
    expect(await S22.run(garbled.ctx)).toMatchObject({ failure_class: "stored_picture_not_jpeg" });

    const located = s22World();
    const thread = located.robot.onSms;
    located.robot.onSms = (message) => {
      thread(message);
      located.app.objects.set("mms-media/company/msg-in-1/0.jpg", gpsJpeg());
    };
    expect(await S22.run(located.ctx)).toMatchObject({ failure_class: "gps_kept" });

    const held = s22World();
    const store = held.robot.onSms;
    held.robot.onSms = (message) => {
      store(message);
      held.app.attachmentRows.get("msg-in-1")![0]!.quarantined_at = "2026-10-31T15:00:05.000Z";
    };
    expect(await S22.run(held.ctx)).toMatchObject({ failure_class: "picture_quarantined" });
  });
});

const WIDGET_TEXT = "123456 is your code to text this business from their website. It expires in 10 minutes.";

function s27World() {
  const world = fakeContext("S27");
  const { app, robot } = world;
  app.widget.verifications = 0;
  app.widget.verify = { status: 201 };
  const verifies: { verificationId: string; code: string; message: string }[] = [];
  const start = app.widgetStart.bind(app);
  app.widgetStart = async (args: { turnstileToken?: string }) => {
    const answer = await start(args);
    if (args.turnstileToken !== undefined && answer.status === 202) {
      app.widget.verifications += 1;
      robot.deliver({ from_role: "DEV-W1", to_role: "ROBOT-1", text: WIDGET_TEXT });
    }
    return answer;
  };
  const api: AppApi = app;
  api.widgetVerify = async (args) => {
    verifies.push(args);
    return app.widget.verify;
  };
  return { ...world, verifies };
}

describe("S27, website widget code", () => {
  it("passes when a start with no token is refused and the texted code verifies and is counted", async () => {
    const { ctx, verifies } = s27World();
    expect((await S27.run(ctx)).outcome).toBe("pass");
    expect(verifies).toEqual([{ verificationId: "verification-1", code: "123456", message: `Rig S27 widget ${ctx.nonce}` }]);
    expect(ctx.evidence.verifications).toEqual({ before: 0, after: 1 });
    expect(ctx.evidence).not.toHaveProperty("code");
    expectNoPhoneNumber(ctx.evidence);
  });

  it("fails a widget that starts without a Turnstile token", async () => {
    const world = s27World();
    world.app.widgetStart = async () => world.app.widget.start;
    expect(await S27.run(world.ctx)).toMatchObject({ failure_class: "captcha_not_required" });
  });

  it("names a refused start, an undelivered code, a refused code and an uncounted verification", async () => {
    const refused = s27World();
    refused.app.widget.start = { status: 403, code: "forbidden" };
    expect(await S27.run(refused.ctx)).toMatchObject({ failure_class: "widget_start_refused" });

    const silent = s27World();
    silent.robot.deliver = () => undefined;
    expect(await S27.run(silent.ctx)).toMatchObject({ failure_class: "code_not_delivered" });

    const elsewhere = s27World();
    const deliver = elsewhere.robot.deliver.bind(elsewhere.robot);
    elsewhere.robot.deliver = (item) => deliver({ ...item, from_role: "DEV-W2" });
    expect(await S27.run(elsewhere.ctx)).toMatchObject({ failure_class: "code_not_delivered" });

    const wrong = s27World();
    wrong.app.widget.verify = { status: 403, code: "forbidden" };
    expect(await S27.run(wrong.ctx)).toMatchObject({ failure_class: "code_refused" });

    const uncounted = s27World();
    const start = uncounted.app.widgetStart;
    uncounted.app.widgetStart = async (args) => {
      const answer = await start(args);
      uncounted.app.widget.verifications = 0;
      return answer;
    };
    expect(await S27.run(uncounted.ctx)).toMatchObject({ failure_class: "budget_not_decremented" });
  });

  it("reports the widget's own rate limit as the rig's, not the product's", async () => {
    const world = s27World();
    world.app.widgetStart = async () => ({ status: 429, code: "rate_limited" });
    expect(await S27.run(world.ctx)).toMatchObject({ outcome: "infra", component: "widget-limit" });
  });
});

const TELNYX_ID = "2345678901";

function boughtRow(overrides: Partial<NumberRow> = {}): NumberRow {
  return {
    id: "number-row-1",
    status: "active",
    telnyx_phone_number_id: TELNYX_ID,
    voice_connection_id: "conn-voice",
    label: null,
    suspended_at: null,
    released_at: null,
    ...overrides,
  };
}

const PURCHASE_LOG = {
  "rig-api GET /v2/available_phone_numbers 200": 1,
  "rig-api POST /v2/number_orders 200": 1,
  "rig-api PATCH /v2/phone_numbers/:id 200": 1,
  "rig-api PATCH /v2/phone_numbers/:id/voice 200": 1,
};

function s28World(options: { row?: Partial<NumberRow>; log?: Record<string, number> } = {}) {
  const world = fakeContext("S28");
  const { app, guard, undo, handoff } = world;
  guard.healthBody = { ...guard.healthBody, ordering: { enabled: true, blockers: [] } };
  app.numbers.set("QA-G", []);
  const undoAtWrite: number[] = [];
  const write = handoff.write.bind(handoff);
  handoff.write = async (record) => {
    undoAtWrite.push(undo.length);
    await write(record);
  };
  app.provisionNumber = async () => {
    app.numbers.set("QA-G", [boughtRow(options.row)]);
    guard.held.add(TELNYX_ID);
    guard.log = { ...(options.log ?? PURCHASE_LOG) };
    return app.provisioned;
  };
  return { ...world, undoAtWrite };
}

describe("S28, number buy, bind and ring", () => {
  it("passes, registers the release before it buys, and hands the number to S29 unreleased", async () => {
    const { ctx, undo, handoff, robot, browser, guard, undoAtWrite } = s28World();
    expect(await S28.run(ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(undo).toEqual([{ kind: "number.release-tenant", params: { tenant: "QA-G", unless_handed_off: true } }]);
    expect(undoAtWrite).toEqual([1, 1]);
    expect(handoff.record).toMatchObject({ tenant: "QA-G", run_id: "S28-test", telnyx_phone_number_id: TELNYX_ID, phone_number_id: "number-row-1", state: "handed_off" });
    expect(robot.plans).toHaveLength(1);
    expect(robot.plans[0]).toMatchObject({ direction: "outbound", role: "ROBOT-1", to: `number-id:${TELNYX_ID}`, lease_id: "lease-test" });
    expect(browser.opened).toEqual([{ member: "qa-g-owner", surface: "qa-c", path: "/" }]);
    expect(guard.released).toEqual([]);
    expectNoPhoneNumber(ctx.evidence);
  });

  it("keeps a passing run's number through the undo, and releases a failed run's", async () => {
    const passed = s28World();
    await S28.run(passed.ctx);
    await releaseTenantNumbers(passed.undo[0]!.params, passed);
    expect(passed.guard.held.has(TELNYX_ID)).toBe(true);
    expect(passed.handoff.record?.state).toBe("handed_off");

    const silent = s28World();
    silent.browser.script.ringsAfterMs = undefined;
    expect(await S28.run(silent.ctx)).toMatchObject({ failure_class: "number_did_not_ring" });
    expect(silent.handoff.record?.state).toBe("bought");
    await releaseTenantNumbers(silent.undo[0]!.params, silent);
    expect(silent.guard.released).toEqual([TELNYX_ID]);
    expect(silent.app.numbers.get("QA-G")![0]!.status).toBe("released");
    expect(silent.handoff.record).toBeNull();
  });

  it("takes back a hand-off no S29 took within two days, and leaves a fresh one to S29", async () => {
    const stale = s28World();
    stale.app.numbers.set("QA-G", [boughtRow()]);
    stale.guard.held.add(TELNYX_ID);
    const handedOff = { tenant: "QA-G", run_id: "S28-old", telnyx_phone_number_id: TELNYX_ID, phone_number_id: "number-row-1", state: "handed_off" as const };
    stale.handoff.record = { ...handedOff, bought_at: new Date(stale.ctx.now() - 3 * 86_400_000).toISOString() };
    expect(await S28.run(stale.ctx)).toMatchObject({ outcome: "infra", component: "handoff" });
    expect(stale.handoff.record).toMatchObject({ state: "bought", run_id: "S28-test" });
    await releaseTenantNumbers(stale.undo[0]!.params, stale);
    expect(stale.guard.released).toEqual([TELNYX_ID]);
    expect(stale.robot.plans).toEqual([]);

    const fresh = s28World();
    fresh.app.numbers.set("QA-G", [boughtRow()]);
    fresh.handoff.record = { ...handedOff, bought_at: new Date(fresh.ctx.now() - 86_400_000).toISOString() };
    expect(await S28.run(fresh.ctx)).toMatchObject({ outcome: "infra", component: "grace-workspace" });
    await releaseTenantNumbers(fresh.undo[0]!.params, fresh);
    expect(fresh.guard.released).toEqual([]);
  });

  it("buys nothing into a workspace that is not ready, or while the guard has ordering off", async () => {
    const canceled = s28World();
    canceled.app.workspaces.set("QA-G", { subscription_status: "canceled", canceled_at: "2026-09-30T15:00:00.000Z" });
    expect(await S28.run(canceled.ctx)).toMatchObject({ outcome: "infra", component: "grace-workspace" });

    const holding = s28World();
    holding.app.numbers.set("QA-G", [boughtRow({ status: "suspended" })]);
    expect(await S28.run(holding.ctx)).toMatchObject({ outcome: "infra", component: "grace-workspace" });

    const off = s28World();
    off.guard.healthBody = { ...off.guard.healthBody, ordering: { enabled: false, blockers: ["production_lacks_partition_rule"] } };
    expect(await S28.run(off.ctx)).toMatchObject({ outcome: "infra", component: "guard" });

    const unknown = s28World();
    unknown.guard.healthBody = { ...unknown.guard.healthBody, ordering: undefined };
    expect(await S28.run(unknown.ctx)).toMatchObject({ outcome: "infra", component: "guard" });

    for (const world of [canceled, holding, off, unknown]) expect(world.robot.plans).toEqual([]);
  });

  it("tells a retry the guard's interval refused from a purchase the app refused", async () => {
    const retry = s28World();
    retry.app.provisionNumber = async () => {
      retry.guard.log = { "rig-api GET /v2/available_phone_numbers 200": 1, "rig-api POST /v2/number_orders provisioning.order_interval": 1 };
      return { status: 502, code: "provisioning_failed" };
    };
    expect(await S28.run(retry.ctx)).toMatchObject({ outcome: "infra", component: "provisioning.order_interval" });

    const guarded = s28World();
    guarded.app.provisionNumber = async () => {
      guarded.guard.log = { "rig-api GET /v2/available_phone_numbers 200": 1, "rig-api POST /v2/number_orders budget.tier_red": 1 };
      return { status: 502 };
    };
    expect(await S28.run(guarded.ctx)).toMatchObject({ outcome: "infra", component: "guard" });

    const refusedByApp = s28World();
    refusedByApp.app.provisionNumber = async () => ({ status: 402, code: "subscription_inactive" });
    expect(await S28.run(refusedByApp.ctx)).toMatchObject({ outcome: "fail", failure_class: "provision_refused" });

    const probe = s28World();
    probe.app.provisionNumber = async () => {
      throw new Error("app probe: QA-G has no requested area code to buy in");
    };
    expect(await S28.run(probe.ctx)).toMatchObject({ outcome: "infra", component: "app-probe" });
  });

  it("names a number never provisioned or never bound, and fails the undo for a row that never named its number", async () => {
    const unnamed = s28World({ row: { status: "provisioning", telnyx_phone_number_id: null, voice_connection_id: null } });
    expect(await S28.run(unnamed.ctx)).toMatchObject({ failure_class: "number_not_provisioned" });
    await expect(releaseTenantNumbers(unnamed.undo[0]!.params, unnamed)).rejects.toThrow(/name no Telnyx number/);

    // The row names its number only after the run gave up on it: the undo still releases it.
    const late = s28World({ row: { status: "provisioning", telnyx_phone_number_id: null, voice_connection_id: null } });
    await S28.run(late.ctx);
    late.app.numbers.get("QA-G")![0]!.telnyx_phone_number_id = TELNYX_ID;
    await releaseTenantNumbers(late.undo[0]!.params, late);
    expect(late.guard.released).toEqual([TELNYX_ID]);

    const unbound = s28World({ row: { voice_connection_id: null } });
    expect(await S28.run(unbound.ctx)).toMatchObject({ failure_class: "number_not_bound" });
    expect(unbound.undo).toHaveLength(1);
    expect(unbound.handoff.record?.state).toBe("bought");
  });

  it("follows the row the purchase answered with, as routes/numbers.ts returns it, past any other row", async () => {
    const source = readFileSync(resolve(REPO, "apps/api/src/routes/numbers.ts"), "utf8");
    expect(source).toContain("return c.json(sanitizeNumber(provisioned as NumberRowFull), 201);");
    expect(source).toMatch(/function sanitizeNumber\(row: NumberRowFull\) \{\s*return \{\s*id: row\.id,/);

    const world = s28World();
    const provision = world.app.provisionNumber;
    world.app.provisionNumber = async () => {
      const answer = await provision();
      world.app.numbers.set("QA-G", [boughtRow({ id: "number-row-0", status: "provisioning", telnyx_phone_number_id: null }), boughtRow()]);
      return answer;
    };
    expect(await S28.run(world.ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(world.handoff.record).toMatchObject({ phone_number_id: "number-row-1" });
  });

  it("judges the guard's log: one search, one order, no release, only binding's PATCHes", async () => {
    const { "rig-api POST /v2/number_orders 200": _order, ...noOrder } = PURCHASE_LOG;
    const bypassed = s28World({ log: noOrder });
    expect(await S28.run(bypassed.ctx)).toMatchObject({ failure_class: "order_bypassed_guard", critical: true });

    const twice = s28World({ log: { ...PURCHASE_LOG, "rig-api POST /v2/number_orders 200": 2 } });
    expect(await S28.run(twice.ctx)).toMatchObject({ failure_class: "order_count" });

    const { "rig-api GET /v2/available_phone_numbers 200": _search, ...noSearch } = PURCHASE_LOG;
    const unsearched = s28World({ log: noSearch });
    expect(await S28.run(unsearched.ctx)).toMatchObject({ failure_class: "search_count" });

    const released = s28World({ log: { ...PURCHASE_LOG, "rig-api DELETE /v2/phone_numbers/:id 200": 1 } });
    expect(await S28.run(released.ctx)).toMatchObject({ failure_class: "number_released_during_run" });

    const forwarded = s28World({ log: { ...PURCHASE_LOG, "rig-api PATCH /v2/phone_numbers/:id/voice provisioning.patch_field": 1 } });
    expect(await S28.run(forwarded.ctx)).toMatchObject({ failure_class: "unexpected_patch" });

    const profile = s28World({ log: { ...PURCHASE_LOG, "rig-api PATCH /v2/messaging_profiles/:id 200": 1 } });
    expect(await S28.run(profile.ctx)).toMatchObject({ failure_class: "unexpected_patch" });

    const boundAtOrder = s28World({ log: { "rig-api GET /v2/available_phone_numbers 200": 1, "rig-api POST /v2/number_orders 200": 1 } });
    expect((await S28.run(boundAtOrder.ctx)).outcome).toBe("pass");
  });

  it("calls a number outside the partition's group, or a changed standing count, critical", async () => {
    const stopped = s28World();
    const provision = stopped.app.provisionNumber;
    stopped.app.provisionNumber = async () => {
      const answer = await provision();
      stopped.guard.healthBody = { ...stopped.guard.healthBody, ordering: { enabled: false, blockers: ["stopped_after_group_check"] } };
      return answer;
    };
    expect(await S28.run(stopped.ctx)).toMatchObject({ failure_class: "order_left_group", critical: true });

    const outside = s28World();
    outside.guard.numberStatus = async () => ({ status: 404, in_group: false });
    expect(await S28.run(outside.ctx)).toMatchObject({ failure_class: "number_outside_group", critical: true });

    const touched = s28World();
    let reads = 0;
    touched.guard.partition = async () => ({ owned: 9, standing: reads++ === 0 ? 8 : 7, messaging_profiles: 5 });
    expect(await S28.run(touched.ctx)).toMatchObject({ failure_class: "standing_number_touched", critical: true });
  });

  it("waits out the first order's read-back, and records it when the guard has not finished it", async () => {
    // The first health read is before the purchase; the ones after it see the read-back pending.
    const unverifiedFrom = (world: ReturnType<typeof s28World>, pendingReads: number) => {
      const health = world.guard.health.bind(world.guard);
      let reads = 0;
      world.guard.health = async () => {
        const body = await health();
        reads++;
        return reads > 1 && reads <= 1 + pendingReads ? { ...body, ordering: { enabled: false, blockers: ["first_order_unverified"] } } : body;
      };
    };
    const settling = s28World();
    unverifiedFrom(settling, 2);
    expect((await S28.run(settling.ctx)).outcome).toBe("pass");
    expect(settling.ctx.evidence.ordering_blockers).toEqual([]);

    const pending = s28World();
    unverifiedFrom(pending, Infinity);
    expect((await S28.run(pending.ctx)).outcome).toBe("pass");
    expect(pending.ctx.evidence.ordering_blockers).toEqual(["first_order_unverified"]);
  });

  it("blames the guard when it refuses ROBOT-1's dial to the new number", async () => {
    const world = s28World();
    world.robot.dial = async (plan) => ({ plan_id: "plan-0", plan, state: "failed", ids: {}, events: [], dtmf: "", errors: ["guard_refused:dial.window"] });
    expect(await S28.run(world.ctx)).toMatchObject({ outcome: "infra", component: "guard" });
    expect(world.handoff.record?.state).toBe("bought");
  });
});

function stripeBilling(stripe: FakeStripe, invoiced = 2_930) {
  stripe.answers.set("GET /v1/prices", {
    data: [
      { id: "price_licensed", lookup_key: STARTER_LICENSED, unit_amount: 2_900, recurring: { meter: null } },
      {
        id: "price_overage",
        lookup_key: STARTER_OVERAGE,
        unit_amount: null,
        recurring: { meter: "mtr_1" },
        tiers: [
          { up_to: 500, unit_amount: 0 },
          { up_to: null, unit_amount: 3 },
        ],
      },
    ],
  });
  stripe.answers.set("POST /v1/test_helpers/test_clocks", { id: "clock_1", status: "ready" });
  stripe.answers.set("POST /v1/customers", { id: "cus_1" });
  stripe.answers.set("POST /v1/subscriptions", { id: "sub_1", status: "active" });
  stripe.answers.set("GET /v1/billing/meters/mtr_1/event_summaries", { data: [{ aggregated_value: S29_SEGMENTS }] });
  stripe.answers.set("GET /v1/test_helpers/test_clocks/clock_1", { id: "clock_1", status: "ready" });
  stripe.answers.set("GET /v1/invoices", {
    data: [
      { id: "in_create", billing_reason: "subscription_create", subtotal: 2_900 },
      { id: "in_cycle", billing_reason: "subscription_cycle", subtotal: invoiced },
    ],
  });
}

function s29World(options: { handoff?: "handed_off" | "taken" | "bought" | null } = {}) {
  const world = fakeContext("S29");
  const { app, guard, handoff, stripe } = world;
  app.numbers.set("QA-G", [boughtRow()]);
  guard.held.add(TELNYX_ID);
  const state = options.handoff === undefined ? "handed_off" : options.handoff;
  if (state) {
    handoff.record = {
      tenant: "QA-G",
      run_id: "S28-run",
      telnyx_phone_number_id: TELNYX_ID,
      phone_number_id: "number-row-1",
      bought_at: "2026-10-30T09:00:00.000Z",
      state,
    };
  }
  // What runGraceJob does for a workspace canceled 31 days ago: every notice, then the release.
  app.fireCron = async (cron: string) => {
    app.firedCrons.push({ cron });
    if (cron !== GRACE_CRON || app.workspaces.get("QA-G")?.subscription_status !== "canceled") return;
    app.grace.set("QA-G", { notices: [...GRACE_NOTICES], live_campaigns: 0 });
    for (const row of app.numbers.get("QA-G") ?? []) {
      if (row.status === "released") continue;
      guard.held.delete(row.telnyx_phone_number_id!);
      row.status = "released";
    }
  };
  stripeBilling(stripe);
  return world;
}

const deletes = (stripe: FakeStripe) => stripe.requests.filter((r) => r.method === "DELETE").map((r) => r.path);

describe("S29, cancel, grace, release and billing", () => {
  it("passes, taking the number over, restoring QA-G to active, and deleting its test clock", async () => {
    const { ctx, undo, handoff, app, stripe } = s29World();
    expect(await S29.run(ctx)).toEqual({ outcome: "pass", detail: "QA-G held no live campaign, so its deactivation was not covered" });
    expect(undo).toEqual([
      { kind: "number.release", params: { telnyx_phone_number_id: TELNYX_ID, phone_number_id: "number-row-1" } },
      { kind: "app.restore-workspace", params: { tenant: "QA-G", state: { subscription_status: "active", canceled_at: null } } },
      { kind: STRIPE_DELETE_UNDO, params: { path: "/v1/test_helpers/test_clocks/clock_1" } },
    ]);
    expect(handoff.record?.state).toBe("taken");
    expect(app.firedCrons).toEqual([{ cron: "0 14 * * *" }]);
    expect(ctx.evidence.grace).toMatchObject({ notices: [1, 15, 27, 30], live_campaigns: 0, number_status: "released" });
    expect(ctx.evidence.billing).toMatchObject({ expected_cents: 2_930, invoiced_cents: 2_930, invoice_id: "in_cycle" });
    expect(deletes(stripe)).toEqual(["/v1/test_helpers/test_clocks/clock_1"]);
    expectNoPhoneNumber(ctx.evidence);
  });

  it("passes without the caveat when QA-G held a campaign that grace then deactivated", async () => {
    const world = s29World();
    world.app.grace.set("QA-G", { notices: [], live_campaigns: 1 });
    expect(await S29.run(world.ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(world.ctx.evidence.grace).toMatchObject({ live_campaigns_before: 1, live_campaigns: 0 });
  });

  it("keeps a failed release through the retry, whose undo already released the number", async () => {
    const first = s29World();
    const fire = first.app.fireCron;
    first.app.fireCron = async (cron: string) => {
      await fire(cron);
      first.app.numbers.get("QA-G")![0]!.status = "suspended";
      first.guard.held.add(TELNYX_ID);
    };
    const failed = await S29.run(first.ctx);
    expect(failed).toMatchObject({ outcome: "fail", failure_class: "number_not_released" });
    // The plain number.release undo: through the guard, and the hand-off cleared.
    await releaseHeldNumber(first.undo[0]!.params, first);
    expect(first.handoff.record).toBeNull();

    const retry = s29World({ handoff: null });
    retry.ctx.attempt = 2;
    retry.ctx.runId = first.ctx.runId;
    retry.history.rows = [
      { run_id: first.ctx.runId, attempt: 1, outcome: "fail", finished_at: new Date(retry.time.now).toISOString(), evidence: { attempt: 1, ...first.ctx.evidence } },
    ];
    const kept = await S29.run(retry.ctx);
    expect(kept).toMatchObject({ outcome: "fail", failure_class: "number_not_released" });
    expect((kept as Extract<ScenarioResult, { outcome: "fail" }>).detail).toMatch(/^on attempt 1, which took the number: /);
    expect(retry.ctx.evidence.release_judged_on_attempt).toBe(1);

    // Another run's judgement, or one from this run that passed, is not this attempt's to repeat.
    const otherRun = s29World({ handoff: null });
    otherRun.ctx.attempt = 2;
    otherRun.history.rows = [{ ...retry.history.rows[0]!, run_id: "S29-earlier" }];
    expect(await S29.run(otherRun.ctx)).toMatchObject({ outcome: "infra", component: "s28-handoff" });

    const passedFirst = s29World();
    await S29.run(passedFirst.ctx);
    const afterPass = s29World({ handoff: null });
    afterPass.ctx.attempt = 2;
    afterPass.ctx.runId = passedFirst.ctx.runId;
    afterPass.history.rows = [
      { run_id: passedFirst.ctx.runId, attempt: 1, outcome: "fail", finished_at: new Date(afterPass.time.now).toISOString(), evidence: { ...passedFirst.ctx.evidence } },
    ];
    expect((await S29.run(afterPass.ctx)).outcome).toBe("pass");
  });

  it("carries the nonce in every body it sends the sandbox", async () => {
    const { ctx, stripe } = s29World();
    await S29.run(ctx);
    const posts = stripe.requests.filter((r) => r.method === "POST" && !r.path.endsWith("/advance"));
    expect(posts.map((r) => r.path)).toEqual(["/v1/test_helpers/test_clocks", "/v1/customers", "/v1/subscriptions", "/v1/billing/meter_events"]);
    for (const post of posts) expect(JSON.stringify(post.params)).toContain(ctx.nonce);
    expect(posts[3]!.params).toMatchObject({ event_name: SMS_METER_EVENT, payload: { stripe_customer_id: "cus_1", value: String(S29_SEGMENTS) } });
  });

  it("leaves the undos a released number and a workspace S28 can buy into next month", async () => {
    const world = s29World();
    await S29.run(world.ctx);
    await releaseHeldNumber(world.undo[0]!.params, world);
    expect(world.handoff.record).toBeNull();
    expect(world.app.numbers.get("QA-G")![0]!.status).toBe("released");
  });

  it("still runs grace with no number handed off, and says the release half was not covered", async () => {
    for (const state of [null, "bought"] as const) {
      const world = s29World({ handoff: state });
      const result = await S29.run(world.ctx);
      expect(result).toMatchObject({ outcome: "infra", component: "s28-handoff" });
      expect((result as Extract<ScenarioResult, { outcome: "infra" }>).detail).toMatch(/release half was not covered/);
      expect(world.app.firedCrons).toEqual([{ cron: GRACE_CRON }]);
      expect(world.undo.map((u) => u.kind)).toEqual(["app.restore-workspace", STRIPE_DELETE_UNDO]);
    }
  });

  it("takes over a number an earlier attempt took and could not release", async () => {
    const world = s29World({ handoff: "taken" });
    expect((await S29.run(world.ctx)).outcome).toBe("pass");
    expect(world.undo[0]).toMatchObject({ kind: "number.release" });
  });

  it("says so when QA-G does not hold the handed-off number", async () => {
    const world = s29World();
    world.app.numbers.set("QA-G", []);
    expect(await S29.run(world.ctx)).toMatchObject({ outcome: "infra", component: "s28-handoff" });
  });

  it("changes nothing in a workspace an earlier undo left canceled, but still releases the number", async () => {
    const world = s29World();
    world.app.workspaces.set("QA-G", { subscription_status: "canceled", canceled_at: "2026-10-01T00:00:00.000Z" });
    expect(await S29.run(world.ctx)).toMatchObject({ outcome: "infra", component: "grace-workspace" });
    expect(world.app.firedCrons).toEqual([]);
    expect(world.undo.map((u) => u.kind)).toEqual(["number.release", STRIPE_DELETE_UNDO]);
  });

  it("names wrong notices, a live campaign, a kept row and a number Telnyx still holds", async () => {
    const partial = s29World();
    const fire = partial.app.fireCron;
    partial.app.fireCron = async (cron: string) => {
      await fire(cron);
      partial.app.grace.set("QA-G", { notices: [1, 15, 27], live_campaigns: 0 });
      throw new Error("app probe: firing 0 14 * * * returned 500");
    };
    const notices = await S29.run(partial.ctx);
    expect(notices).toMatchObject({ failure_class: "grace_notices" });
    expect((notices as Extract<ScenarioResult, { outcome: "fail" }>).detail).toContain("returned 500");

    const campaign = s29World();
    const fireCampaign = campaign.app.fireCron;
    campaign.app.fireCron = async (cron: string) => {
      await fireCampaign(cron);
      campaign.app.grace.set("QA-G", { notices: [...GRACE_NOTICES], live_campaigns: 1 });
    };
    expect(await S29.run(campaign.ctx)).toMatchObject({ failure_class: "campaign_still_live" });

    const kept = s29World();
    const fireKept = kept.app.fireCron;
    kept.app.fireCron = async (cron: string) => {
      await fireKept(cron);
      kept.app.numbers.get("QA-G")![0]!.status = "suspended";
    };
    expect(await S29.run(kept.ctx)).toMatchObject({ failure_class: "number_not_released" });

    const held = s29World();
    const fireHeld = held.app.fireCron;
    held.app.fireCron = async (cron: string) => {
      await fireHeld(cron);
      held.guard.held.add(TELNYX_ID);
    };
    expect(await S29.run(held.ctx)).toMatchObject({ failure_class: "telnyx_number_kept" });
  });

  it("calls a standing number touched by grace critical", async () => {
    const world = s29World();
    let reads = 0;
    world.guard.partition = async () => ({ owned: 8, standing: reads++ === 0 ? 8 : 7, messaging_profiles: 5 });
    expect(await S29.run(world.ctx)).toMatchObject({ failure_class: "standing_number_touched", critical: true });
  });

  it("names a renewal invoice that does not match the usage, or none at all", async () => {
    const off = s29World();
    stripeBilling(off.stripe, 2_900);
    expect(await S29.run(off.ctx)).toMatchObject({ failure_class: "invoice_total_mismatch" });
    expect(deletes(off.stripe)).toEqual(["/v1/test_helpers/test_clocks/clock_1"]);

    const none = s29World();
    none.stripe.answers.set("GET /v1/invoices", { data: [{ id: "in_create", billing_reason: "subscription_create", subtotal: 2_900 }] });
    expect(await S29.run(none.ctx)).toMatchObject({ failure_class: "no_renewal_invoice" });
  });

  it("reports the sandbox, not the product, when it lacks the catalog, never meters, never advances or fails", async () => {
    const empty = s29World();
    empty.stripe.answers.set("GET /v1/prices", { data: [] });
    expect(await S29.run(empty.ctx)).toMatchObject({ outcome: "infra", component: "stripe-catalog" });
    expect(deletes(empty.stripe)).toEqual([]);

    const unmetered = s29World();
    unmetered.stripe.answers.set("GET /v1/billing/meters/mtr_1/event_summaries", { data: [] });
    expect(await S29.run(unmetered.ctx)).toMatchObject({ outcome: "infra", component: "stripe" });

    const stuck = s29World();
    stuck.stripe.answers.set("GET /v1/test_helpers/test_clocks/clock_1", { id: "clock_1", status: "advancing" });
    expect(await S29.run(stuck.ctx)).toMatchObject({ outcome: "infra", component: "stripe" });
    expect(deletes(stuck.stripe)).toEqual(["/v1/test_helpers/test_clocks/clock_1"]);

    const down = s29World();
    const request = down.stripe.request.bind(down.stripe);
    down.stripe.request = async <T,>(method: "GET" | "POST" | "DELETE", path: string, params?: Record<string, unknown>) => {
      if (path === "/v1/subscriptions") throw new Error("stripe sandbox: POST answered 500");
      return request<T>(method, path, params);
    };
    expect(await S29.run(down.ctx)).toMatchObject({ outcome: "infra", component: "stripe" });
    expect(deletes(down.stripe)).toEqual(["/v1/test_helpers/test_clocks/clock_1"]);
  });

  it("reports the worse half: a grace failure over a billing infra, a billing failure over a missing hand-off", async () => {
    const grace = s29World();
    grace.app.fireCron = async () => undefined;
    grace.stripe.answers.set("GET /v1/prices", { data: [] });
    expect(await S29.run(grace.ctx)).toMatchObject({ outcome: "fail", failure_class: "grace_notices" });

    const billing = s29World({ handoff: null });
    stripeBilling(billing.stripe, 1);
    expect(await S29.run(billing.ctx)).toMatchObject({ outcome: "fail", failure_class: "invoice_total_mismatch" });
  });
});

/** The route's answer: drafts, or none and the reason why. */
function drafts(suggestions: unknown[], reason?: string): ApiAnswer<{ suggestions?: unknown[] }> {
  return { status: 200, body: Object.assign({ suggestions }, reason ? { reason } : {}) };
}

/** A draft costs 40 neurons at the guard and one unit of the ledger, and over the cap draws `over_cap`. */
function s31World() {
  const world = fakeContext("S31");
  const { app, guard, time } = world;
  guard.healthBody = { ...guard.healthBody, ai_neurons_today: 100 };
  app.ai.set(`QA-W/${SUGGEST_REPLY_FEATURE}`, 7);
  const behaviour = { meters: true, counts: true, caps: true, newDay: false };
  app.replySuggestions = async () => {
    const key = `QA-W/${SUGGEST_REPLY_FEATURE}`;
    const count = (app.ai.get(key) ?? 0) + (behaviour.counts ? 1 : 0);
    app.ai.set(key, count);
    if (behaviour.caps && count > SUGGEST_REPLY_MONTHLY_CAP) return drafts([], "over_cap");
    if (behaviour.newDay) time.now = Date.UTC(2026, 10, 1, 0, 0, 1);
    const today = behaviour.newDay ? 0 : (guard.healthBody.ai_neurons_today as number);
    if (behaviour.meters) guard.healthBody = { ...guard.healthBody, ai_neurons_today: today + 40 };
    return drafts(["Rig draft"]);
  };
  return { ...world, behaviour };
}

describe("S31, Lou's drafts and the AI cap", () => {
  it("passes when a metered, counted draft comes back and the next request at the cap is refused", async () => {
    const { ctx, undo, app } = s31World();
    expect((await S31.run(ctx)).outcome).toBe("pass");
    expect(undo).toEqual([{ kind: "app.ai-usage", params: { tenant: "QA-W", feature: SUGGEST_REPLY_FEATURE, requestCount: 8 } }]);
    expect(ctx.evidence.neurons).toEqual({ before: 100, after: 140 });
    expect(ctx.evidence.capped).toMatchObject({ drafts: 0, reason: "over_cap" });
    await app.seedAiUsage({ tenant: "QA-W", feature: SUGGEST_REPLY_FEATURE, requestCount: undo[0]!.params.requestCount as number });
    expect(app.ai.get(`QA-W/${SUGGEST_REPLY_FEATURE}`)).toBe(8);
  });

  it("counts the month's first draft, from no ledger row at all", async () => {
    const world = s31World();
    world.app.ai.clear();
    expect((await S31.run(world.ctx)).outcome).toBe("pass");
    expect(world.undo[0]!.params.requestCount).toBe(1);
  });

  it("counts a draft across midnight UTC, when the guard's day starts over", async () => {
    const world = s31World();
    world.time.now = Date.UTC(2026, 9, 31, 23, 59, 59);
    world.behaviour.newDay = true;
    expect((await S31.run(world.ctx)).outcome).toBe("pass");
    expect(world.ctx.evidence.neurons).toEqual({ before: 100, after: 40 });
  });

  it("calls a draft the guard never metered critical", async () => {
    const world = s31World();
    world.behaviour.meters = false;
    expect(await S31.run(world.ctx)).toMatchObject({ failure_class: "draft_bypassed_guard", critical: true });
    expect(world.undo).toEqual([]);
  });

  it("names a refused request, no draft, an uncounted draft and an unenforced cap", async () => {
    const refused = s31World();
    refused.app.replySuggestions = async () => ({ status: 403, code: "forbidden" });
    expect(await S31.run(refused.ctx)).toMatchObject({ failure_class: "suggestions_refused" });

    const empty = s31World();
    empty.app.replySuggestions = async () => drafts([], "model_error");
    expect(await S31.run(empty.ctx)).toMatchObject({ failure_class: "no_draft" });

    const uncounted = s31World();
    uncounted.behaviour.counts = false;
    expect(await S31.run(uncounted.ctx)).toMatchObject({ failure_class: "usage_not_counted" });

    const uncapped = s31World();
    uncapped.behaviour.caps = false;
    expect(await S31.run(uncapped.ctx)).toMatchObject({ failure_class: "cap_not_enforced" });
  });

  it("reports the rig's setup and limits as infrastructure", async () => {
    const health = s31World();
    health.guard.healthBody = { ...health.guard.healthBody, ai_neurons_today: undefined };
    expect(await S31.run(health.ctx)).toMatchObject({ outcome: "infra", component: "guard" });

    const spent = s31World();
    spent.guard.healthBody = { ...spent.guard.healthBody, ai_neurons_today: 2_000 };
    expect(await S31.run(spent.ctx)).toMatchObject({ outcome: "infra", component: "guard" });

    const capped = s31World();
    capped.app.ai.set(`QA-W/${SUGGEST_REPLY_FEATURE}`, SUGGEST_REPLY_MONTHLY_CAP);
    expect(await S31.run(capped.ctx)).toMatchObject({ outcome: "infra", component: "ai-usage" });

    const disabled = s31World();
    disabled.app.replySuggestions = async () => drafts([], "disabled");
    expect(await S31.run(disabled.ctx)).toMatchObject({ outcome: "infra", component: "reply-suggestions" });

    const limited = s31World();
    const draft = limited.app.replySuggestions;
    let calls = 0;
    limited.app.replySuggestions = async () => (calls++ === 0 ? draft() : drafts([], "rate_limited"));
    expect(await S31.run(limited.ctx)).toMatchObject({ outcome: "infra", component: "reply-suggestions" });
  });
});

function signUpWorld(scenario: "S32" | "S35", landing = "http://127.0.0.1:3100/onboarding") {
  const world = fakeContext(scenario);
  const { mail, time, browser, undo, app, stripe } = world;
  const email = signUpAddress(scenario, world.ctx.nonce);
  const undoAtSignUp: number[] = [];
  const open = browser.openPublic.bind(browser);
  browser.openPublic = async (path) => {
    const page = await open(path);
    const signUp = page.signUp;
    page.signUp = async (args) => {
      undoAtSignUp.push(undo.length);
      const answer = await signUp(args);
      if (answer.ok) mail.auth.push(mailTo(args.email, [landing], time.now + 5_000));
      return answer;
    };
    return page;
  };
  app.signUps.set(email, { company_id: "company-s32", subscription_status: "active", stripe_subscription_id: "sub_s32" });
  stripe.answers.set("GET /v1/subscriptions/sub_s32", { id: "sub_s32", status: "active" });
  return { ...world, email, undoAtSignUp };
}

describe("S35, public sign-up", () => {
  it("passes when the sign-up's confirmation link signs the new owner in, registering the delete first", async () => {
    const { ctx, undo, email, browser, undoAtSignUp } = signUpWorld("S35");
    expect((await S35.run(ctx)).outcome).toBe("pass");
    expect(email).toMatch(SIGN_UP_ADDRESS);
    expect(email).toContain(ctx.nonce.toLowerCase());
    expect(undo).toEqual([{ kind: "app.delete-sign-up", params: { email } }]);
    expect(undoAtSignUp).toEqual([1]);
    expect(browser.publicPages).toEqual(["/signup"]);
    expect(ctx.evidence.landed_path).toBe("/onboarding");
  });

  it("names a refused sign-up, a missing confirmation and a link that does not sign in", async () => {
    const refused = signUpWorld("S35");
    refused.browser.publicScript.signUp = { ok: false, alert: "That email is already registered." };
    expect(await S35.run(refused.ctx)).toMatchObject({ failure_class: "sign_up_refused" });
    expect(refused.undo).toHaveLength(1);

    const unmailed = signUpWorld("S35");
    unmailed.mail.mailpit = async () => [];
    expect(await S35.run(unmailed.ctx)).toMatchObject({ failure_class: "no_confirmation_mail" });

    const bounced = signUpWorld("S35", "http://127.0.0.1:3100/login?error=link_expired");
    expect(await S35.run(bounced.ctx)).toMatchObject({ failure_class: "confirmation_not_signed_in" });
  });

  it("reports auth's rate limit and Turnstile as the rig's", async () => {
    const limited = signUpWorld("S35");
    limited.browser.publicScript.signUp = { ok: false, alert: "Email rate limit exceeded" };
    expect(await S35.run(limited.ctx)).toMatchObject({ outcome: "infra", component: "sign-up-rate-limit" });

    const captcha = signUpWorld("S35");
    captcha.browser.publicScript.signUp = { ok: false, alert: "Captcha check failed" };
    expect(await S35.run(captcha.ctx)).toMatchObject({ outcome: "infra", component: "turnstile" });
  });
});

describe("S32, onboarding up to the number step", () => {
  it("passes on reaching the number step, records what its picker did, and goes no further", async () => {
    const { ctx, undo, email, browser } = signUpWorld("S32");
    const result = await S32.run(ctx);
    expect(result.outcome).toBe("pass");
    expect(result.detail).toMatch(/Checkout, the subscription and the customer portal are not covered/);
    expect(undo).toEqual([{ kind: "app.delete-sign-up", params: { email } }]);
    expect(ctx.evidence.onboarding).toEqual({ steps: ["name", "number"], numberSearch: "failed" });
    expect(browser.publicPages).toEqual(["/signup"]);
    expect(JSON.stringify(ctx.evidence)).not.toContain(email);
  });

  it("never starts Checkout, opens the portal or touches Stripe", async () => {
    const world = signUpWorld("S32");
    const open = world.browser.openPublic;
    world.browser.openPublic = async (path) => {
      const page = await open(path);
      page.checkout = async () => {
        throw new Error("S32 started Checkout");
      };
      page.openBillingPortal = async () => {
        throw new Error("S32 opened the billing portal");
      };
      return page;
    };
    expect((await S32.run(world.ctx)).outcome).toBe("pass");
    expect(world.stripe.adopted).toEqual([]);
    expect(deletes(world.stripe)).toEqual([]);
  });

  it("names a wizard whose name step never reaches the number step, and a sign-up that fails first", async () => {
    const stalled = signUpWorld("S32");
    stalled.browser.publicScript.onboarding = null;
    expect(await S32.run(stalled.ctx)).toMatchObject({ failure_class: "onboarding_stalled" });

    const refused = signUpWorld("S32");
    refused.browser.publicScript.signUp = { ok: false, alert: "That email is already registered." };
    expect(await S32.run(refused.ctx)).toMatchObject({ failure_class: "sign_up_refused" });
  });
});

describe("S33, two-factor sign-in", () => {
  it("passes at the second level with the API accepting the session", async () => {
    const { ctx } = fakeContext("S33");
    expect((await S33.run(ctx)).outcome).toBe("pass");
    expect(ctx.evidence.totp).toEqual({ aal: "aal2", meStatus: 200 });
  });

  it("names a first-level session and an API that refuses the second-level one", async () => {
    const first = fakeContext("S33");
    first.app.totp = { aal: "aal1", meStatus: 200 };
    expect(await S33.run(first.ctx)).toMatchObject({ failure_class: "not_second_level" });

    const refused = fakeContext("S33");
    refused.app.totp = { aal: "aal2", meStatus: 401 };
    expect(await S33.run(refused.ctx)).toMatchObject({ failure_class: "api_refused_aal2" });
  });

  it("reports a seed with no TOTP secret as infrastructure", async () => {
    const world = fakeContext("S33");
    world.app.signInWithTotp = async () => {
      throw new Error("app probe: tenants.json holds no TOTP secret for qa-w-mfa-member");
    };
    expect(await S33.run(world.ctx)).toMatchObject({ outcome: "infra", component: "totp-seed" });
  });
});

const RESET_LINK = "http://127.0.0.1:54321/auth/v1/verify?token=reset&type=recovery";
const INVITE_LINK = "http://127.0.0.1:3100/invite/invite-1";
const INVITE_SUBJECT = "You've been invited to join QA-W on Loonext";

function s34World() {
  const world = fakeContext("S34");
  const { app, mail, guard, time } = world;
  guard.healthBody = { ...guard.healthBody, mail: { heartbeat_fresh: true, halted: false, pending: 0 } };
  const invite = app.invite.bind(app);
  app.invite = async (args: { member: string; email: string }) => {
    const answer = await invite(args);
    // routes/team.ts: an address with an account is mailed over Resend, to the edge; any other is mailed by local auth.
    if (app.mailAccounts.has(args.email)) mail.robot.push(mailTo(args.email, [INVITE_LINK], time.now + 30_000, "robot-mail-1", INVITE_SUBJECT));
    else mail.auth.push(mailTo(args.email, [INVITE_LINK], time.now + 1_000, "auth-invite-1", INVITE_SUBJECT));
    return answer;
  };
  const reset = app.sendPasswordReset.bind(app);
  app.sendPasswordReset = async (args: { member: string }) => {
    const status = await reset(args);
    mail.auth.push(mailTo(memberEmail("qa-w", "technician"), [RESET_LINK], time.now + 2_000, "auth-mail-1"));
    return status;
  };
  mail.links.set(RESET_LINK, { status: 303, location: "http://127.0.0.1:3100/reset-password" });
  return world;
}

describe("S34, emails", () => {
  it("passes when the invite to an existing account reaches the robot mailbox and the reset reaches Mailpit, every link working", async () => {
    const { ctx, undo, app, mail } = s34World();
    const result = await S34.run(ctx);
    expect(result).toMatchObject({ outcome: "pass" });
    expect((result as { detail?: string }).detail).toMatch(/missed-call alert is not covered/);
    const address = mail.robotAddress(`s34-acct-${ctx.nonce}`)!;
    expect(address).toMatch(MAIL_ACCOUNT_ADDRESS);
    expect([...app.mailAccounts]).toEqual([address]);
    expect(app.invites).toEqual([{ member: "qa-w-owner", email: address }]);
    expect(undo).toEqual([
      { kind: "app.delete-mail-account", params: { email: address } },
      { kind: "app.revoke-invite", params: { member: "qa-w-owner", inviteId: "invite-1" } },
    ]);
    expect(app.passwordResets).toEqual(["qa-w-technician"]);
    expect(S34.guardLease).toBe(true);
    expect(ctx.evidence).toMatchObject({ missed_call_alert: "not_covered", invite_mail: { subject: INVITE_SUBJECT, link_statuses: [200] }, invite: { email_sent: true }, reset_mail: { link_statuses: [303] } });
  });

  it("reads the invite's id from the row routes/team.ts answers with", () => {
    expect(source("apps/api/src/routes/team.ts")).toContain("return c.json({ ...invite, email_sent: emailSent }, 201);");
  });

  it("gives the sub-address an account before it invites, because only an account makes the app mail over Resend", async () => {
    const { ctx, app } = s34World();
    const order: string[] = [];
    const create = app.createMailAccount.bind(app);
    app.createMailAccount = async (args) => {
      order.push("account");
      return create(args);
    };
    const invite = app.invite.bind(app);
    app.invite = async (args) => {
      order.push("invite");
      return invite(args);
    };
    await S34.run(ctx);
    expect(order).toEqual(["account", "invite"]);
  });

  it("reports an account local auth would not make as infrastructure, and invites nobody", async () => {
    const refused = s34World();
    refused.app.createMailAccount = async () => 500;
    expect(await S34.run(refused.ctx)).toMatchObject({ outcome: "infra", component: "local-auth" });
    const down = s34World();
    down.app.createMailAccount = async () => {
      throw new Error("fetch failed");
    };
    expect(await S34.run(down.ctx)).toMatchObject({ outcome: "infra", component: "local-auth" });
    expect(refused.app.invites).toEqual([]);
    expect(down.app.invites).toEqual([]);
  });

  it("fails an invite that local auth mailed instead of the app, which never touches Resend or Email Routing", async () => {
    const world = s34World();
    world.app.createMailAccount = async () => 200;
    world.app.mailAccounts.clear();
    expect(await S34.run(world.ctx)).toMatchObject({ outcome: "fail", failure_class: "invite_sent_by_auth" });
    expect(world.app.passwordResets).toEqual([]);
  });

  it("fails an invite whose Resend send the app reports as failed", async () => {
    const world = s34World();
    const invite = world.app.invite.bind(world.app);
    world.app.invite = async (args) => ({ ...(await invite(args)), body: { id: "invite-1", email_sent: false } });
    expect(await S34.run(world.ctx)).toMatchObject({ failure_class: "invite_not_sent" });
  });

  it("tells mail that arrived without the +tag from mail that never arrived, and checks the mail is the invite", async () => {
    const stripped = s34World();
    stripped.mail.robotMail = async (args) => (args.tag ? [] : [mailTo("rig-robot@example.invalid", [INVITE_LINK], stripped.time.now + 60_000)]);
    expect(await S34.run(stripped.ctx)).toMatchObject({ failure_class: "invite_mail_untagged" });

    const other = s34World();
    const invite = other.app.invite.bind(other.app);
    other.app.invite = async (args) => {
      const answer = await invite(args);
      other.mail.robot.forEach((item) => (item.subject = "Your receipt"));
      return answer;
    };
    expect(await S34.run(other.ctx)).toMatchObject({ failure_class: "invite_mail_wrong" });

    const elsewhere = s34World();
    const invite2 = elsewhere.app.invite.bind(elsewhere.app);
    elsewhere.app.invite = async (args) => {
      const answer = await invite2(args);
      elsewhere.mail.robot.forEach((item) => (item.links = ["http://127.0.0.1:3100/login"]));
      return answer;
    };
    expect(await S34.run(elsewhere.ctx)).toMatchObject({ failure_class: "invite_link_broken" });
  });

  it("checks nothing without a robot mailbox, a fresh heartbeat or a guard lease that lets the guard mail it", async () => {
    const unnamed = s34World();
    unnamed.mail.mailbox = undefined;
    expect(await S34.run(unnamed.ctx)).toMatchObject({ outcome: "infra", component: "robot-mailbox" });

    const stale = s34World();
    stale.guard.healthBody = { ...stale.guard.healthBody, mail: { heartbeat_fresh: false, halted: false, pending: 0 } };
    expect(await S34.run(stale.ctx)).toMatchObject({ outcome: "infra", component: "robot-mailbox" });

    const halted = s34World();
    halted.guard.healthBody = { ...halted.guard.healthBody, mail: { heartbeat_fresh: true, halted: true, pending: 1 } };
    expect(await S34.run(halted.ctx)).toMatchObject({ outcome: "infra", component: "robot-mailbox" });

    const local = s34World();
    local.guard.activity = async () => {
      throw new Error("guard: lease.not_found");
    };
    expect(await S34.run(local.ctx)).toMatchObject({ outcome: "infra", component: "guard-lease" });

    for (const world of [unnamed, stale, halted, local]) {
      expect(world.app.invites).toEqual([]);
      expect(world.app.mailAccounts.size).toBe(0);
    }
  });

  it("names a refused invite or reset, and mail that never came", async () => {
    const refused = s34World();
    const api: AppApi = refused.app;
    api.invite = async () => ({ status: 409, code: "already_invited" });
    expect(await S34.run(refused.ctx)).toMatchObject({ failure_class: "invite_refused" });

    const reset = s34World();
    reset.app.sendPasswordReset = async () => 500;
    expect(await S34.run(reset.ctx)).toMatchObject({ failure_class: "reset_refused" });

    const throttled = s34World();
    throttled.app.sendPasswordReset = async () => 429;
    expect(await S34.run(throttled.ctx)).toMatchObject({ outcome: "infra", component: "auth-rate-limit" });

    const lost = s34World();
    lost.mail.robotMail = async () => [];
    expect(await S34.run(lost.ctx)).toMatchObject({ failure_class: "invite_mail_missing" });

    const unsent = s34World();
    unsent.mail.mailpit = async () => [];
    expect(await S34.run(unsent.ctx)).toMatchObject({ failure_class: "reset_mail_missing" });
  });

  it("names a broken or missing link in either mail", async () => {
    const broken = s34World();
    broken.mail.links.set(INVITE_LINK, { status: 404, location: null });
    expect(await S34.run(broken.ctx)).toMatchObject({ failure_class: "invite_link_broken" });

    const linkless = s34World();
    const invite = linkless.app.invite;
    linkless.app.invite = async (args) => {
      const answer = await invite(args);
      linkless.mail.robot.forEach((item) => (item.links = []));
      return answer;
    };
    expect(await S34.run(linkless.ctx)).toMatchObject({ failure_class: "invite_link_broken" });

    const expired = s34World();
    expired.mail.links.set(RESET_LINK, { status: 500, location: null });
    expect(await S34.run(expired.ctx)).toMatchObject({ failure_class: "reset_link_broken" });
  });
});

describe("what the runners take from the app, the seed and the sandbox", () => {
  it("meters drafts under the feature and cap apps/api's reply suggestions use", () => {
    const api = source("apps/api/src/messaging/reply-suggestions.ts");
    expect(api).toContain(`export const SUGGEST_REPLY_FEATURE = "${SUGGEST_REPLY_FEATURE}";`);
    expect(api).toContain(`export const SUGGEST_REPLY_MONTHLY_CAP = ${SUGGEST_REPLY_MONTHLY_CAP};`);
  });

  it("expects grace's own notices, from the cron the API runs grace on", () => {
    const grace = source("apps/api/src/billing/grace.ts");
    expect(grace).toContain(`GRACE_THRESHOLD_DAYS: readonly GraceThresholdDay[] = [${GRACE_NOTICES.slice(0, 3).join(", ")}];`);
    expect(grace).toContain(`export const GRACE_RELEASED_NOTICE_DAY = ${GRACE_NOTICES[3]};`);
    expect(source("apps/api/src/index.ts")).toContain(`"${GRACE_CRON}": [job("job:grace-and-release", runGraceJob)]`);
  });

  it("bills against the plan and meter stripe-setup makes", () => {
    const setup = source("apps/api/scripts/stripe-setup.ts");
    expect(setup).toContain(`const METER_EVENT_NAME = "${SMS_METER_EVENT}";`);
    expect(setup).toContain(`ensurePrice("${STARTER_LICENSED}"`);
    expect(setup).toContain(`ensurePrice("${STARTER_OVERAGE}"`);
  });

  it("signs up only at addresses the app probe's deleteSignUp accepts", () => {
    for (const nonce of ["n0nce", "S35-2026-10-31T09_00-2", "--Run.ID--"]) {
      expect(signUpAddress("S32", nonce)).toMatch(SIGN_UP_ADDRESS);
      expect(signUpAddress("S35", nonce)).toMatch(SIGN_UP_ADDRESS);
    }
  });

  it("prices a graduated tier the way Stripe does", () => {
    const starter = [
      { up_to: 500, unit_amount: 0 },
      { up_to: null, unit_amount: 3 },
    ];
    expect(graduatedAmount(starter, 0)).toBe(0);
    expect(graduatedAmount(starter, 500)).toBe(0);
    expect(graduatedAmount(starter, S29_SEGMENTS)).toBe(30);
    const pro = [
      { up_to: 2500, unit_amount: 0 },
      { up_to: null, unit_amount_decimal: "2.5" },
    ];
    expect(graduatedAmount(pro, 2_510)).toBe(25);
    expect(graduatedAmount([{ up_to: null, unit_amount: 1, flat_amount: 100 }], 5)).toBe(105);
  });
});
