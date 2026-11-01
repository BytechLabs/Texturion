/**
 * The account scenarios: picture messages (S22), the website widget (S27),
 * the month's number from purchase to release (S28, S29), Lou's drafts and
 * their cap (S31), sign-up, Checkout and the portal (S32, S35), two-factor
 * sign-in (S33) and mail (S34). Only S28 dials, once, to ring the number it
 * bought.
 */
import { randomBytes } from "node:crypto";
import type { GuardHealth } from "@loonext/rig-protocol";
import { gpsJpeg, hasGpsExif, NUMBER_ID_PREFIX, sha256Hex } from "@loonext/rig-robot";
import { memberEmail } from "../../../../../scripts/rig/tenants.mjs";
import { deleteStripeObject, STRIPE_DELETE_UNDO } from "../stripe-sandbox.ts";
import {
  fail,
  infra,
  pass,
  poll,
  type ApiAnswer,
  type MailMessage,
  type NumberHandoff,
  type NumberRow,
  type PublicPageApi,
  type ScenarioContext,
  type ScenarioResult,
  type ScenarioRunner,
  type SendResult,
} from "./context.ts";

/** The bucket both directions of a picture message are stored in, and the edge relays Telnyx's fetch from. */
const MEDIA_BUCKET = "mms-media";

/** The grace workspace: it holds no standing number, so grace may release all it holds. */
const GRACE_TENANT = "QA-G";
/** The API's grace-and-release cron (apps/api/src/index.ts). */
export const GRACE_CRON = "0 14 * * *";
/** The 1, 15 and 27-day warnings, then the day-30 release notice (apps/api/src/billing/grace.ts). */
export const GRACE_NOTICES = [1, 15, 27, 30] as const;
/** One day past the 30-day grace period. */
const CANCELED_DAYS_AGO = 31;
const DAY_MS = 86_400_000;
/** S29 runs the day after S28; a hand-off older than this one missed it. */
const HANDOFF_MAX_AGE_MS = 2 * DAY_MS;

/** Lou's reply drafts, as apps/api/src/messaging/reply-suggestions.ts meters them. */
export const SUGGEST_REPLY_FEATURE = "suggest_reply";
export const SUGGEST_REPLY_MONTHLY_CAP = 1500;
/** The guard's AI day (tools/guard/src/limits.ts); a spent day refuses the model, not the app. */
const GUARD_AI_NEURONS_PER_DAY = 2_000;

/** The rig's always-pass Turnstile secret accepts any token, this one included. */
export const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const WIDGET_CODE = /\b(\d{6})\b/;

export const STRIPE_TEST_CARD = "4242424242424242";
/** The Starter plan and its segment meter, by the lookup keys apps/api/scripts/stripe-setup.ts gives them. */
export const STARTER_LICENSED = "loonext_starter_licensed";
export const STARTER_OVERAGE = "loonext_starter_overage";
export const SMS_METER_EVENT = "sms_segments";
/** Past Starter's 500 included segments, so the renewal invoice has an overage to get right. */
export const S29_SEGMENTS = 510;

const SEARCH = "GET /v2/available_phone_numbers";
const ORDER = "POST /v2/number_orders";
const RELEASE = "DELETE /v2/phone_numbers/:id";
/** What binding a bought number PATCHes: its connection, and its caller name. */
const BINDING_PATCHES: ReadonlySet<string> = new Set(["PATCH /v2/phone_numbers/:id", "PATCH /v2/phone_numbers/:id/voice"]);
/** The guard's one-search, one-order-per-interval rules: a retry after a spent attempt hits these. */
const INTERVAL_RULES: ReadonlySet<string> = new Set(["provisioning.order_interval", "provisioning.search_rate"]);

function mailboxReady(health: GuardHealth): boolean {
  return health.mail?.heartbeat_fresh === true && !health.mail.halted;
}

const is2xx = (status: number) => status >= 200 && status < 300;

/** A nonce as an address or tag allows it: lower case, letters, digits and dashes. */
function slug(nonce: string): string {
  return nonce.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "run";
}

/** S22: a picture each way. Out, Telnyx fetched the app's own copy; in, the app stored it without its GPS position. */
export const S22: ScenarioRunner = {
  id: "S22",
  async run(ctx) {
    return (await outboundPicture(ctx)) ?? (await inboundPicture(ctx)) ?? pass();
  },
};

async function outboundPicture(ctx: ScenarioContext): Promise<ScenarioResult | undefined> {
  const since = ctx.now();
  const body = `Rig S22 outbound ${ctx.nonce}`;
  let sent: SendResult;
  try {
    sent = await ctx.app.sendMms({
      member: "qa-w-owner",
      fromRole: "DEV-W1",
      toRole: "ROBOT-1",
      body,
      media: { bytes: gpsJpeg(), contentType: "image/jpeg" },
    });
  } catch (error) {
    return infra("app-probe", `the picture message could not be sent: ${(error as Error).message}`);
  }
  if (!sent.ok) return fail("send_refused", `the API refused the picture message with ${sent.status}${sent.code ? ` ${sent.code}` : ""}`);
  const messageId = sent.messageId;
  const evidence: Record<string, unknown> = { message_id: messageId };
  ctx.evidence.outbound = evidence;

  const arrived = await poll(ctx, async () => {
    const inbox = await ctx.robot.inbox({ to_role: "ROBOT-1", since });
    return inbox.find((m) => m.event === "message.received" && m.text === body);
  }, 90_000, 2_000);
  if (!arrived) return fail("picture_not_delivered", "ROBOT-1 did not receive the picture message within 90 s");
  if (arrived.from_role !== "DEV-W1") return fail("wrong_sender", `the picture arrived from ${arrived.from_role}, not DEV-W1`);
  const media = arrived.media?.[0];
  if (!media) return fail("media_missing", "the message reached ROBOT-1 without its picture");
  if (!media.sha256) return infra("telnyx-media-hash", "Telnyx reported no hash for the picture it fetched; its hash_sha256 field is unverified");

  const attachment = await poll(ctx, async () => (await ctx.app.attachments(messageId))[0], 30_000, 2_000);
  if (!attachment) return fail("no_attachment_row", "the API kept no attachment row for the picture it sent");
  const stored = await ctx.app.storedObject({ bucket: MEDIA_BUCKET, path: attachment.storage_path });
  const match = sha256Hex(stored) === media.sha256;
  Object.assign(evidence, { hash_match: match, telnyx_size: media.size, stored_size: stored.length });
  // Equal hashes are the proof Telnyx fetched the app's own copy, through the edge's relay of the bucket.
  if (!match) return fail("media_hash_mismatch", "Telnyx fetched different bytes from the copy the app stored");
  return undefined;
}

async function inboundPicture(ctx: ScenarioContext): Promise<ScenarioResult | undefined> {
  const since = ctx.now();
  const body = `Rig S22 inbound ${ctx.nonce}`;
  await ctx.robot.sms({ from_role: "ROBOT-1", to_role: "DEV-W1", text: body, scenario: ctx.scenario, media: "gps-jpeg" });

  const row = await poll(ctx, async () => {
    const rows = await ctx.app.messages({ tenant: "QA-W", body, since });
    return rows.find((r) => r.direction === "inbound");
  }, 60_000, 2_000);
  if (!row) return fail("picture_not_threaded", "the picture message from ROBOT-1 was not threaded within 60 s");
  const attachment = await poll(ctx, async () => (await ctx.app.attachments(row.id))[0], 30_000, 2_000);
  if (!attachment) return fail("picture_not_stored", "the inbound picture message was threaded with no attachment");
  const stored = await ctx.app.storedObject({ bucket: MEDIA_BUCKET, path: attachment.storage_path });
  const gps = hasGpsExif(stored);
  ctx.evidence.inbound = {
    message_id: row.id,
    size_bytes: attachment.size_bytes,
    content_type: attachment.content_type,
    gps_kept: gps,
    quarantined: attachment.quarantined_at !== null,
  };
  // hasGpsExif is false for anything that is not a JPEG, so the check means nothing until the bytes are one.
  if (stored[0] !== 0xff || stored[1] !== 0xd8) return fail("stored_picture_not_jpeg", "the stored copy of the picture is not a JPEG");
  if (gps) return fail("gps_kept", "the stored picture still carries its GPS position");
  if (attachment.quarantined_at !== null) return fail("picture_quarantined", "the scan held a plain JPEG");
  return undefined;
}

/** S27: the widget refuses a start with no Turnstile token, texts ROBOT-1 a code for one with a token, and takes the code back. */
export const S27: ScenarioRunner = {
  id: "S27",
  async run(ctx) {
    const since = ctx.now();
    const before = await ctx.app.widgetVerifications({ tenant: "QA-W", since });
    // The always-pass secret accepts any token, so a missing one is the only refusal the server can show.
    const blocked = await ctx.app.widgetStart({ tenant: "QA-W", phoneRole: "ROBOT-1" });
    ctx.evidence.without_token = { status: blocked.status, code: blocked.code };
    if (blocked.status === 429) return infra("widget-limit", "the widget's per-IP limit refused the start");
    if (blocked.status < 400 || blocked.body?.verificationId) {
      return fail("captcha_not_required", `the widget answered ${blocked.status} to a start with no Turnstile token`);
    }

    const started = await ctx.app.widgetStart({ tenant: "QA-W", phoneRole: "ROBOT-1", turnstileToken: TURNSTILE_TEST_TOKEN });
    ctx.evidence.start = { status: started.status, code: started.code };
    if (started.status === 429) return infra("widget-limit", "the widget's per-IP limit refused the start");
    const verificationId = started.body?.verificationId;
    if (started.status !== 202 || !verificationId) {
      return fail("widget_start_refused", `the widget answered ${started.status}${started.code ? ` ${started.code}` : ""} to a start with a token`);
    }
    ctx.evidence.verification_id = verificationId;

    const texted = await poll(ctx, async () => {
      const inbox = await ctx.robot.inbox({ to_role: "ROBOT-1", since });
      return inbox.find((m) => m.event === "message.received" && m.from_role === "DEV-W1" && WIDGET_CODE.test(m.text));
    }, 60_000, 2_000);
    if (!texted) return fail("code_not_delivered", "ROBOT-1 got no widget code from DEV-W1 within 60 s");
    ctx.evidence.code_ms = texted.received_at - since;

    const code = WIDGET_CODE.exec(texted.text)![1]!;
    const verified = await ctx.app.widgetVerify({ verificationId, code, message: `Rig S27 widget ${ctx.nonce}` });
    ctx.evidence.verify = { status: verified.status, code: verified.code };
    if (verified.status === 429) return infra("widget-limit", "the widget's per-IP limit refused the verify");
    if (!is2xx(verified.status)) return fail("code_refused", `the widget answered ${verified.status}${verified.code ? ` ${verified.code}` : ""} to the code it texted`);

    const after = await ctx.app.widgetVerifications({ tenant: "QA-W", since });
    ctx.evidence.verifications = { before, after };
    if (after <= before) return fail("budget_not_decremented", "the code was sent but no widget verification was counted against the budget");
    return pass();
  },
};

/**
 * S28: QA-G buys the month's number, the guard sees exactly the purchase and
 * binding, and ROBOT-1 rings it. A passing run hands the number to S29
 * instead of releasing it; until then the undo releases whatever QA-G holds.
 */
export const S28: ScenarioRunner = {
  id: "S28",
  async run(ctx) {
    ctx.lease.registerUndo({ kind: "number.release-tenant", params: { tenant: GRACE_TENANT, unless_handed_off: true } });
    const unclaimed = await reclaimHandoff(ctx);
    if (unclaimed) return unclaimed;
    const workspace = await ctx.app.graceState({ tenant: GRACE_TENANT });
    if (workspace.subscription_status !== "active") {
      return infra("grace-workspace", `QA-G is ${workspace.subscription_status}, so it cannot buy; an earlier S29's undo did not put it back`);
    }
    const kept = workspace.numbers.filter((row) => row.status !== "released");
    if (kept.length > 0) return infra("grace-workspace", `QA-G still holds ${kept.length} number(s) that are not released`);
    const blockers = (await ctx.guard.health()).ordering?.blockers;
    if (!blockers) return infra("guard", "the guard's health reports no ordering state");
    if (blockers.length > 0) return infra("guard", `number ordering is off: ${blockers.join(", ")}`);
    const partition = await ctx.guard.partition();

    let provisioned: ApiAnswer<{ id?: string }>;
    try {
      provisioned = await ctx.app.provisionNumber({ member: "qa-g-owner" });
    } catch (error) {
      return infra("app-probe", `the purchase could not be asked for: ${(error as Error).message}`);
    }
    ctx.evidence.provision = { status: provisioned.status, code: provisioned.code };
    if (!is2xx(provisioned.status)) return refusedPurchase(ctx, provisioned);
    const rowId = provisioned.body?.id;

    // The hand-off names the number as soon as its row does, not once binding finishes.
    const bought: { held?: NumberHandoff } = {};
    const bound = await poll(ctx, async () => {
      const rows = await ctx.app.numberRows({ tenant: GRACE_TENANT });
      const row = rows.find((r) => (rowId ? r.id === rowId : r.status !== "released"));
      if (row?.telnyx_phone_number_id && !bought.held) bought.held = await holdNumber(ctx, row, row.telnyx_phone_number_id);
      return row?.status === "active" && row.telnyx_phone_number_id && row.voice_connection_id ? row : undefined;
    }, 180_000, 5_000);
    const number = bought.held;
    if (!number) return fail("number_not_provisioned", "no number row named a Telnyx number within 3 min of the purchase");
    ctx.evidence.number = { phone_number_id: number.phone_number_id, telnyx_phone_number_id: number.telnyx_phone_number_id };
    if (!bound) return fail("number_not_bound", "the number never became active with a voice connection");

    const purchase = judgePurchase(ctx, (await ctx.guard.activity(ctx.lease.id)).activity);
    if (purchase) return purchase;
    const group = await groupCheck(ctx, number.telnyx_phone_number_id, partition.standing);
    if (group) return group;

    const page = await ctx.browser.open("qa-g-owner", "qa-c", "/");
    const dialed = await ctx.robot.dial({
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      direction: "outbound",
      role: "ROBOT-1",
      to: `${NUMBER_ID_PREFIX}${number.telnyx_phone_number_id}`,
      play: null,
      record: false,
      // Ringing is the whole check, so the robot gives up before anything answers.
      hangup_before_answer_ms: 20_000,
      hangup_after_ms: 1_000,
      ring_timeout_secs: 30,
    });
    if (dialed.state === "failed") {
      const refusal = dialed.errors.find((e) => e.startsWith("guard_refused:"));
      return infra(refusal ? "guard" : "robot", dialed.errors.join("; "));
    }
    const ringMs = await page.waitForRing(15_000);
    const record = await ctx.robot.wait(dialed.plan_id, 60_000);
    ctx.evidence.ring = { ring_ms: ringMs, ids: record.ids, state: record.state, errors: record.errors };
    if (ringMs === undefined) return fail("number_did_not_ring", "the QA-G owner's page did not ring within 15 s of ROBOT-1 calling the new number");

    await ctx.handoff.write({ ...number, state: "handed_off" });
    return pass();
  },
};

async function holdNumber(ctx: ScenarioContext, row: NumberRow, telnyxId: string): Promise<NumberHandoff> {
  const record: NumberHandoff = {
    tenant: GRACE_TENANT,
    run_id: ctx.runId,
    telnyx_phone_number_id: telnyxId,
    phone_number_id: row.id,
    bought_at: new Date(ctx.now()).toISOString(),
    state: "bought",
  };
  await ctx.handoff.write(record);
  return record;
}

/** A number handed to S29 that no S29 took in time is taken back, for this run's undo to release. */
async function reclaimHandoff(ctx: ScenarioContext): Promise<ScenarioResult | undefined> {
  const record = await ctx.handoff.read();
  if (record?.tenant !== GRACE_TENANT || record.state !== "handed_off") return undefined;
  if (ctx.now() - Date.parse(record.bought_at) <= HANDOFF_MAX_AGE_MS) return undefined;
  await ctx.handoff.write({ ...record, run_id: ctx.runId, state: "bought" });
  return infra("handoff", `no S29 took the number S28 handed off at ${record.bought_at}; this run's undo releases it`);
}

interface ActivityEntry {
  caller: string;
  endpoint: string;
  outcome: string;
  count: number;
}

/** The lease's log, `<caller> <METHOD> <path> <outcome>`, split back into its parts. */
function activityEntries(activity: Record<string, number>): ActivityEntry[] {
  return Object.entries(activity).map(([key, count]) => {
    const [caller = "", method = "", path = "", ...outcome] = key.split(" ");
    return { caller, endpoint: `${method} ${path}`, outcome: outcome.join(" "), count };
  });
}

async function refusedPurchase(ctx: ScenarioContext, answer: ApiAnswer): Promise<ScenarioResult> {
  const entries = activityEntries((await ctx.guard.activity(ctx.lease.id)).activity);
  const rules = entries.filter((e) => (e.endpoint === SEARCH || e.endpoint === ORDER) && !/^\d+$/.test(e.outcome)).map((e) => e.outcome);
  ctx.evidence.refusals = rules;
  const interval = rules.find((rule) => INTERVAL_RULES.has(rule));
  if (interval) return infra(interval, "the guard allows one purchase per interval, so this attempt cannot buy again");
  if (rules.length > 0) return infra("guard", `the guard refused the purchase: ${rules.join(", ")}`);
  return fail("provision_refused", `the API refused the purchase with ${answer.status}${answer.code ? ` ${answer.code}` : ""}`);
}

function judgePurchase(ctx: ScenarioContext, activity: Record<string, number>): ScenarioResult | undefined {
  const entries = activityEntries(activity);
  const total = (endpoint: string) => entries.filter((e) => e.endpoint === endpoint).reduce((sum, e) => sum + e.count, 0);
  const accepted = (endpoint: string) =>
    entries.filter((e) => e.endpoint === endpoint && e.caller === "rig-api" && /^2\d\d$/.test(e.outcome)).reduce((sum, e) => sum + e.count, 0);
  const patches = entries.filter((e) => e.endpoint.startsWith("PATCH "));
  ctx.evidence.activity = {
    searches: total(SEARCH),
    orders: total(ORDER),
    releases: total(RELEASE),
    patches: Object.fromEntries(patches.map((e) => [`${e.endpoint} ${e.outcome}`, e.count])),
  };
  // A number came back with no order at the guard: the app bought it some other way, outside the partition's checks.
  if (total(ORDER) === 0) return fail("order_bypassed_guard", "a number was bought but no order reached the guard", { critical: true });
  if (total(ORDER) !== 1 || accepted(ORDER) !== 1) {
    return fail("order_count", `the guard saw ${total(ORDER)} order(s), ${accepted(ORDER)} accepted; one was expected`);
  }
  if (total(SEARCH) !== 1 || accepted(SEARCH) !== 1) {
    return fail("search_count", `the guard saw ${total(SEARCH)} search(es), ${accepted(SEARCH)} accepted; one was expected`);
  }
  if (total(RELEASE) > 0) return fail("number_released_during_run", `the guard saw ${total(RELEASE)} release(s) of a number during the purchase`);
  const stray = patches.filter((e) => !BINDING_PATCHES.has(e.endpoint) || !/^2\d\d$/.test(e.outcome));
  if (stray.length > 0) {
    return fail("unexpected_patch", `the guard saw ${stray.map((e) => `${e.endpoint} ${e.outcome}`).join(", ")}; only binding's PATCHes were expected`);
  }
  return undefined;
}

/**
 * The number is in the partition's billing group, which production's sweep
 * leaves alone, and no standing number changed. The guard reads its first
 * order back only at its hourly upkeep, so a pending read-back is recorded
 * rather than judged: the number's own status answers the same question now.
 */
async function groupCheck(ctx: ScenarioContext, telnyxId: string, standingBefore: number): Promise<ScenarioResult | undefined> {
  let blockers = (await ctx.guard.health()).ordering?.blockers ?? [];
  if (blockers.includes("first_order_unverified")) {
    blockers = (await poll(ctx, async () => {
      const now = (await ctx.guard.health()).ordering?.blockers ?? [];
      return now.includes("first_order_unverified") ? undefined : now;
    }, 60_000, 5_000)) ?? blockers;
  }
  ctx.evidence.ordering_blockers = blockers;
  if (blockers.includes("stopped_after_group_check")) {
    return fail("order_left_group", "the guard read the order back outside the partition's billing group and stopped ordering", { critical: true });
  }
  const status = await ctx.guard.numberStatus(telnyxId);
  ctx.evidence.number_status = status;
  if (status.status !== 200 || !status.in_group) {
    return fail("number_outside_group", `the guard answered ${status.status} for the new number, so it is not held in the partition's group`, { critical: true });
  }
  const standing = (await ctx.guard.partition()).standing;
  ctx.evidence.standing = { before: standingBefore, after: standing };
  if (standing !== standingBefore) {
    return fail("standing_number_touched", `the partition held ${standingBefore} standing numbers before the purchase and ${standing} after`, { critical: true });
  }
  return undefined;
}

/**
 * S29: takes over the number S28 handed off, cancels QA-G 31 days ago, fires
 * the grace cron and judges the release and the notices. Separately, a
 * customer on a Stripe test clock checks a renewal invoice against its usage.
 */
export const S29: ScenarioRunner = {
  id: "S29",
  async run(ctx) {
    const grace = await graceAndRelease(ctx);
    const billing = await billingTotals(ctx);
    return worst([grace, billing]);
  },
};

const severity = (result: ScenarioResult) =>
  result.outcome === "fail" ? (result.critical ? 0 : 1) : result.outcome === "infra" ? 2 : result.outcome === "preempted" ? 3 : 4;

/** The most severe of independent halves; the earlier one on a tie. */
function worst(results: ScenarioResult[]): ScenarioResult {
  return results.reduce((a, b) => (severity(b) < severity(a) ? b : a));
}

async function graceAndRelease(ctx: ScenarioContext): Promise<ScenarioResult> {
  const record = await ctx.handoff.read();
  // `taken` is an earlier S29 attempt's, whose undo did not finish; this one takes it again.
  const number = record?.tenant === GRACE_TENANT && (record.state === "handed_off" || record.state === "taken") ? record : null;
  if (number) {
    ctx.lease.registerUndo({
      kind: "number.release",
      params: { telnyx_phone_number_id: number.telnyx_phone_number_id, phone_number_id: number.phone_number_id },
    });
    await ctx.handoff.write({ ...number, state: "taken" });
  }
  ctx.evidence.handoff = number
    ? { run_id: number.run_id, phone_number_id: number.phone_number_id, telnyx_phone_number_id: number.telnyx_phone_number_id, was: record?.state }
    : { state: record?.state ?? null };

  const before = await ctx.app.graceState({ tenant: GRACE_TENANT });
  if (before.subscription_status !== "active") {
    return infra("grace-workspace", `QA-G is ${before.subscription_status} before the run, so an earlier undo did not put it back`);
  }
  const heldRow = number ? before.numbers.find((row) => row.id === number.phone_number_id && row.status !== "released") : undefined;
  const standingBefore = (await ctx.guard.partition()).standing;

  ctx.lease.registerUndo({
    kind: "app.restore-workspace",
    params: { tenant: GRACE_TENANT, state: { subscription_status: before.subscription_status, canceled_at: before.canceled_at } },
  });
  await ctx.app.backdateCancellation({ tenant: GRACE_TENANT, daysAgo: CANCELED_DAYS_AGO });
  let cronError: string | undefined;
  try {
    await ctx.app.fireCron(GRACE_CRON);
  } catch (error) {
    cronError = (error as Error).message;
  }
  const settled = await poll(ctx, async () => {
    const state = await ctx.app.graceState({ tenant: GRACE_TENANT });
    return state.notices.includes(30) ? state : undefined;
  }, 120_000, 5_000);
  const after = settled ?? (await ctx.app.graceState({ tenant: GRACE_TENANT }));
  const row = number ? after.numbers.find((r) => r.id === number.phone_number_id) : undefined;
  ctx.evidence.grace = {
    notices: after.notices,
    live_campaigns_before: before.live_campaigns,
    live_campaigns: after.live_campaigns,
    subscription_status: after.subscription_status,
    number_status: row?.status ?? null,
    ...(cronError ? { cron_error: cronError } : {}),
  };
  const because = cronError ? ` (the cron answered: ${cronError})` : "";
  const release = await judgeRelease(ctx, number, { held: Boolean(heldRow), row }, because);

  const standing = (await ctx.guard.partition()).standing;
  if (standing !== standingBefore) {
    return fail("standing_number_touched", `grace left ${standing} standing numbers where there were ${standingBefore}`, { critical: true });
  }
  if (after.notices.join(",") !== GRACE_NOTICES.join(",")) {
    return fail("grace_notices", `grace ledgered ${after.notices.join(", ") || "no"} notices, not ${GRACE_NOTICES.join(", ")}${because}`);
  }
  if (after.live_campaigns !== 0) return fail("campaign_still_live", `${after.live_campaigns} campaign(s) are still live after the release${because}`);
  if (release) return release;
  // Rig mode refuses /v2/10dlc, so QA-G never holds a campaign for grace to deactivate.
  return before.live_campaigns === 0 ? pass("QA-G held no live campaign, so its deactivation was not covered") : pass();
}

/**
 * The release half, kept in the evidence as judged. A retry has no number to
 * judge, since the first attempt's undo released it, so it takes that
 * attempt's judgement rather than reporting S28's hand-off as missing.
 */
async function judgeRelease(
  ctx: ScenarioContext,
  number: NumberHandoff | null,
  grace: { held: boolean; row: NumberRow | undefined },
  because: string,
): Promise<ScenarioResult | undefined> {
  if (!number) {
    const earlier = await earlierRelease(ctx);
    if (earlier !== null) return earlier;
    return infra("s28-handoff", "S28 handed off no number: grace ran and its notices and campaigns were judged, but the release half was not covered");
  }
  if (!grace.held) return infra("s28-handoff", "QA-G did not hold the number S28 handed off, so the release half was not covered");
  let result: ScenarioResult | undefined;
  if (grace.row?.status !== "released") result = fail("number_not_released", `the number's row reads ${grace.row?.status ?? "nothing"} after grace${because}`);
  else {
    const status = await ctx.guard.numberStatus(number.telnyx_phone_number_id);
    ctx.evidence.number_lookup = status.status;
    if (status.status !== 404) result = fail("telnyx_number_kept", `the guard still answers ${status.status} for the released number`);
  }
  ctx.evidence.release = result ?? { outcome: "pass" };
  return result;
}

/** This run's earlier judgement of the release: a failure, undefined for a pass, or null when no attempt made one. */
async function earlierRelease(ctx: ScenarioContext): Promise<ScenarioResult | undefined | null> {
  if (ctx.attempt === 1) return null;
  const attempts = await ctx.history.attempts({ since: ctx.now() - DAY_MS });
  const earlier = attempts.find((a) => a.run_id === ctx.runId && a.attempt < ctx.attempt && a.evidence?.release);
  const judged = earlier?.evidence?.release as ScenarioResult | undefined;
  if (!earlier || !judged) return null;
  ctx.evidence.release_judged_on_attempt = earlier.attempt;
  if (judged.outcome !== "fail") return undefined;
  return fail(judged.failure_class, `on attempt ${earlier.attempt}, which took the number: ${judged.detail}`);
}

interface StripeTier {
  up_to: number | null;
  unit_amount?: number | null;
  unit_amount_decimal?: string | null;
  flat_amount?: number | null;
  flat_amount_decimal?: string | null;
}

interface StripePrice {
  id: string;
  lookup_key?: string | null;
  unit_amount?: number | null;
  recurring?: { meter?: string | null } | null;
  tiers?: StripeTier[];
}

/** What a graduated tiered price charges for a quantity, in cents. */
export function graduatedAmount(tiers: readonly StripeTier[], quantity: number): number {
  let total = 0;
  let floor = 0;
  for (const tier of tiers) {
    if (quantity <= floor) break;
    const ceiling = tier.up_to ?? Infinity;
    const units = Math.min(quantity, ceiling) - floor;
    const unit = tier.unit_amount_decimal != null ? Number(tier.unit_amount_decimal) : (tier.unit_amount ?? 0);
    const flat = tier.flat_amount_decimal != null ? Number(tier.flat_amount_decimal) : (tier.flat_amount ?? 0);
    total += units * unit + flat;
    floor = ceiling;
  }
  return Math.round(total);
}

async function billingTotals(ctx: ScenarioContext): Promise<ScenarioResult> {
  let clockPath: string | undefined;
  try {
    const catalog = await ctx.stripe.request<{ data?: StripePrice[] }>("GET", "/v1/prices", {
      lookup_keys: [STARTER_LICENSED, STARTER_OVERAGE],
      expand: ["data.tiers"],
    });
    const licensed = catalog.data?.find((price) => price.lookup_key === STARTER_LICENSED);
    const overage = catalog.data?.find((price) => price.lookup_key === STARTER_OVERAGE);
    const meter = overage?.recurring?.meter;
    if (typeof licensed?.unit_amount !== "number" || !overage?.tiers?.length || !meter) {
      return infra("stripe-catalog", "the sandbox has no Starter plan and segment meter to bill against (apps/api/scripts/stripe-setup.ts makes them)");
    }

    const frozen = Math.floor(ctx.now() / 1000);
    const clock = await ctx.stripe.request<{ id?: string }>("POST", "/v1/test_helpers/test_clocks", { frozen_time: frozen, name: `Rig S29 ${ctx.nonce}` });
    if (!clock.id) return infra("stripe", "the sandbox made no test clock");
    clockPath = `/v1/test_helpers/test_clocks/${clock.id}`;
    ctx.lease.registerUndo({ kind: STRIPE_DELETE_UNDO, params: { path: clockPath } });
    const evidence: Record<string, unknown> = { clock_id: clock.id, segments: S29_SEGMENTS };
    ctx.evidence.billing = evidence;

    const customer = await ctx.stripe.request<{ id?: string }>("POST", "/v1/customers", {
      name: `Rig S29 ${ctx.nonce}`,
      test_clock: clock.id,
      metadata: { rig_nonce: ctx.nonce },
    });
    if (!customer.id) return infra("stripe", "the sandbox made no customer");
    // Sent invoices need no payment method, so the subscription is active from the start and renews.
    await ctx.stripe.request("POST", "/v1/subscriptions", {
      customer: customer.id,
      items: [{ price: licensed.id }, { price: overage.id }],
      collection_method: "send_invoice",
      days_until_due: 30,
      metadata: { rig_nonce: ctx.nonce },
    });
    await ctx.stripe.request("POST", "/v1/billing/meter_events", {
      event_name: SMS_METER_EVENT,
      timestamp: frozen,
      identifier: `rig-s29-${ctx.nonce}`,
      payload: { stripe_customer_id: customer.id, value: String(S29_SEGMENTS) },
    });

    // Meter events aggregate asynchronously; advancing before they count would bill nothing.
    const start = frozen - (frozen % 60);
    const counted = await poll(ctx, async () => {
      const summaries = await ctx.stripe.request<{ data?: { aggregated_value?: number }[] }>("GET", `/v1/billing/meters/${meter}/event_summaries`, {
        customer: customer.id,
        start_time: start,
        end_time: start + 3_600,
      });
      const sum = (summaries.data ?? []).reduce((total, summary) => total + (summary.aggregated_value ?? 0), 0);
      return sum >= S29_SEGMENTS ? sum : undefined;
    }, 120_000, 5_000);
    evidence.metered = counted ?? null;
    if (counted === undefined) return infra("stripe", "the meter had not counted the usage 2 minutes after it was reported");

    await ctx.stripe.request("POST", `${clockPath}/advance`, { frozen_time: frozen + 32 * 86_400 });
    const advanced = await poll(ctx, async () => {
      const state = await ctx.stripe.request<{ status?: string }>("GET", clockPath!);
      if (state.status === "internal_failure") throw new Error("the test clock failed while advancing");
      return state.status === "ready" ? true : undefined;
    }, 300_000, 5_000);
    if (!advanced) return infra("stripe", "the test clock had not finished advancing after 5 minutes");

    const invoices = await ctx.stripe.request<{ data?: { id?: string; billing_reason?: string; subtotal?: number }[] }>("GET", "/v1/invoices", {
      customer: customer.id,
      limit: 10,
    });
    const renewal = invoices.data?.find((invoice) => invoice.billing_reason === "subscription_cycle");
    const expected = licensed.unit_amount + graduatedAmount(overage.tiers, S29_SEGMENTS);
    Object.assign(evidence, { invoice_id: renewal?.id ?? null, expected_cents: expected, invoiced_cents: renewal?.subtotal ?? null });
    if (!renewal) return fail("no_renewal_invoice", "advancing the clock a month made no renewal invoice");
    if (renewal.subtotal !== expected) {
      return fail("invoice_total_mismatch", `the renewal came to ${renewal.subtotal} cents before tax, not ${expected} for the plan and ${S29_SEGMENTS} segments`);
    }
    return pass();
  } catch (error) {
    return infra("stripe", (error as Error).message);
  } finally {
    if (clockPath) await removeFromSandbox(ctx, clockPath);
  }
}

async function removeFromSandbox(ctx: ScenarioContext, path: string): Promise<void> {
  try {
    await deleteStripeObject(ctx.stripe, { path });
  } catch (error) {
    ctx.evidence.stripe_cleanup_error = (error as Error).message;
  }
}

/** Reasons the app gives for no draft that are the rig's setup or limits, not Lou. */
const DRAFT_SETUP_REASONS: ReadonlySet<string> = new Set(["disabled", "unavailable", "rate_limited", "subscription_inactive", "nothing_to_reply", "spam"]);

function draftOf(answer: ApiAnswer<{ suggestions?: unknown[]; reason?: string }>) {
  const body = answer.body;
  return { status: answer.status, drafts: Array.isArray(body?.suggestions) ? body.suggestions.length : 0, reason: body?.reason ?? null };
}

function draftCount(rows: { feature: string; request_count: number }[]): number | null {
  return rows.find((row) => row.feature === SUGGEST_REPLY_FEATURE)?.request_count ?? null;
}

const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);

/** S31: a draft comes back through the guard and is counted, and a request seeded at the cap is refused. */
export const S31: ScenarioRunner = {
  id: "S31",
  async run(ctx) {
    const neuronsBefore = (await ctx.guard.health()).ai_neurons_today;
    if (neuronsBefore === undefined) return infra("guard", "the guard's health reports no AI neuron count");
    if (neuronsBefore >= GUARD_AI_NEURONS_PER_DAY) return infra("guard", `the guard's AI day is spent (${neuronsBefore} neurons)`);
    const countBefore = draftCount(await ctx.app.aiUsage({ tenant: "QA-W" }));
    const dayBefore = utcDay(ctx.now());

    const first = draftOf(await ctx.app.replySuggestions({ member: "qa-w-owner", withRole: "ROBOT-1" }));
    ctx.evidence.draft = first;
    if (first.reason === "over_cap") return infra("ai-usage", "QA-W was already at its draft cap before the run, so an earlier undo did not put the count back");
    if (first.reason && DRAFT_SETUP_REASONS.has(first.reason)) return infra("reply-suggestions", `Lou offered no draft: ${first.reason}`);
    if (first.status !== 200) return fail("suggestions_refused", `reply suggestions answered ${first.status}`);
    if (first.drafts === 0) return fail("no_draft", `no draft came back (${first.reason ?? "no reason given"}; ${neuronsBefore} AI neurons spent today)`);

    const neuronsAfter = (await ctx.guard.health()).ai_neurons_today ?? 0;
    const crossedDay = utcDay(ctx.now()) !== dayBefore;
    ctx.evidence.neurons = { before: neuronsBefore, after: neuronsAfter };
    // The rig's Workers AI binding bills production's account, so a draft the guard never metered went around it.
    if (!(neuronsAfter > neuronsBefore || (crossedDay && neuronsAfter > 0))) {
      return fail("draft_bypassed_guard", "a draft came back but the guard's AI neuron count did not move", { critical: true });
    }
    const countAfter = draftCount(await ctx.app.aiUsage({ tenant: "QA-W" }));
    ctx.evidence.usage = { before: countBefore, after: countAfter };
    if ((countAfter ?? 0) <= (countBefore ?? 0)) return fail("usage_not_counted", `the ${SUGGEST_REPLY_FEATURE} count did not rise for the draft`);

    ctx.lease.registerUndo({ kind: "app.ai-usage", params: { tenant: "QA-W", feature: SUGGEST_REPLY_FEATURE, requestCount: countAfter } });
    await ctx.app.seedAiUsage({ tenant: "QA-W", feature: SUGGEST_REPLY_FEATURE, requestCount: SUGGEST_REPLY_MONTHLY_CAP });
    const capped = draftOf(await ctx.app.replySuggestions({ member: "qa-w-owner", withRole: "ROBOT-1" }));
    ctx.evidence.capped = capped;
    if (capped.reason === "rate_limited") return infra("reply-suggestions", "the draft at the cap was rate limited, so the cap was not reached");
    if (capped.drafts > 0 || capped.reason !== "over_cap") {
      return fail("cap_not_enforced", `a request at the cap of ${SUGGEST_REPLY_MONTHLY_CAP} answered ${capped.status} with ${capped.drafts} draft(s) (${capped.reason ?? "no reason"})`);
    }
    return pass();
  },
};

/** The address S32 and S35 sign up with; the app probe's deleteSignUp removes nothing else. */
export function signUpAddress(scenario: "S32" | "S35", nonce: string): string {
  return `delivered+rig-${scenario.toLowerCase()}-${slug(nonce)}@resend.dev`;
}

/** The sign-up's password: made per run, typed once, kept nowhere. */
function oneTimePassword(): string {
  return `${randomBytes(18).toString("base64url")}Aa1`;
}

/** The confirmation link, which Supabase Auth sends to its verify endpoint. */
function confirmationLink(mail: MailMessage): string {
  return mail.links.find((link) => /\/auth\/v1\/verify|confirm/i.test(link)) ?? mail.links[0]!;
}

const outsideApp = (path: string) => /^\/(login|signup)(\/|$|\?)/.test(path);

/** The public sign-up, confirmed from Mailpit, leaving the page signed in as the new owner. */
async function signUpAndConfirm(ctx: ScenarioContext, scenario: "S32" | "S35"): Promise<{ page: PublicPageApi; email: string } | ScenarioResult> {
  const email = signUpAddress(scenario, ctx.nonce);
  ctx.lease.registerUndo({ kind: "app.delete-sign-up", params: { email } });
  const since = ctx.now();
  const page = await ctx.browser.openPublic("/signup");
  const signedUp = await page.signUp({ email, password: oneTimePassword(), name: `Rig ${scenario} ${ctx.nonce}` });
  ctx.evidence.sign_up = { ok: signedUp.ok, ...(signedUp.alert ? { alert: signedUp.alert } : {}) };
  if (!signedUp.ok) {
    if (signedUp.alert && /rate|too many/i.test(signedUp.alert)) return infra("sign-up-rate-limit", signedUp.alert);
    if (signedUp.alert && /captcha|turnstile/i.test(signedUp.alert)) return infra("turnstile", signedUp.alert);
    return fail("sign_up_refused", `the sign-up form refused the new owner${signedUp.alert ? `: ${signedUp.alert}` : ""}`);
  }
  const confirmation = await poll(ctx, async () => (await ctx.mail.mailpit({ to: email, since })).find((mail) => mail.links.length > 0), 120_000, 3_000);
  if (!confirmation) return fail("no_confirmation_mail", "no confirmation mail with a link reached Mailpit within 2 min");
  await page.goto(confirmationLink(confirmation));
  const path = await page.path();
  ctx.evidence.landed_path = path;
  if (outsideApp(path)) return fail("confirmation_not_signed_in", `the confirmation link left the new owner at ${path}`);
  return { page, email };
}

/** S35: the public sign-up, confirmed by mail, reaches the app. */
export const S35: ScenarioRunner = {
  id: "S35",
  async run(ctx) {
    const signedUp = await signUpAndConfirm(ctx, "S35");
    return "outcome" in signedUp ? signedUp : pass();
  },
};

/** S32: onboarding, Checkout with the 4242 card, an active subscription and the customer portal. */
export const S32: ScenarioRunner = {
  id: "S32",
  async run(ctx) {
    const signedUp = await signUpAndConfirm(ctx, "S32");
    if ("outcome" in signedUp) return signedUp;
    const { page, email } = signedUp;
    if (!(await page.completeOnboarding({ business: `Rig S32 ${ctx.nonce}` }))) {
      return fail("onboarding_incomplete", "a step of onboarding never offered its control");
    }
    let paid: { returned: boolean; challenged: boolean };
    try {
      paid = await page.checkout({ card: STRIPE_TEST_CARD });
    } catch (error) {
      return infra("browser", `Checkout could not be driven: ${(error as Error).message}`);
    }
    // A challenge to a headless browser is recorded, not judged.
    ctx.evidence.checkout = paid;
    if (!paid.returned) return fail("checkout_not_returned", "Checkout never sent the new owner back to the app");

    const workspace = await poll(ctx, async () => {
      const found = await ctx.app.workspaceOf({ ownerEmail: email });
      return found?.stripe_subscription_id ? found : undefined;
    }, 60_000, 3_000);
    if (!workspace?.stripe_subscription_id) return fail("subscription_not_recorded", "the workspace recorded no subscription within 60 s of Checkout");
    const path = `/v1/subscriptions/${workspace.stripe_subscription_id}`;
    ctx.lease.registerUndo({ kind: STRIPE_DELETE_UNDO, params: { path } });
    ctx.evidence.workspace = { company_id: workspace.company_id, subscription_id: workspace.stripe_subscription_id };
    try {
      let subscription: { status?: string };
      try {
        await ctx.stripe.adoptCheckoutSubscription({ ownerEmail: email, subscriptionId: workspace.stripe_subscription_id });
        subscription = await ctx.stripe.request<{ status?: string }>("GET", path);
      } catch (error) {
        return infra("stripe", (error as Error).message);
      }
      ctx.evidence.subscription_status = subscription.status ?? null;
      if (subscription.status !== "active") return fail("subscription_not_active", `the sandbox has the subscription ${subscription.status ?? "with no status"}`);
      const portal = await page.openBillingPortal();
      ctx.evidence.portal_host = portal;
      if (portal !== "billing.stripe.com") return fail("portal_not_opened", `billing opened ${portal ?? "nothing"}, not Stripe's customer portal`);
      return pass();
    } finally {
      await removeFromSandbox(ctx, path);
    }
  },
};

/** S33: password and the seeded TOTP factor reach the second assurance level, and the API takes that session. */
export const S33: ScenarioRunner = {
  id: "S33",
  async run(ctx) {
    let signedIn: { aal: string | null; meStatus: number };
    try {
      signedIn = await ctx.app.signInWithTotp({ member: "qa-w-mfa-member" });
    } catch (error) {
      return infra("totp-seed", `the two-factor sign-in could not run: ${(error as Error).message}`);
    }
    ctx.evidence.totp = signedIn;
    if (signedIn.aal !== "aal2") return fail("not_second_level", `the session reached ${signedIn.aal ?? "no level"} (the factor's verify answered ${signedIn.meStatus})`);
    if (signedIn.meStatus !== 200) return fail("api_refused_aal2", `GET /v1/me answered ${signedIn.meStatus} to the second-level session`);
    return pass();
  },
};

/** Mail with at least one link, every one of which answers 2xx or 3xx. */
async function linksWork(ctx: ScenarioContext, mail: MailMessage): Promise<{ statuses: number[]; ok: boolean }> {
  const statuses: number[] = [];
  for (const link of mail.links) statuses.push((await ctx.mail.openLink(link)).status);
  return { statuses, ok: statuses.length > 0 && statuses.every((status) => status >= 200 && status < 400) };
}

/** The member S34's auth mail goes to, whose address the seed derives (scripts/rig/tenants.mjs). */
const RESET_MEMBER = { tenant: "qa-w", member: "technician" } as const;

/**
 * S34: an invite reaches the robot mailbox through Resend and Email Routing,
 * and a password reset reaches Mailpit; every link in each works. No
 * missed-call alert is checked: D45 made missed calls push-only, so the API
 * sends no mail for one.
 */
export const S34: ScenarioRunner = {
  id: "S34",
  // The guard mails the robot mailbox only under a live S34 lease of its own.
  guardLease: true,
  async run(ctx) {
    const tag = `s34-invite-${slug(ctx.nonce)}`;
    const address = ctx.mail.robotAddress(tag);
    if (!address) return infra("robot-mailbox", "the rig's private config names no robot mailbox");
    if (!mailboxReady(await ctx.guard.health())) return infra("robot-mailbox", "the guard's mailbox heartbeat is stale or its mail is halted");
    const lease = await ctx.guard.activity(ctx.lease.id).catch(() => undefined);
    if (!lease?.live) return infra("guard-lease", "the guard holds no live lease for this run, so it would refuse mail to the robot mailbox");
    ctx.evidence.missed_call_alert = "not_covered";

    const since = ctx.now();
    const invited = await ctx.app.invite({ member: "qa-w-owner", email: address });
    const inviteId = invited.body?.id;
    if (inviteId) ctx.lease.registerUndo({ kind: "app.revoke-invite", params: { member: "qa-w-owner", inviteId } });
    ctx.evidence.invite = { status: invited.status, invite_id: inviteId ?? null };
    if (!is2xx(invited.status) || !inviteId) return fail("invite_refused", `the invite answered ${invited.status}${invited.code ? ` ${invited.code}` : ""}`);
    const resetStatus = await ctx.app.sendPasswordReset({ member: `${RESET_MEMBER.tenant}-${RESET_MEMBER.member}` });
    ctx.evidence.reset = { status: resetStatus };
    if (resetStatus === 429) return infra("auth-rate-limit", "local auth rate-limited the password reset");
    if (!is2xx(resetStatus)) return fail("reset_refused", `local auth answered ${resetStatus} to the password reset`);

    const [invite, reset] = await Promise.all([
      poll(ctx, async () => (await ctx.mail.robotMail({ since, tag }))[0], 600_000, 15_000),
      poll(ctx, async () => (await ctx.mail.mailpit({ to: memberEmail(RESET_MEMBER.tenant, RESET_MEMBER.member), since }))[0], 120_000, 3_000),
    ]);
    if (!invite) return fail("invite_mail_missing", "the invite did not reach the robot mailbox within 10 min");
    const inviteLinks = await linksWork(ctx, invite);
    ctx.evidence.invite_mail = { id: invite.id, arrived_ms: Date.parse(invite.received_at) - since, link_statuses: inviteLinks.statuses };
    if (!inviteLinks.ok) return fail("invite_link_broken", `the invite's links answered ${inviteLinks.statuses.join(", ") || "nothing: it had none"}`);
    if (!reset) return fail("reset_mail_missing", "the password reset did not reach Mailpit within 2 min");
    const resetLinks = await linksWork(ctx, reset);
    ctx.evidence.reset_mail = { id: reset.id, link_statuses: resetLinks.statuses };
    if (!resetLinks.ok) return fail("reset_link_broken", `the reset's links answered ${resetLinks.statuses.join(", ") || "nothing: it had none"}`);
    return pass("the missed-call alert is not covered: D45 made missed calls push-only, so the API sends no mail for one");
  },
};
