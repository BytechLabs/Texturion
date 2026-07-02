/**
 * Local development seed (dev tooling — never runs in production).
 *
 * Seeds the LOCAL Supabase stack (started with `pnpm db:start`, reset with
 * `pnpm db:reset`) with a realistic company so the web app can be exercised
 * against the real API: an owner + member, an active subscription, an active
 * phone number, an approved 10DLC registration, and conversations covering
 * every state the UI designs for (new/open/waiting/closed, unread, assigned,
 * notes, a failed outbound, an opted-out contact, an MMS attachment, tags,
 * templates).
 *
 * Zero dependencies: talks straight to GoTrue admin, PostgREST, and Storage
 * with the local service key. Run from the repo root:
 *
 *   node --experimental-strip-types scripts/dev-seed.ts
 *
 * Idempotent-ish: intended to run once right after `pnpm db:reset`.
 */

import { deflateSync } from "node:zlib";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY =
  process.env.SUPABASE_SECRET_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

export const SEED_OWNER = { email: "owner@jobtext.test", password: "devseed1" };
export const SEED_MEMBER = { email: "sam@jobtext.test", password: "devseed1" };

const COMPANY_NUMBER = "+15125550100";

const authHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

async function gotrueCreateUser(
  email: string,
  password: string,
  displayName: string,
): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    }),
  });
  const body = (await res.json()) as { id?: string; msg?: string };
  if (res.ok && body.id) return body.id;
  // Already exists (rerun): look it up.
  const list = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=100`,
    { headers: authHeaders },
  );
  const users = (await list.json()) as { users?: { id: string; email: string }[] };
  const found = users.users?.find((u) => u.email === email);
  if (!found) throw new Error(`GoTrue create failed for ${email}: ${JSON.stringify(body)}`);
  return found.id;
}

async function rest<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method ?? "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "POST"} ${path} → ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

const insert = <T = { id: string }[]>(table: string, rows: unknown) =>
  rest<T>(table, { body: rows });

const daysAgo = (d: number, extraMinutes = 0) =>
  new Date(Date.now() - d * 86_400_000 + extraMinutes * 60_000).toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/* ------------------------------------------------------------------ */
/* A real (tiny) PNG, generated in-process: 320x240 blue-gray gradient  */
/* with a dark blob — stands in for a customer's "leak under the sink". */
/* ------------------------------------------------------------------ */
function crc32(buf: Uint8Array): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set([...type].map((ch) => ch.charCodeAt(0)), 4);
  out.set(data, 8);
  const crcInput = out.subarray(4, 8 + data.length);
  dv.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

function makeSeedPng(variant = 0): Uint8Array {
  const w = 320;
  const h = 240;
  // Two believable "job photo" scenes so different MMS threads don't share one
  // identical image: variant 0 = a leak puddle under the sink (cool gray),
  // variant 1 = a warmer under-cabinet shot with the P-trap section darker.
  const px = variant === 1 ? 120 : 200;
  const py = variant === 1 ? 150 : 170;
  const warm = variant === 1 ? 18 : 0;
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 3;
      // gradient base
      let r = 90 + warm + Math.round((x / w) * 60);
      let g = 105 + Math.round((y / h) * 50);
      let b = 120 - warm + Math.round(((x + y) / (w + h)) * 70);
      // dark elliptical "puddle" / pipe shadow
      const dx = (x - px) / 70;
      const dy = (y - py) / 34;
      if (dx * dx + dy * dy < 1) {
        r = 40;
        g = 44;
        b = 52;
      }
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolor
  const idat = new Uint8Array(deflateSync(raw));
  const chunks = [
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    png.set(c, off);
    off += c.length;
  }
  return png;
}

async function uploadAttachment(path: string, bytes: Uint8Array): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/mms-media/${path}`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "image/png", "x-upsert": "true" },
    body: bytes as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`storage upload ${path} → ${res.status}: ${await res.text()}`);
}

/* ------------------------------------------------------------------ */

async function main() {
  console.log("Seeding local JobText dev data …");

  const ownerId = await gotrueCreateUser(
    SEED_OWNER.email,
    SEED_OWNER.password,
    "Mike Rivera",
  );
  const memberId = await gotrueCreateUser(
    SEED_MEMBER.email,
    SEED_MEMBER.password,
    "Sam Kowalski",
  );
  console.log(`  users: owner=${ownerId} member=${memberId}`);

  // Company via the same security-definer function POST /v1/companies uses.
  const company = await rest<{ id: string }>("rpc/api_create_company", {
    body: {
      p_owner_user_id: ownerId,
      p_name: "Mike's Plumbing",
      p_country: "US",
      p_requested_area_code: "512",
      p_us_texting_enabled: true,
    },
  });
  const companyId = company.id;
  console.log(`  company: ${companyId}`);

  // Active subscription, 12 days into the period.
  await rest(`companies?id=eq.${companyId}`, {
    method: "PATCH",
    body: {
      subscription_status: "active",
      plan: "starter",
      stripe_customer_id: "cus_devseed000000",
      stripe_subscription_id: "sub_devseed000000",
      current_period_start: daysAgo(12),
      current_period_end: daysAgo(-18),
      registration_fee_paid_at: daysAgo(20),
      telnyx_messaging_profile_id: "devseed-messaging-profile",
    },
  });

  // Second member + prefs.
  await insert("company_members", {
    company_id: companyId,
    user_id: memberId,
    role: "member",
  });
  await insert("notification_prefs", { user_id: memberId, company_id: companyId });

  // Active number.
  const [number] = await insert("phone_numbers", {
    company_id: companyId,
    status: "active",
    provisioning_key: "cs_devseed_checkout",
    requested_area_code: "512",
    country: "US",
    number_e164: COMPANY_NUMBER,
    telnyx_phone_number_id: "devseed-pn-1",
    telnyx_order_id: "devseed-order-1",
  });

  // Approved brand + campaign (wizard data under canonical Telnyx keys).
  await insert("messaging_registrations", [
    {
      company_id: companyId,
      kind: "brand",
      status: "approved",
      telnyx_id: "devseed-brand-1",
      submitted_at: daysAgo(20),
      approved_at: daysAgo(18),
      submission_count: 1,
      data: {
        displayName: "Mike's Plumbing",
        companyName: "Mike's Plumbing LLC",
        ein: "84-1234567",
        website: "https://mikesplumbing.example.com",
        email: SEED_OWNER.email,
        phone: "+15125550100",
        vertical: "CONSTRUCTION",
        street: "914 Barton Springs Rd",
        city: "Austin",
        state: "TX",
        postalCode: "78704",
        country: "US",
      },
    },
    {
      company_id: companyId,
      kind: "campaign",
      status: "approved",
      telnyx_id: "devseed-campaign-1",
      submitted_at: daysAgo(19),
      approved_at: daysAgo(17),
      submission_count: 1,
      data: {
        messageFlow:
          "Customers text our business number first, or ask us in person or by phone to text them. We never send marketing blasts.",
        sample1: "Hi, this is Mike's Plumbing — we can be there tomorrow between 10 and noon.",
        sample2: "Your water heater install is confirmed for Friday at 9am. Reply here with any questions.",
      },
    },
  ]);

  /* ------------------------------- contacts ------------------------------ */
  const contactRows = [
    { phone_e164: "+15125550101", name: "Dana Whitfield", consent_source: "inbound_sms", consent_at: minutesAgo(8) },
    {
      phone_e164: "+15125550102",
      name: "Marcus Reed",
      address: "44 Cedar Ln, Austin TX",
      notes: "Recurring kitchen-sink clogs — old cast iron stack. Prefers morning visits.",
      consent_source: "inbound_sms",
      consent_at: daysAgo(2),
    },
    { phone_e164: "+15125550103", name: "Priya Shah", consent_source: "inbound_sms", consent_at: daysAgo(4) },
    { phone_e164: "+15125550104", name: "Tom Bell", consent_source: "inbound_sms", consent_at: daysAgo(6) },
    { phone_e164: "+15125550105", name: "Rosa Delgado", consent_source: "attested", consent_at: daysAgo(5), consent_attested_by: ownerId },
    { phone_e164: "+15125550106", name: "Jake Turner", consent_source: "inbound_sms", consent_at: daysAgo(1) },
    { phone_e164: "+15125550107", name: null, consent_source: "inbound_sms", consent_at: daysAgo(1) },
  ].map((c) => ({
    // PostgREST bulk insert requires identical keys on every row.
    company_id: companyId,
    address: null,
    notes: null,
    consent_attested_by: null,
    ...c,
  }));
  const contacts = await insert<{ id: string; phone_e164: string }[]>(
    "contacts",
    contactRows,
  );
  const byPhone = new Map(contacts.map((c) => [c.phone_e164, c.id]));
  const cid = (last2: string) => byPhone.get(`+151255501${last2}`)!;

  /* ---------------------------- conversations ---------------------------- */
  type ConvSpec = {
    contact: string;
    status: "new" | "open" | "waiting" | "closed";
    assigned?: string;
    created: string;
    last: string;
    closed?: string;
  };
  const convSpecs: Record<string, ConvSpec> = {
    dana: { contact: cid("01"), status: "new", created: minutesAgo(8), last: minutesAgo(7) },
    marcus: { contact: cid("02"), status: "open", assigned: memberId, created: daysAgo(2, -9 * 60), last: minutesAgo(118) },
    priya: { contact: cid("03"), status: "waiting", created: daysAgo(4), last: daysAgo(4, 12) },
    tom: { contact: cid("04"), status: "closed", created: daysAgo(6), last: daysAgo(5), closed: daysAgo(5, 5) },
    rosa: { contact: cid("05"), status: "open", created: daysAgo(3), last: daysAgo(3, 6) },
    jake: { contact: cid("06"), status: "open", created: minutesAgo(26 * 60), last: minutesAgo(25 * 60) },
    anon: { contact: cid("07"), status: "new", created: daysAgo(1), last: daysAgo(1) },
  };
  const convRows = Object.values(convSpecs).map((s) => ({
    company_id: companyId,
    contact_id: s.contact,
    phone_number_id: number.id,
    status: s.status,
    assigned_user_id: s.assigned ?? null,
    created_at: s.created,
    last_message_at: s.last,
    closed_at: s.closed ?? null,
  }));
  const convs = await insert<{ id: string; contact_id: string }[]>(
    "conversations",
    convRows,
  );
  const convByContact = new Map(convs.map((c) => [c.contact_id, c.id]));
  const conv = (k: keyof typeof convSpecs) => convByContact.get(convSpecs[k].contact)!;

  /* ------------------------------- messages ------------------------------ */
  let msgSeq = 0;
  const tid = () => `devseed-msg-${++msgSeq}`;
  const messages = [
    // Dana — new, unread (two inbound in one cluster)
    { c: "dana", dir: "inbound", body: "Hi, do you do water heater replacements? Ours is leaking from the bottom.", at: minutesAgo(8) },
    { c: "dana", dir: "inbound", body: "It's a Rheem, about 10 years old", at: minutesAgo(7) },
    // Marcus — open, assigned, multi-day: the "hero" thread. Carries the full
    // message variety the marketing shots need — inbound, outbound, an internal
    // note, an inbound MMS photo, delivery states, a struck-through done
    // message (D14), and a retryable failed send at the end.
    { c: "marcus", dir: "inbound", body: "Hey, this is Marcus from 44 Cedar Ln. Kitchen sink is backing up again.", at: daysAgo(2, -9 * 60) },
    { c: "marcus", dir: "inbound", body: "Here's what it looks like under there", at: daysAgo(2, -9 * 60 + 1), mms: true },
    { c: "marcus", dir: "note", body: "Second callout this month on the same cast-iron stack. If it clogs again, quote him on replacing the section — don't keep snaking it.", at: daysAgo(2, -9 * 60 + 3), by: memberId },
    { c: "marcus", dir: "outbound", body: "Morning Marcus — we can come by tomorrow between 10 and noon. Does that work?", at: daysAgo(2, -9 * 60 + 6), by: ownerId, status: "delivered" },
    { c: "marcus", dir: "inbound", body: "Yes that works, thanks", at: daysAgo(2, -9 * 60 + 17) },
    { c: "marcus", dir: "outbound", body: "On our way now — about 25 minutes out.", at: daysAgo(1, -10 * 60), by: memberId, status: "delivered", done: true, doneBy: memberId, doneAt: daysAgo(1, -9 * 60) },
    { c: "marcus", dir: "inbound", body: "Sink's draining great now. What do I owe you?", at: minutesAgo(3 * 60) },
    { c: "marcus", dir: "outbound", body: "Total is $180 — I can text you a payment link if that's easiest.", at: minutesAgo(118), by: ownerId, status: "failed", noTelnyxId: true, error_detail: "Telnyx API error: upstream connect timeout" },
    // Priya — waiting, quote + internal note
    { c: "priya", dir: "inbound", body: "Hi, could you quote a bathroom faucet replacement? Nothing fancy.", at: daysAgo(4) },
    { c: "priya", dir: "outbound", body: "Hi Priya — for a standard single-handle faucet, supplied and installed, you're looking at $240–$280. Want me to book you in?", at: daysAgo(4, 10), by: ownerId, status: "delivered" },
    { c: "priya", dir: "note", body: "Quoted mid-range. Building is a 1970s walk-up — check the shutoff valves before adding anything to the quote.", at: daysAgo(4, 12), by: ownerId },
    // Tom — closed
    { c: "tom", dir: "inbound", body: "Do you service tankless water heaters?", at: daysAgo(6) },
    { c: "tom", dir: "outbound", body: "We do — install and service. What model do you have?", at: daysAgo(6, 8), by: ownerId, status: "delivered" },
    { c: "tom", dir: "inbound", body: "Actually found someone closer, thanks anyway", at: daysAgo(6, 40) },
    { c: "tom", dir: "outbound", body: "No problem Tom — we're here if you need us.", at: daysAgo(5), by: ownerId, status: "delivered" },
    // Rosa — opted out; a 40300 carrier-blocked send (never silent, D3)
    { c: "rosa", dir: "inbound", body: "Please stop texting me", at: daysAgo(3) },
    { c: "rosa", dir: "outbound", body: "Understood — you won't hear from us again.", at: daysAgo(3, 6), by: ownerId, status: "failed", error_code: "40300", error_detail: "Blocked due to STOP message" },
    // Jake — MMS
    { c: "jake", dir: "inbound", body: "Here's the leak under the sink", at: minutesAgo(26 * 60), mms: true },
    { c: "jake", dir: "outbound", body: "Thanks Jake — that's the P-trap. We'll bring a replacement tomorrow morning.", at: minutesAgo(25 * 60), by: ownerId, status: "delivered" },
    // Unnamed number — new, unread
    { c: "anon", dir: "inbound", body: "How much to unclog a floor drain?", at: daysAgo(1) },
  ] as const;

  const msgRows = messages.map((m) => ({
    company_id: companyId,
    conversation_id: conv(m.c),
    direction: m.dir,
    body: m.body,
    created_at: m.at,
    status: m.dir === "note" ? null : m.dir === "inbound" ? "received" : (m as { status?: string }).status,
    sent_by_user_id: "by" in m ? (m as { by?: string }).by : null,
    telnyx_message_id:
      m.dir === "note" || ("noTelnyxId" in m && (m as { noTelnyxId?: boolean }).noTelnyxId)
        ? null
        : tid(),
    segments: m.dir === "outbound" && (m as { status?: string }).status === "delivered" ? 1 : null,
    encoding: m.dir === "outbound" && (m as { status?: string }).status === "delivered" ? "GSM-7" : null,
    error_code: "error_code" in m ? (m as { error_code?: string }).error_code : null,
    error_detail: "error_detail" in m ? (m as { error_detail?: string }).error_detail : null,
    // D14 done state (struck-through message with actor + timestamp).
    done_at: "done" in m && (m as { done?: boolean }).done ? (m as { doneAt?: string }).doneAt : null,
    done_by_user_id: "done" in m && (m as { done?: boolean }).done ? (m as { doneBy?: string }).doneBy : null,
  }));
  const insertedMsgs = await insert<{ id: string; conversation_id: string; body: string }[]>(
    "messages",
    msgRows,
  );
  console.log(`  messages: ${insertedMsgs.length}`);

  // MMS attachments: a real PNG per inbound photo, uploaded to the private
  // bucket. Every message flagged `mms: true` in the script above gets one.
  const mmsBodies = messages
    .filter((m) => "mms" in m && (m as { mms?: boolean }).mms)
    .map((m) => m.body);
  let mmsVariant = 0;
  for (const body of mmsBodies) {
    const mmsMsg = insertedMsgs.find((m) => m.body === body)!;
    const png = makeSeedPng(mmsVariant);
    const storagePath = `${companyId}/${mmsMsg.id}/0`;
    await uploadAttachment(storagePath, png);
    await insert("message_attachments", {
      message_id: mmsMsg.id,
      company_id: companyId,
      storage_path: `mms-media/${storagePath}`,
      content_type: "image/png",
      size_bytes: png.length,
      source_url: `https://media.telnyx.example/devseed-photo-${mmsVariant}.png`,
    });
    mmsVariant += 1;
  }

  /* -------------------------- opt-out + events --------------------------- */
  await insert("opt_outs", {
    company_id: companyId,
    phone_e164: "+15125550105",
    source: "manual",
    created_by: ownerId,
    created_at: daysAgo(3, 4),
  });
  await insert("conversation_events", [
    { company_id: companyId, conversation_id: conv("marcus"), actor_user_id: ownerId, type: "status_changed", payload: { from: "new", to: "open" }, created_at: daysAgo(2, -9 * 60 + 5) },
    { company_id: companyId, conversation_id: conv("marcus"), actor_user_id: ownerId, type: "assigned", payload: { from: null, to: memberId }, created_at: daysAgo(2, -9 * 60 + 5) },
    { company_id: companyId, conversation_id: conv("priya"), actor_user_id: ownerId, type: "status_changed", payload: { from: "new", to: "waiting" }, created_at: daysAgo(4, 13) },
    { company_id: companyId, conversation_id: conv("priya"), actor_user_id: ownerId, type: "tag_added", payload: { name: "Quote sent" }, created_at: daysAgo(4, 13) },
    { company_id: companyId, conversation_id: conv("tom"), actor_user_id: ownerId, type: "status_changed", payload: { from: "open", to: "closed" }, created_at: daysAgo(5, 5) },
    { company_id: companyId, conversation_id: conv("rosa"), actor_user_id: ownerId, type: "opted_out", payload: {}, created_at: daysAgo(3, 4) },
  ]);

  /* ------------------------------ tags/reads ----------------------------- */
  const tags = await rest<{ id: string; name: string }[]>(
    `tags?company_id=eq.${companyId}&select=id,name`,
    { method: "GET" },
  );
  const quoteSent = tags.find((t) => t.name === "Quote sent")!;
  const scheduled = tags.find((t) => t.name === "Scheduled")!;
  await insert("conversation_tags", [
    { conversation_id: conv("priya"), tag_id: quoteSent.id },
    { conversation_id: conv("marcus"), tag_id: scheduled.id },
  ]);

  // Owner has read everything except Dana + the unnamed number (unread rows).
  await insert(
    "conversation_reads",
    (["marcus", "priya", "tom", "rosa", "jake"] as const).map((k) => ({
      conversation_id: conv(k),
      user_id: ownerId,
      last_read_at: minutesAgo(1),
    })),
  );

  /* ------------------------------ templates ------------------------------ */
  await insert("templates", [
    { company_id: companyId, name: "On my way", body: "We're on our way — should be there in about 30 minutes.", created_by: ownerId },
    { company_id: companyId, name: "Quote follow-up", body: "Hi — just checking in on the quote we sent over. Any questions we can answer?", created_by: ownerId },
  ]);

  /* -------------------------------- usage -------------------------------- */
  const deliveredIds = insertedMsgs
    .filter((_, i) => msgRows[i].status === "delivered")
    .map((m) => m.id);
  await insert(
    "usage_events",
    deliveredIds.map((id) => ({
      company_id: companyId,
      message_id: id,
      type: "sms_outbound",
      quantity: 1,
      stripe_reported_at: minutesAgo(30),
      created_at: minutesAgo(60),
    })),
  );
  // Back-fill so the period meter shows realistic usage (~36%).
  await insert("usage_events", {
    company_id: companyId,
    type: "adjustment",
    quantity: 174,
    created_at: daysAgo(6),
  });

  console.log("Done. Log in as:");
  console.log(`  ${SEED_OWNER.email} / ${SEED_OWNER.password}  (owner)`);
  console.log(`  ${SEED_MEMBER.email} / ${SEED_MEMBER.password}  (member)`);
  console.log(`  Company number: ${COMPANY_NUMBER}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
