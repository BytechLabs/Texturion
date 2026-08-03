/**
 * Contact routes (SPEC §5, §7): trgm list filter, upsert semantics clearing
 * deleted_at, soft delete, CSV import (parsing, E.164 normalization,
 * opted_out handling, malformed rows), manual opt-out/revoke.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
  type SupabaseStub,
} from "../test/routes-harness";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import { decodeCursor, encodeCursor } from "../http/pagination";

import { contactSearchOr, contactsRoutes } from "./contacts";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CONTACT_ID = "dddddddd-1111-4222-8333-444444444444";
/** #246: the second record for the same customer. */
const OTHER_ID = "dddddddd-2222-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(contactsRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWithRole(
  role: string | null,
  /**
   * #291: the contact detail reads addresses now. Passed IN rather than
   * registered afterwards — this harness is first-match-wins, so a later
   * `sb.on` for a path it already claimed is a stub that silently never runs.
   */
  addresses: Record<string, unknown>[] = [],
): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, role),
  );
  // #291: the contact detail now reads a contact's addresses. Empty is the
  // answer for every contact that predates the feature, and the state every
  // test written before it was asserting against. A suite that wants
  // addresses registers this path itself and wins.
  sb.on("GET", "/rest/v1/contact_addresses", () => addresses);
  return sb;
}

function contactRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTACT_ID,
    phone_e164: "+14165550199",
    name: "Jo Smith",
    address: null,
    notes: null,
    consent_source: null,
    consent_at: null,
    consent_attested_by: null,
    deleted_at: null,
    created_at: "2026-07-01T09:00:00+00:00",
    updated_at: "2026-07-01T09:00:00+00:00",
    ...overrides,
  };
}

function importForm(csv: string, attested = true): FormData {
  const form = new FormData();
  form.append("file", new File([csv], "contacts.csv", { type: "text/csv" }));
  // #226: an import cannot complete without a stated consent basis. Defaulted
  // here so every pre-existing test still describes the case it was written
  // for; the gate itself is asserted directly below.
  if (attested) form.append("consent_attested", "true");
  return form;
}

describe("GET /v1/contacts", () => {
  it("composes the trgm q filter with soft-delete exclusion and keyset limit", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts?q=smi&limit=10",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const call = sb.find("GET", "/rest/v1/contacts")[0];
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(call.url.searchParams.get("deleted_at")).toBe("is.null");
    expect(call.url.searchParams.get("or")).toBe(
      "(name.ilike.*smi*,phone_e164.ilike.*smi*,business_name.ilike.*smi*,email.ilike.*smi*)",
    );
    expect(call.url.searchParams.get("limit")).toBe("11");
    // The list never fetches the (up-to-5000-char) notes column — it's detail-only.
    expect(call.url.searchParams.get("select")).not.toContain("notes");
  });

  it("#459: leaves the search box alone — digits do not become a name search", async () => {
    // Typing "416" in the contacts search box means an area code. Quietly also
    // returning every name whose keypad letters spell 416 would make a text
    // search answer a question nobody asked, so T9 is opt-in.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(app, env, await auth.token(), "/v1/contacts?q=416", {
      companyId: COMPANY_ID,
    });
    expect(sb.find("GET", "/rest/v1/contacts")[0].url.searchParams.get("or"))
      .not.toContain("name_t9");
  });

  it("#459: t9=1 makes the keypad a name search, at word starts only", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    // 2-6-2 spells BOB.
    await apiRequest(app, env, await auth.token(), "/v1/contacts?q=262&t9=1", {
      companyId: COMPANY_ID,
    });
    const or = sb.find("GET", "/rest/v1/contacts")[0].url.searchParams.get("or") ?? "";
    // A first word, and any later word. NOT a bare *262* — matching mid-word
    // finds "Alaska" for L-A-S, and a list nobody typed is one people stop
    // reading.
    expect(or).toContain("name_t9.ilike.262*");
    expect(or).toContain("name_t9.ilike.* 262*");
    expect(or).not.toContain("name_t9.ilike.*262*");
    // The number search it always did is untouched.
    expect(or).toContain("phone_e164.ilike.*262*");
  });

  it("decorates rows with opted_out (G6 badge) and last_activity_at (conversation activity, never updated_at) via batched lookups", async () => {
    const OTHER_ID = "eeeeeeee-1111-4222-8333-444444444444";
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [
      contactRow(), // +14165550199
      contactRow({
        id: OTHER_ID,
        phone_e164: "+15125550105",
        name: "Rosa Delgado",
        created_at: "2026-06-30T09:00:00+00:00",
      }),
    ]);
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { phone_e164: "+15125550105" },
    ]);
    // Two conversations for the first contact (newest wins — the route
    // orders last_message_at DESC and keeps the first per contact); none for
    // the second (→ null, the "no texting yet" table state).
    sb.on("GET", "/rest/v1/conversations", () => [
      { contact_id: CONTACT_ID, last_message_at: "2026-06-26T18:04:00+00:00" },
      { contact_id: CONTACT_ID, last_message_at: "2026-05-01T10:00:00+00:00" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contacts", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; opted_out: boolean; last_activity_at: string | null }[];
    };
    expect(body.data).toEqual([
      expect.objectContaining({
        id: CONTACT_ID,
        opted_out: false,
        last_activity_at: "2026-06-26T18:04:00+00:00",
      }),
      expect.objectContaining({
        id: OTHER_ID,
        opted_out: true,
        last_activity_at: null,
      }),
    ]);

    const lookup = sb.find("GET", "/rest/v1/opt_outs")[0];
    expect(lookup.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(lookup.url.searchParams.get("revoked_at")).toBe("is.null");
    expect(lookup.url.searchParams.get("phone_e164")).toBe(
      "in.(+14165550199,+15125550105)",
    );

    const activity = sb.find("GET", "/rest/v1/conversations")[0];
    expect(activity.url.searchParams.get("company_id")).toBe(
      `eq.${COMPANY_ID}`,
    );
    expect(activity.url.searchParams.get("contact_id")).toBe(
      `in.(${CONTACT_ID},${OTHER_ID})`,
    );
    expect(activity.url.searchParams.get("order")).toBe(
      "last_message_at.desc",
    );
  });

  it("skips the opt-out and activity lookups entirely for an empty page", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contacts", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [], next_cursor: null });
    expect(sb.find("GET", "/rest/v1/opt_outs")).toHaveLength(0);
    expect(sb.find("GET", "/rest/v1/conversations")).toHaveLength(0);
  });

  it("strips PostgREST/LIKE metacharacters from q", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts?q=${encodeURIComponent('a%b_("c"),d')}`,
      { companyId: COMPANY_ID },
    );
    const call = sb.find("GET", "/rest/v1/contacts")[0];
    expect(call.url.searchParams.get("or")).toBe(
      "(name.ilike.*abcd*,phone_e164.ilike.*abcd*,business_name.ilike.*abcd*,email.ilike.*abcd*)",
    );
  });

  it("finds a customer by a phone number written the way it is read", async () => {
    // Stored E.164 carries no punctuation, so the raw query never matches a
    // formatted number. The product's own screens display "(647) 892-3862",
    // and pasting that back found nothing.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts?q=${encodeURIComponent("(647) 892-3862")}`,
      { companyId: COMPANY_ID },
    );

    expect(
      sb.find("GET", "/rest/v1/contacts")[0].url.searchParams.get("or"),
    ).toBe(
      "(name.ilike.*647 892-3862*,phone_e164.ilike.*647 892-3862*,business_name.ilike.*647 892-3862*,email.ilike.*647 892-3862*," +
        "phone_e164.ilike.*6478923862*)",
    );
  });

  it("adds no digits term for a name, or for digits already bare", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(app, env, await auth.token(), "/v1/contacts?q=smith", {
      companyId: COMPANY_ID,
    });
    await apiRequest(app, env, await auth.token(), "/v1/contacts?q=6478923862", {
      companyId: COMPANY_ID,
    });

    const calls = sb.find("GET", "/rest/v1/contacts");
    expect(calls[0].url.searchParams.get("or")).toBe(
      "(name.ilike.*smith*,phone_e164.ilike.*smith*,business_name.ilike.*smith*,email.ilike.*smith*)",
    );
    // Already bare digits: the same term twice would only cost a scan.
    expect(calls[1].url.searchParams.get("or")).toBe(
      "(name.ilike.*6478923862*,phone_e164.ilike.*6478923862*,business_name.ilike.*6478923862*,email.ilike.*6478923862*)",
    );
  });
});

describe("POST /v1/contacts (upsert semantics)", () => {
  it("normalizes the phone, upserts on (company_id, phone_e164), clears deleted_at", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => []); // no existing live contact → insert path
    sb.on("POST", "/rest/v1/contacts", () => [contactRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contacts", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { phone_e164: "(416) 555-0199", name: "Jo Smith" },
    });
    expect(res.status).toBe(201);

    const upsert = sb.find("POST", "/rest/v1/contacts")[0];
    expect(upsert.body).toEqual({
      company_id: COMPANY_ID,
      phone_e164: "+14165550199",
      deleted_at: null,
      created_by_user_id: auth.subject, // #191 attribution
      name: "Jo Smith",
    });
    expect(upsert.url.searchParams.get("on_conflict")).toBe(
      "company_id,phone_e164",
    );
    expect(upsert.headers.get("prefer")).toContain(
      "resolution=merge-duplicates",
    );
  });

  it("422s non-US/CA numbers (Caribbean, international, garbage)", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    for (const phone of ["+12425550199", "+447911123456", "banana"]) {
      const res = await apiRequest(app, env, await auth.token(), "/v1/contacts", {
        method: "POST",
        companyId: COMPANY_ID,
        body: { phone_e164: phone },
      });
      expect(res.status, phone).toBe(422);
    }
  });
});

describe("GET/PATCH/DELETE /v1/contacts/:id", () => {
  it("GET returns the contact with app-side opt-out state", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("GET", "/rest/v1/opt_outs", () => [{ id: "1a2b3c4d-1111-4222-8333-444444444444" }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: CONTACT_ID,
      opted_out: true,
    });
  });

  it("summarises the relationship: how many, and since when (#410)", async () => {
    // Two facts, derived server-side so three clients cannot disagree. The
    // count is CONVERSATIONS, not messages — a chatty customer is not a loyal
    // one, and a message count would mislead in exactly the case this informs.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    // Both reads hit the same table; the head-count ignores the body.
    sb.on("GET", "/rest/v1/conversations", () => [
      { created_at: "2026-03-04T10:00:00+00:00" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.first_conversation_at).toBe("2026-03-04T10:00:00+00:00");
    expect(body).toHaveProperty("conversation_count");

    // Both reads are scoped to the company AND the contact. A count that
    // leaked across either boundary would be a privacy failure wearing a
    // feature's clothes.
    // The count is a HEAD (postgrest `head: true`), the first date a GET.
    const reads = [
      ...sb.find("GET", "/rest/v1/conversations"),
      ...sb.find("HEAD", "/rest/v1/conversations"),
    ];
    expect(reads).toHaveLength(2);
    for (const read of reads) {
      expect(read.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
      expect(read.url.searchParams.get("contact_id")).toBe(`eq.${CONTACT_ID}`);
    }
  });

  it("never counts a conversation on a number the member cannot see (#106, #410)", async () => {
    // #106/D88: a member kept off a number must not learn the customer's
    // history through a count that silently includes it. The deny list is the
    // same one the conversation list filters on.
    const hidden = "eeeeeeee-9999-4222-8333-444444444444";
    const sb = stubWithRole("member");
    // An explicit handler beats the ambient unrestricted default.
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => [
      { phone_number_id: hidden, level: "none" },
    ]);
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const reads = [
      ...sb.find("GET", "/rest/v1/conversations"),
      ...sb.find("HEAD", "/rest/v1/conversations"),
    ];
    // BOTH reads carry the deny list. A count that skipped it would leak the
    // size of a history the member is not allowed to see.
    expect(reads).toHaveLength(2);
    for (const read of reads) {
      expect(read.url.searchParams.get("phone_number_id")).toBe(`not.in.(${hidden})`);
    }
  });

  it("an edit answers with the opt-out state, so a client cache cannot lose it", async () => {
    // Android writes this response into the cache its detail screen renders
    // from (deliberately, so a reopen never shows the pre-edit value). When the
    // response was the bare table row, an ordinary name edit made the red
    // "Opted out" chip and the "sends are blocked" card vanish, and the screen
    // went back to offering to opt out someone who already had.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("PATCH", "/rest/v1/contacts", () => [contactRow({ name: "Jo S." })]);
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { id: "0abc0abc-1111-4222-8333-444444444444", source: "stop_keyword" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { name: "Jo S." } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      opted_out: boolean;
      opt_out_source: string | null;
    };
    expect(body.opted_out).toBe(true);
    expect(body.opt_out_source).toBe("stop_keyword");
  });

  it("PATCH consent_attested stamps consent fields and writes a consent_attested event", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("PATCH", "/rest/v1/contacts", (call) => [
      { ...contactRow(), ...(call.body as Record<string, unknown>) },
    ]);
    // The PATCH answers with the same shape GET does, opt-out state included.
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []); // no conversation yet
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      {
        method: "PATCH",
        companyId: COMPANY_ID,
        body: { consent_attested: true, name: "Jo S." },
      },
    );
    expect(res.status).toBe(200);

    const update = sb.find("PATCH", "/rest/v1/contacts")[0]
      .body as Record<string, unknown>;
    expect(update.name).toBe("Jo S.");
    expect(update.consent_source).toBe("attested");
    expect(typeof update.consent_at).toBe("string");
    expect(update.consent_attested_by).toBe(auth.subject);

    const events = sb.find("POST", "/rest/v1/conversation_events")[0]
      .body as unknown[];
    expect(events).toEqual([
      expect.objectContaining({
        type: "consent_attested",
        conversation_id: null, // contact-level event, no conversation exists
        actor_user_id: auth.subject,
      }),
    ]);
  });

  it("DELETE soft-deletes (deleted_at) and 404s an unknown id", async () => {
    const sb = stubWithRole("member");
    sb.on("PATCH", "/rest/v1/contacts", () => [{ id: CONTACT_ID }]);
    // The PATCH answers with the same shape GET does, opt-out state included.
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(204);
    const patch = sb.find("PATCH", "/rest/v1/contacts")[0];
    expect(typeof (patch.body as Record<string, unknown>).deleted_at).toBe(
      "string",
    );

    vi.unstubAllGlobals();
    const sb2 = stubWithRole("member");
    sb2.on("PATCH", "/rest/v1/contacts", () => []);
    stubFetch(jwksRoute(auth), sb2.route);
    const missing = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(missing.status).toBe(404);
  });
});

describe("GET /v1/contacts/:id/timeline (#324)", () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    kind: "conversation",
    id: "0aaa0aaa-1111-4222-8333-444444444444",
    occurred_at: "2026-07-20T10:00:00.000Z",
    conversation_id: "0aaa0aaa-1111-4222-8333-444444444444",
    status: "open",
    detail: null,
    ...over,
  });

  it("returns one stream and an OPAQUE cursor when the page is full", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("POST", "/rest/v1/rpc/api_contact_timeline", () => [
      entry(),
      entry({
        kind: "call",
        id: "0bbb0bbb-1111-4222-8333-444444444444",
        occurred_at: "2026-07-19T09:00:00.000Z",
      }),
    ]);
    // #517: a page carrying a call row now reads back who answered it.
    sb.on("GET", "/rest/v1/calls", () => [
      {
        id: "0bbb0bbb-1111-4222-8333-444444444444",
        answered_by_user_id: "0ccc0ccc-1111-4222-8333-444444444444",
      },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/timeline?limit=2`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: { kind: string; answered_by_user_id?: string }[];
      next_cursor: string | null;
    };
    expect(body.entries.map((e) => e.kind)).toEqual(["conversation", "call"]);
    // #517: the call row carries its answerer; the conversation row does not
    // grow a field it has no meaning for.
    const [conversation, call] = body.entries;
    expect(call.answered_by_user_id).toBe("0ccc0ccc-1111-4222-8333-444444444444");
    expect(conversation).not.toHaveProperty("answered_by_user_id");
    // SPEC §7/D10: base64url of the full (ts, id) sort key, not a raw
    // timestamp. A raw timestamptz carries a `+`, which URLComponents does not
    // escape and Hono decodes as a space — a 422 on every iOS "Show earlier".
    expect(body.next_cursor).toBeTruthy();
    expect(body.next_cursor).not.toContain("+");
    expect(body.next_cursor).not.toContain(":");
    expect(decodeCursor(body.next_cursor as string)).toEqual({
      ts: "2026-07-19T09:00:00.000Z",
      id: "0bbb0bbb-1111-4222-8333-444444444444",
    });
  });

  it("passes BOTH halves of the sort key down, so a tie cannot skip a row", async () => {
    // The ordering is (occurred_at, id); a timestamp-only predicate skips the
    // second of any two entries sharing an instant, which a call threading a
    // message produces.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    let params: Record<string, unknown> | null = null;
    sb.on("POST", "/rest/v1/rpc/api_contact_timeline", (req) => {
      params = req.body as Record<string, unknown>;
      return [];
    });
    stubFetch(jwksRoute(auth), sb.route);

    const cursor = encodeCursor({
      ts: "2026-07-19T09:00:00.000Z",
      id: "0bbb0bbb-1111-4222-8333-444444444444",
    });
    await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/timeline?cursor=${cursor}`,
      { companyId: COMPANY_ID },
    );
    expect(params).toMatchObject({
      p_before_ts: "2026-07-19T09:00:00.000Z",
      p_before_id: "0bbb0bbb-1111-4222-8333-444444444444",
    });
  });

  it("returns a null cursor on a short page, so the client stops", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("POST", "/rest/v1/rpc/api_contact_timeline", () => [entry()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/timeline?limit=50`,
      { companyId: COMPANY_ID },
    );
    expect(((await res.json()) as { next_cursor: string | null }).next_cursor).toBeNull();
  });

  it("404s an unknown contact BEFORE reading the timeline", async () => {
    // Otherwise the shape of an empty result tells a caller which contact ids
    // exist in another workspace.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => []);
    let timelineCalls = 0;
    sb.on("POST", "/rest/v1/rpc/api_contact_timeline", () => {
      timelineCalls += 1;
      return [];
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/timeline`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(404);
    expect(timelineCalls).toBe(0);
  });

  it("rejects a garbage cursor rather than paging from the top forever", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/timeline?cursor=soon`,
      { companyId: COMPANY_ID },
    );
    // 422, the SPEC §7 code for validation_failed.
    expect(res.status).toBe(422);
  });

  it("refuses an over-large limit instead of silently clamping it", async () => {
    // parseLimit is the shared helper every other list uses: it 422s rather
    // than clamping, so a client asking for 99999 is told, not quietly given
    // 200 and left believing it has the whole history.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    let called = 0;
    sb.on("POST", "/rest/v1/rpc/api_contact_timeline", () => {
      called += 1;
      return [];
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/timeline?limit=99999`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(422);
    expect(called).toBe(0);
  });

  it("defaults the page size when no limit is given", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    let asked: number | null = null;
    sb.on("POST", "/rest/v1/rpc/api_contact_timeline", (req) => {
      asked = (req.body as { p_limit: number }).p_limit;
      return [];
    });
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/timeline`,
      { companyId: COMPANY_ID },
    );
    expect(asked).toBe(50);
  });
});

describe("#191 contact attribution (created/updated/deleted actors + names)", () => {
  it("POST records created_by_user_id = the caller", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => []); // no existing → insert path stamps created_by
    sb.on("POST", "/rest/v1/contacts", () => [contactRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contacts", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { phone_e164: "+14165550199", name: "Jo Smith" },
    });
    expect(res.status).toBe(201);
    const upsert = sb.find("POST", "/rest/v1/contacts")[0]
      .body as Record<string, unknown>;
    expect(upsert.created_by_user_id).toBe(auth.subject);
  });

  it("re-adding an EXISTING live contact updates it — preserves created_by, stamps updated_by, no upsert", async () => {
    const sb = stubWithRole("member");
    // An existing, non-deleted contact on this (company, phone).
    sb.on("GET", "/rest/v1/contacts", () => [{ id: CONTACT_ID, deleted_at: null }]);
    sb.on("PATCH", "/rest/v1/contacts", (call) => [
      { ...contactRow(), ...(call.body as Record<string, unknown>) },
    ]);
    // The PATCH answers with the same shape GET does, opt-out state included.
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contacts", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { phone_e164: "+14165550199", name: "Renamed" },
    });
    expect(res.status).toBe(201);
    // Takes the UPDATE path — never re-inserts (which would overwrite
    // created_by_user_id with the current caller).
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
    const patch = sb.find("PATCH", "/rest/v1/contacts")[0]
      .body as Record<string, unknown>;
    expect(patch.updated_by_user_id).toBe(auth.subject);
    expect(patch).not.toHaveProperty("created_by_user_id");
    expect(patch.name).toBe("Renamed");
  });

  it("GET resolves created_by_name/updated_by_name from profiles (the message-sender/assignment mechanism)", async () => {
    const OTHER = "1c2d3e4f-1111-4222-8333-444444444444";
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [
      contactRow({ created_by_user_id: auth.subject, updated_by_user_id: OTHER }),
    ]);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/profiles", () => [
      { user_id: auth.subject, display_name: "Casey Owner" },
      { user_id: OTHER, display_name: "Pat Rivera" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: CONTACT_ID,
      created_by_user_id: auth.subject,
      created_by_name: "Casey Owner",
      updated_by_user_id: OTHER,
      updated_by_name: "Pat Rivera",
    });
    // Names resolve via a single batched profiles lookup on the actor ids.
    const lookup = sb.find("GET", "/rest/v1/profiles")[0];
    expect(lookup.url.searchParams.get("user_id")).toBe(
      `in.(${auth.subject},${OTHER})`,
    );
  });

  it("GET returns null names for a pre-existing (actor-less) contact and never queries profiles", async () => {
    const sb = stubWithRole("member");
    // An older row: no created_by/updated_by columns recorded.
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.created_by_name).toBeNull();
    expect(body.updated_by_name).toBeNull();
    // No actor ids → no profiles round-trip.
    expect(sb.find("GET", "/rest/v1/profiles")).toHaveLength(0);
  });

  it("GET treats a blank profile display_name as unresolved (null name)", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [
      contactRow({ created_by_user_id: auth.subject }),
    ]);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/profiles", () => [
      { user_id: auth.subject, display_name: "" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      created_by_user_id: auth.subject,
      created_by_name: null,
    });
  });

  it("PATCH records updated_by_user_id on a field change", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("PATCH", "/rest/v1/contacts", () => [contactRow({ name: "Jo S." })]);
    // The PATCH answers with the same shape GET does, opt-out state included.
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { name: "Jo S." } },
    );
    expect(res.status).toBe(200);
    const patch = sb.find("PATCH", "/rest/v1/contacts")[0]
      .body as Record<string, unknown>;
    expect(patch.name).toBe("Jo S.");
    expect(patch.updated_by_user_id).toBe(auth.subject);
  });

  it("DELETE records deleted_by_user_id alongside deleted_at", async () => {
    const sb = stubWithRole("member");
    sb.on("PATCH", "/rest/v1/contacts", () => [{ id: CONTACT_ID }]);
    // The PATCH answers with the same shape GET does, opt-out state included.
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(204);
    const patch = sb.find("PATCH", "/rest/v1/contacts")[0]
      .body as Record<string, unknown>;
    expect(typeof patch.deleted_at).toBe("string");
    expect(patch.deleted_by_user_id).toBe(auth.subject);
  });

  it("CSV import stamps created_by_user_id on every imported row", async () => {
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) => {
      const rows = call.body as { phone_e164: string }[];
      return rows.map((row) => ({ id: CONTACT_ID, phone_e164: row.phone_e164 }));
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm("phone,name\n+14165550100,A\n+14165550101,B\n"),
      },
    );
    expect(res.status).toBe(200);
    const upsert = sb.find("POST", "/rest/v1/contacts")[0].body as Record<
      string,
      unknown
    >[];
    expect(upsert).toHaveLength(2);
    for (const row of upsert) {
      expect(row.created_by_user_id).toBe(auth.subject);
    }
  });

  it("list rows carry resolved created_by_name via a batched profiles lookup", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [
      contactRow({ created_by_user_id: auth.subject }),
    ]);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("GET", "/rest/v1/profiles", () => [
      { user_id: auth.subject, display_name: "Casey Owner" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contacts", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { created_by_name: string | null }[];
    };
    expect(body.data[0].created_by_name).toBe("Casey Owner");
  });
});

describe("POST /v1/contacts/import (O/A, CSV)", () => {
  it("#226: refuses an import that states no consent basis", async () => {
    // Every other door into this product records WHY we may text somebody: an
    // inbound text stamps `inbound_sms` automatically, and adding a contact by
    // hand requires the §5 attestation. Import was the one with no question at
    // all — and it is the highest-volume door, so a thousand numbers could
    // arrive with no recorded basis at all. That file is exactly what a
    // plaintiff's lawyer or a carrier audit asks about.
    const sb = stubWithRole("admin");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm("phone\n+14165550100\n", false),
      },
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.message).toContain("agreed to be texted");
  });

  it("#226: refuses before spending the upload", async () => {
    // The check runs BEFORE the CSV is parsed, so a caller does not upload two
    // megabytes and only then learn the request was never going to be
    // accepted. Asserted by sending a file that WOULD fail parsing: the
    // consent error must be the one that comes back.
    const sb = stubWithRole("admin");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm("this,is,not,a,contacts,file\n", false),
      },
    );

    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("agreed to be texted");
  });

  it("403s a plain member (role gate)", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm("phone\n+14165550199\n"),
      },
    );
    expect(res.status).toBe(403);
  });

  it("imports, updates, and reports malformed + duplicate rows; opted_out=true creates import-source opt-outs and events", async () => {
    const sb = stubWithRole("admin");
    // Pre-existing contact check: +14165550100 already exists.
    sb.on("GET", "/rest/v1/contacts", () => [
      { phone_e164: "+14165550100" },
    ]);
    sb.on("POST", "/rest/v1/contacts", (call) => {
      const rows = call.body as { phone_e164: string }[];
      return rows.map((row, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        phone_e164: row.phone_e164,
      }));
    });
    sb.on("GET", "/rest/v1/opt_outs", () => []); // none already active
    sb.on("PATCH", "/rest/v1/opt_outs", () => []); // no revoked row to revive
    sb.on("POST", "/rest/v1/opt_outs", () => [{ id: "0abc0abc-1111-4222-8333-444444444444" }]);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const csv = [
      "phone,name,address,opted_out",
      '4165550100,"Smith, Jo","1 Main St",',
      "416-555-0101,New Person,,TRUE",
      "not-a-phone,Bad Row,,",
      "+14165550100,Duplicate Of Row2,,", // same phone as row 2
      "+12425550199,Caribbean,,", // Bahamas — rejected
    ].join("\r\n");

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(csv) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      imported: 1, // +14165550101
      updated: 1, // +14165550100 existed
      skipped: 3,
      errors: [
        { row: 4, reason: expect.stringContaining("invalid phone") },
        { row: 5, reason: expect.stringContaining("duplicate phone") },
        { row: 6, reason: expect.stringContaining("invalid phone") },
      ],
    });

    // Upsert payload: E.164-normalized, deleted_at cleared, only CSV columns.
    // Writing the `address` column also resets the geocode cache (D25): a row
    // with an address queues geocode_status='pending', a row whose address cell
    // is empty settles to 'no_address' — exactly as POST/PATCH /contacts do, so
    // a re-import that CHANGES an already-geocoded contact's address re-geocodes.
    const upsert = sb.find("POST", "/rest/v1/contacts")[0];
    expect(upsert.body).toEqual([
      {
        company_id: COMPANY_ID,
        phone_e164: "+14165550100",
        deleted_at: null,
        created_by_user_id: auth.subject, // #191 attribution
        // #226: the attested basis, on every row the file creates.
        consent_source: "attested",
        consent_at: expect.any(String),
        consent_attested_by: auth.subject,
        name: "Smith, Jo",
        address: "1 Main St",
        lat: null,
        lng: null,
        geocoded_at: null,
        geocode_status: "pending",
      },
      {
        company_id: COMPANY_ID,
        phone_e164: "+14165550101",
        deleted_at: null,
        created_by_user_id: auth.subject, // #191 attribution
        consent_source: "attested",
        consent_at: expect.any(String),
        consent_attested_by: auth.subject,
        name: "New Person",
        address: null,
        lat: null,
        lng: null,
        geocoded_at: null,
        geocode_status: "no_address",
      },
    ]);
    expect(upsert.url.searchParams.get("on_conflict")).toBe(
      "company_id,phone_e164",
    );

    // opted_out=true row → opt_outs upsert with source='import'.
    const optOuts = sb.find("POST", "/rest/v1/opt_outs")[0].body as unknown[];
    expect(optOuts).toEqual([
      expect.objectContaining({
        company_id: COMPANY_ID,
        phone_e164: "+14165550101",
        source: "import",
        revoked_at: null,
      }),
    ]);
    const events = sb.find("POST", "/rest/v1/conversation_events")[0]
      .body as unknown[];
    expect(events).toEqual([
      expect.objectContaining({
        type: "opted_out",
        payload: { phone_e164: "+14165550101", source: "import" },
      }),
    ]);
  });

  it("strips the export's CSV-injection guard apostrophe from a name on import (lossless round-trip, D20 §3.1)", async () => {
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) => {
      const rows = call.body as { phone_e164: string }[];
      return rows.map((row, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        phone_e164: row.phone_e164,
      }));
    });
    stubFetch(jwksRoute(auth), sb.route);

    // A previously-exported guarded name: `'=HYPERLINK(...)` — the leading
    // apostrophe + comma force RFC quoting in the cell.
    const csv =
      'phone,name\r\n+14165550100,"\'=HYPERLINK(""http://evil"",""click"")"\r\n';
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(csv) },
    );
    expect(res.status).toBe(200);
    const upsert = sb.find("POST", "/rest/v1/contacts")[0].body as {
      name: string;
    }[];
    // The guard apostrophe is stripped: the stored name equals the original.
    expect(upsert[0].name).toBe('=HYPERLINK("http://evil","click")');
  });

  it("does not re-emit opt-out events for already-active opt-outs", async () => {
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", () => [
      { id: CONTACT_ID, phone_e164: "+14165550199" },
    ]);
    sb.on("GET", "/rest/v1/opt_outs", () => [{ phone_e164: "+14165550199" }]);
    sb.on("PATCH", "/rest/v1/opt_outs", () => []); // no revoked row to revive
    sb.on("POST", "/rest/v1/opt_outs", () => [{ id: "0abc0abc-1111-4222-8333-444444444444" }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm("phone,opted_out\n+14165550199,yes\n"),
      },
    );
    expect(res.status).toBe(200);
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });

  it("422s when the file field or phone column is missing", async () => {
    const sb = stubWithRole("admin");
    stubFetch(jwksRoute(auth), sb.route);

    const noFile = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: new FormData() },
    );
    expect(noFile.status).toBe(422);

    const noPhone = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm("name\nJo\n"),
      },
    );
    expect(noPhone.status).toBe(422);
  });

  it("#36: rejects an oversized declared Content-Length BEFORE buffering the body", async () => {
    const sb = stubWithRole("admin");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        // The declared size alone triggers the refusal — the (tiny) body is
        // never read, so no multipart parsing and no Supabase traffic happen.
        rawBody: "x",
        headers: {
          "Content-Length": String(4 * 1024 * 1024), // over the 3 MB ceiling
          "Content-Type": "multipart/form-data; boundary=b",
        },
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_failed");
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
  });
});

describe("import row numbering", () => {
  it("reports the line the reader sees, counting blank rows", async () => {
    // Entirely blank rows are dropped, and numbering the survivors by position
    // shifted every row after one. The wizard joins these numbers back against
    // its own preview to build the skipped-rows file, so a reason landed on the
    // wrong original line: an empty phone shown against a name that had one.
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", () => []);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    // Line 1 header, line 2 blank, line 3 the bad row.
    const csv = ["phone,name", ",", "not-a-phone,Bob"].join("\r\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(csv) },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { errors: { row: number; reason: string }[] };
    expect(body.errors).toEqual([
      { row: 3, reason: "invalid phone: not-a-phone" },
    ]);
  });
});

describe("import name handling", () => {
  it("a blank name cell leaves an existing contact's name alone", async () => {
    // The name column is decided for the WHOLE file, so one nameless row among
    // named ones used to null out a name the business had recorded: a contact
    // saved on someone's phone as a bare number blanked their stored name, and
    // the wizard reported it as an ordinary "updated" row.
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        phone_e164: row.phone_e164,
      })),
    );
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const csv = [
      "phone,name",
      "416-555-0101,Bob Builder",
      "416-555-0102,",
    ].join("\r\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(csv) },
    );
    expect(res.status).toBe(200);

    const batches = sb.find("POST", "/rest/v1/contacts");
    const rows = batches.flatMap((call) => call.body as Record<string, unknown>[]);
    const named = rows.find((row) => row.phone_e164 === "+14165550101");
    const nameless = rows.find((row) => row.phone_e164 === "+14165550102");
    expect(named?.name).toBe("Bob Builder");
    // The key is ABSENT, so the upsert cannot write null over a stored name.
    expect(nameless && "name" in nameless).toBe(false);
  });

  it("re-imports a guarded phone from our own export", async () => {
    // The export apostrophe-guards E.164 so a spreadsheet does not evaluate it.
    // Normalization strips every non-digit, so the guard survives a round trip.
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        phone_e164: row.phone_e164,
      })),
    );
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const csv = ["phone,name", "'+14165550101,Bob Builder"].join("\r\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(csv) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 1, skipped: 0 });
    const rows = sb
      .find("POST", "/rest/v1/contacts")
      .flatMap((call) => call.body as Record<string, unknown>[]);
    expect(rows[0]?.phone_e164).toBe("+14165550101");
  });
});

describe("import and a standing carrier STOP", () => {
  it("never rewrites an active opt-out, so a STOP stays unrevokable", async () => {
    // A STOP can only be lifted by the customer. There is ONE opt_outs row per
    // (company, phone), so an import that upserted over it turned
    // source='stop_keyword' into 'import' and the revoke guard stopped firing:
    // the app would then let someone "opt them back in" while the carrier
    // block stood, and every send failed 40300 against a contact the UI showed
    // as textable.
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        phone_e164: row.phone_e164,
      })),
    );
    // The number already carries a STANDING opt-out.
    sb.on("GET", "/rest/v1/opt_outs", () => [{ phone_e164: "+14165550101" }]);
    sb.on("PATCH", "/rest/v1/opt_outs", () => []); // nothing revoked to revive
    sb.on("POST", "/rest/v1/opt_outs", () => []); // the active row wins
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const csv = ["phone,name,opted_out", "416-555-0101,New Person,TRUE"].join(
      "\r\n",
    );
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(csv) },
    );
    expect(res.status).toBe(200);

    // The insert must be ON CONFLICT DO NOTHING, so an active row of ANY
    // source is left exactly as it stands.
    const insert = sb.find("POST", "/rest/v1/opt_outs")[0];
    expect(insert.url.searchParams.get("on_conflict")).toBe("company_id,phone_e164");
    expect(insert.headers.get("prefer") ?? "").toContain("ignore-duplicates");

    // The revive only ever touches rows that are already revoked.
    const revive = sb.find("PATCH", "/rest/v1/opt_outs")[0];
    expect(revive.url.searchParams.get("revoked_at")).toBe("not.is.null");
  });
});

describe("opt-out mark/revoke (SPEC §5)", () => {
  it("POST /v1/contacts/:id/opt-out writes a manual opt-out + event", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("PATCH", "/rest/v1/opt_outs", () => []); // no revoked row to revive
    sb.on("POST", "/rest/v1/opt_outs", (call) => [
      { id: "0abc0abc-1111-4222-8333-444444444444", ...(call.body as object) },
    ]); // brand-new opt-out wins the insert
    sb.on("GET", "/rest/v1/conversations", () => [
      { id: "aaaaaaaa-1111-4222-8333-444444444444" },
    ]);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/opt-out`,
      { method: "POST", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(201);
    const upsert = sb.find("POST", "/rest/v1/opt_outs")[0];
    expect(upsert.body).toMatchObject({
      phone_e164: "+14165550199",
      source: "manual",
      created_by: auth.subject,
      revoked_at: null,
    });
    const events = sb.find("POST", "/rest/v1/conversation_events")[0]
      .body as unknown[];
    expect(events).toEqual([
      expect.objectContaining({
        type: "opted_out",
        // attaches to the contact's most recent conversation
        conversation_id: "aaaaaaaa-1111-4222-8333-444444444444",
        payload: { phone_e164: "+14165550199", source: "manual" },
      }),
    ]);
  });

  it("is idempotent: an active opt-out returns 200 with no new event", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("PATCH", "/rest/v1/opt_outs", () => []); // nothing revoked to revive
    sb.on("POST", "/rest/v1/opt_outs", () => []); // ON CONFLICT DO NOTHING → no-op
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { id: "0abc0abc-1111-4222-8333-444444444444", phone_e164: "+14165550199" },
    ]); // the current active row, returned unchanged
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/opt-out`,
      { method: "POST", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    // The insert was attempted but conflicted (no-op); the KEY invariant is no
    // duplicate timeline event.
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });

  it("revoke (POST …/opt-out/revoke and DELETE …/opt-out) sets revoked_at + event; 404 when not opted out", async () => {
    for (const [method, path] of [
      ["POST", `/v1/contacts/${CONTACT_ID}/opt-out/revoke`],
      ["DELETE", `/v1/contacts/${CONTACT_ID}/opt-out`],
    ] as const) {
      const sb = stubWithRole("member");
      sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
      // A manually recorded opt-out: someone in the office wrote it down, so
      // there is no carrier block and undoing it here is the whole truth.
      sb.on("GET", "/rest/v1/opt_outs", () => [
        { id: "0abc0abc-1111-4222-8333-444444444444", source: "manual" },
      ]);
      sb.on("PATCH", "/rest/v1/opt_outs", (call) => [
        { id: "0abc0abc-1111-4222-8333-444444444444", ...(call.body as object) },
      ]);
      sb.on("GET", "/rest/v1/conversations", () => []);
      sb.on("POST", "/rest/v1/conversation_events", () => []);
      stubFetch(jwksRoute(auth), sb.route);

      const res = await apiRequest(app, env, await auth.token(), path, {
        method,
        companyId: COMPANY_ID,
      });
      expect(res.status, `${method} ${path}`).toBe(200);
      const update = sb.find("PATCH", "/rest/v1/opt_outs")[0];
      expect(
        typeof (update.body as Record<string, unknown>).revoked_at,
      ).toBe("string");
      expect(update.url.searchParams.get("revoked_at")).toBe("is.null");
      const events = sb.find("POST", "/rest/v1/conversation_events")[0]
        .body as { type: string }[];
      expect(events.map((e) => e.type)).toEqual(["opt_out_revoked"]);
      vi.unstubAllGlobals();
    }

    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/opt-out/revoke`,
      { method: "POST", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(404);
  });

  it("refuses to revoke a STOP the customer sent, and writes nothing", async () => {
    // A STOP is a CARRIER block. Clearing our row would not clear theirs: the
    // next send still comes back 40300 while the contact page says the person
    // can be texted. Production hit exactly that (revoke at 08:38:44, send
    // rejected at 08:38:53), so the revoke is refused instead.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { id: "0abc0abc-1111-4222-8333-444444444444", source: "stop_keyword" },
    ]);
    sb.on("PATCH", "/rest/v1/opt_outs", () => []);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/opt-out/revoke`,
      { method: "POST", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("texting START");
    // The ledger and the timeline are both untouched — a refusal that still
    // wrote would leave the same contradiction it exists to prevent.
    expect(sb.find("PATCH", "/rest/v1/opt_outs")).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });

  it("reports which kind of opt-out a contact has", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { id: "0abc0abc-1111-4222-8333-444444444444", source: "stop_keyword" },
    ]);
    sb.on("GET", "/rest/v1/conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      opted_out: boolean;
      opt_out_source: string | null;
    };
    expect(body.opted_out).toBe(true);
    expect(body.opt_out_source).toBe("stop_keyword");
  });
});

function vcardForm(vcf: string): FormData {
  const form = new FormData();
  form.append("file", new File([vcf], "contacts.vcf", { type: "text/vcard" }));
  return form;
}

describe("GET /v1/contacts/export (D20 §3.1)", () => {
  it("streams a BOM-prefixed CSV with the round-trip columns and joined tags", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [
      {
        id: CONTACT_ID,
        name: "Jo, Smith", // comma → must be CSV-quoted
        phone_e164: "+14165550199",
        consent_source: "attested",
        consent_at: "2026-06-01T00:00:00+00:00",
        created_at: "2026-05-01T00:00:00+00:00",
      },
    ]);
    // Tags via conversations→conversation_tags→tags.
    sb.on("GET", "/rest/v1/conversations", () => [
      {
        contact_id: CONTACT_ID,
        conversation_tags: [{ tags: { name: "Quote sent" } }, { tags: { name: "Won" } }],
      },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/export",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("contacts.csv");
    // The body carries a literal UTF-8 BOM (EF BB BF) for Excel. `Response.text()`
    // strips a leading BOM per the WHATWG decode algorithm, so assert on the raw
    // bytes (what a browser download / Excel actually receives).
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder("utf-8").decode(bytes.slice(3));
    const lines = text.split("\r\n");
    expect(lines[0]).toBe(
      "name,phone,tags,consent_source,consent_at,created_at",
    );
    // Comma-containing name is quoted; tags ';'-joined. The phone carries the
    // injection guard because E.164 always starts with "+", which a spreadsheet
    // evaluates as arithmetic.
    expect(lines[1]).toBe(
      `"Jo, Smith",'+14165550199,Quote sent;Won,attested,2026-06-01T00:00:00+00:00,2026-05-01T00:00:00+00:00`,
    );
    // Export respects company scope + soft-delete exclusion.
    const call = sb.find("GET", "/rest/v1/contacts")[0];
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(call.url.searchParams.get("deleted_at")).toBe("is.null");
  });

  it("chunks the tag lookup so a large export never builds an over-long .in() URL", async () => {
    const sb = stubWithRole("member");
    const contacts = Array.from({ length: 250 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      name: `C${i}`,
      phone_e164: `+1416555${String(1000 + i)}`,
      consent_source: "attested",
      consent_at: "2026-06-01T00:00:00+00:00",
      created_at: "2026-05-01T00:00:00+00:00",
    }));
    sb.on("GET", "/rest/v1/contacts", () => contacts);
    sb.on("GET", "/rest/v1/conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/export",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);

    // 250 contacts → two chunked lookups (200 + 50), never one giant .in()
    // whose URL PostgREST/the Worker would reject.
    const convCalls = sb.find("GET", "/rest/v1/conversations");
    expect(convCalls).toHaveLength(2);
    for (const convCall of convCalls) {
      const inParam = convCall.url.searchParams.get("contact_id") ?? "";
      const ids = inParam.replace(/^in\.\(/, "").replace(/\)$/, "").split(",");
      expect(ids.length).toBeLessThanOrEqual(200);
    }
  });

  it("neutralizes CSV/formula injection in every column including the phone (OWASP)", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [
      {
        id: CONTACT_ID,
        name: '=HYPERLINK("http://evil","click")',
        phone_e164: "+14165550199",
        consent_source: "attested",
        consent_at: "2026-06-01T00:00:00+00:00",
        created_at: "2026-05-01T00:00:00+00:00",
      },
    ]);
    sb.on("GET", "/rest/v1/conversations", () => [
      {
        contact_id: CONTACT_ID,
        // A tag crafted to trigger a formula on open.
        conversation_tags: [{ tags: { name: "+1+1" } }],
      },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/export",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder("utf-8").decode(bytes.slice(3));
    const line = text.split("\r\n")[1];
    // The formula name is apostrophe-guarded (then RFC-quoted because it also
    // contains a comma); the tag is guarded; and so is the phone, whose leading
    // "+" Excel would otherwise evaluate, showing 1.6478E+10 and losing the
    // country code from anything the user copies out to dial.
    expect(line).toBe(
      `"'=HYPERLINK(""http://evil"",""click"")",'+14165550199,'+1+1,attested,2026-06-01T00:00:00+00:00,2026-05-01T00:00:00+00:00`,
    );
  });

  it("respects the current q filter (export what I'm looking at) and is not shadowed by /:id", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/export?q=smi",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    // The literal /export route ran (not /:id, which would 404 on a non-uuid).
    const call = sb.find("GET", "/rest/v1/contacts")[0];
    expect(call.url.searchParams.get("or")).toBe(
      "(name.ilike.*smi*,phone_e164.ilike.*smi*,business_name.ilike.*smi*,email.ilike.*smi*)",
    );
  });
});

describe("POST /v1/contacts/import-vcard (D20 §3.2)", () => {
  const multiVcf = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Alice Adams",
    "TEL;TYPE=CELL:(416) 555-0111",
    "END:VCARD",
    "BEGIN:VCARD",
    "VERSION:4.0",
    "FN:Bob Baker",
    "TEL;VALUE=uri:tel:+15125550122",
    "TEL;TYPE=work:212-555-0133", // a second valid number → a second contact
    "END:VCARD",
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:No Phone",
    "END:VCARD",
  ].join("\r\n");

  it("parses a multi-card .vcf, normalizes E.164, and upserts (admin only)", async () => {
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/contacts", () => []); // none pre-existing → all imported
    sb.on("POST", "/rest/v1/contacts", () => [{ id: CONTACT_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import-vcard",
      { method: "POST", companyId: COMPANY_ID, rawBody: vcardForm(multiVcf) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      imported: number;
      updated: number;
      skipped: number;
      errors: { row: number; reason: string }[];
    };
    // Three distinct valid numbers across the cards (Alice ×1, Bob ×2).
    expect(body.imported).toBe(3);
    expect(body.updated).toBe(0);
    // The card with no TEL is skipped with a reason.
    expect(body.skipped).toBe(1);
    expect(body.errors[0].reason).toBe("no phone number");

    // The upsert carried the E.164-normalized phones + names, company-scoped.
    const upsert = sb.find("POST", "/rest/v1/contacts")[0];
    const rows = upsert.body as { phone_e164: string; name?: string; company_id: string }[];
    const phones = rows.map((r) => r.phone_e164).sort();
    expect(phones).toEqual(["+14165550111", "+12125550133", "+15125550122"].sort());
    for (const row of rows) {
      expect(row.company_id).toBe(COMPANY_ID);
    }
    // Bob's two numbers both carry his name.
    const bobRow = rows.find((r) => r.phone_e164 === "+15125550122");
    expect(bobRow?.name).toBe("Bob Baker");
  });

  it("counts pre-existing numbers as updated, not imported", async () => {
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/contacts", () => [{ phone_e164: "+14165550111" }]);
    sb.on("POST", "/rest/v1/contacts", () => [{ id: CONTACT_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Alice Adams",
      "TEL:+14165550111",
      "END:VCARD",
    ].join("\r\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import-vcard",
      { method: "POST", companyId: COMPANY_ID, rawBody: vcardForm(vcf) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { imported: number; updated: number };
    expect(body.imported).toBe(0);
    expect(body.updated).toBe(1);
  });

  it("reports un-normalizable TELs per row and dedupes numbers within the file", async () => {
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", () => [{ id: CONTACT_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const vcf = [
      "BEGIN:VCARD",
      "FN:Bad Number",
      "TEL:+44 20 7946 0000", // non-US/CA → dropped with a reason
      "END:VCARD",
      "BEGIN:VCARD",
      "FN:Dup One",
      "TEL:+14165550111",
      "END:VCARD",
      "BEGIN:VCARD",
      "FN:Dup Two",
      "TEL:416-555-0111", // same normalized number → duplicate in file
      "END:VCARD",
    ].join("\r\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import-vcard",
      { method: "POST", companyId: COMPANY_ID, rawBody: vcardForm(vcf) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      imported: number;
      skipped: number;
      errors: { row: number; reason: string }[];
    };
    expect(body.imported).toBe(1); // only +14165550111, once
    const reasons = body.errors.map((e) => e.reason);
    expect(reasons.some((r) => r.startsWith("invalid phone"))).toBe(true);
    expect(reasons.some((r) => r.startsWith("duplicate phone in file"))).toBe(
      true,
    );
  });

  it("403s a plain member (import is owner/admin, matching CSV import)", async () => {
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import-vcard",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: vcardForm("BEGIN:VCARD\r\nFN:X\r\nTEL:+14165550111\r\nEND:VCARD"),
      },
    );
    expect(res.status).toBe(403);
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("422s a .vcf with no VCARD blocks", async () => {
    const sb = stubWithRole("admin");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import-vcard",
      { method: "POST", companyId: COMPANY_ID, rawBody: vcardForm("not a vcard") },
    );
    expect(res.status).toBe(422);
  });

  it("#36: rejects an oversized declared Content-Length BEFORE buffering the body", async () => {
    const sb = stubWithRole("admin");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import-vcard",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: "x",
        headers: {
          "Content-Length": String(7 * 1024 * 1024), // over the 6 MB ceiling
          "Content-Type": "multipart/form-data; boundary=b",
        },
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_failed");
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
  });
});

describe("geocode cache reset on address writes (D25)", () => {
  it("clears the geocode cache on POST /v1/contacts when an address is set", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => []); // no existing → insert path
    sb.on("POST", "/rest/v1/contacts", () => [contactRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contacts", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { phone_e164: "+14165550199", address: "1 King St W, Toronto" },
    });
    expect(res.status).toBe(201);
    const upsert = sb.find("POST", "/rest/v1/contacts")[0]
      .body as Record<string, unknown>;
    expect(upsert).toMatchObject({
      address: "1 King St W, Toronto",
      lat: null,
      lng: null,
      geocoded_at: null,
      geocode_status: "pending",
    });
  });

  it("does NOT touch the geocode cache when no address is provided", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => []); // no existing → insert path
    sb.on("POST", "/rest/v1/contacts", () => [contactRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contacts", {
      method: "POST",
      companyId: COMPANY_ID,
      body: { phone_e164: "+14165550199", name: "Jo" },
    });
    expect(res.status).toBe(201);
    const upsert = sb.find("POST", "/rest/v1/contacts")[0]
      .body as Record<string, unknown>;
    expect(upsert).not.toHaveProperty("geocode_status");
  });

  it("clears the geocode cache on PATCH /v1/contacts/:id when address changes", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("PATCH", "/rest/v1/contacts", () => [contactRow({ address: "New Addr" })]);
    // The PATCH answers with the same shape GET does, opt-out state included.
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { address: "New Addr" } },
    );
    expect(res.status).toBe(200);
    const patch = sb.find("PATCH", "/rest/v1/contacts")[0]
      .body as Record<string, unknown>;
    expect(patch).toMatchObject({
      address: "New Addr",
      geocode_status: "pending",
      lat: null,
      lng: null,
    });
  });

  it("sets geocode_status=no_address on PATCH when the address is cleared to null", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("PATCH", "/rest/v1/contacts", () => [contactRow({ address: null })]);
    // The PATCH answers with the same shape GET does, opt-out state included.
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { address: null } },
    );
    expect(res.status).toBe(200);
    const patch = sb.find("PATCH", "/rest/v1/contacts")[0]
      .body as Record<string, unknown>;
    expect(patch).toMatchObject({ address: null, geocode_status: "no_address" });
  });

  it("re-queues geocoding on CSV import when the address column is written", async () => {
    const sb = stubWithRole("admin");
    // Pre-existing contact (already geocoded in reality) → this is an UPDATE.
    sb.on("GET", "/rest/v1/contacts", () => [{ phone_e164: "+14165550100" }]);
    sb.on("POST", "/rest/v1/contacts", (call) => {
      const rows = call.body as { phone_e164: string }[];
      return rows.map((row) => ({ id: CONTACT_ID, phone_e164: row.phone_e164 }));
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        // One row with a (changed) address, one with an empty address cell.
        rawBody: importForm(
          "phone,address\n+14165550100,99 New St\n+14165550101,\n",
        ),
      },
    );
    expect(res.status).toBe(200);
    const upsert = sb.find("POST", "/rest/v1/contacts")[0].body as Record<
      string,
      unknown
    >[];
    // Present address → 'pending' (re-geocode); empty cell → 'no_address'; both
    // clear the cached lat/lng so the Map view never plots a stale coordinate.
    expect(upsert[0]).toMatchObject({
      address: "99 New St",
      lat: null,
      lng: null,
      geocoded_at: null,
      geocode_status: "pending",
    });
    expect(upsert[1]).toMatchObject({
      address: null,
      geocode_status: "no_address",
    });
  });

  it("does NOT touch the geocode cache on CSV import with no address column", async () => {
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) => {
      const rows = call.body as { phone_e164: string }[];
      return rows.map((row) => ({ id: CONTACT_ID, phone_e164: row.phone_e164 }));
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm("phone,name\n+14165550100,Jo\n"),
      },
    );
    expect(res.status).toBe(200);
    const upsert = sb.find("POST", "/rest/v1/contacts")[0].body as Record<
      string,
      unknown
    >[];
    expect(upsert[0]).not.toHaveProperty("geocode_status");
    expect(upsert[0]).not.toHaveProperty("address");
  });
});

describe("#246 merging two contacts for the same customer", () => {
  it("folds one into the other and reports what moved", async () => {
    const sb = stubWithRole("admin");
    sb.on("POST", "/rest/v1/rpc/api_merge_contacts", () => ({
      outcome: "merged",
      moved: 3,
      closed: 1,
      opted_out: true,
      from_phone: "+14155550501",
      into_phone: "+14155550502",
    }));
    sb.on("POST", "/rest/v1/audit_log", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/merge`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { into_contact_id: OTHER_ID },
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      merged: true,
      moved: 3,
      closed: 1,
      opted_out: true,
    });
  });

  it("records what the merge actually did, including both numbers", async () => {
    // #246 asks for undo OR a full record. Both — and after the merge one of
    // these numbers is the only way to say which record was folded in.
    const sb = stubWithRole("admin");
    sb.on("POST", "/rest/v1/rpc/api_merge_contacts", () => ({
      outcome: "merged",
      moved: 2,
      closed: 0,
      opted_out: false,
      from_phone: "+14155550501",
      into_phone: "+14155550502",
    }));
    sb.on("POST", "/rest/v1/audit_log", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(app, env, await auth.token(), `/v1/contacts/${CONTACT_ID}/merge`, {
      method: "POST",
      companyId: COMPANY_ID,
      body: { into_contact_id: OTHER_ID },
    });
    expect(sb.find("POST", "/rest/v1/audit_log")[0].body).toMatchObject({
      action: "contact.merged",
      after: {
        merged_contact_id: CONTACT_ID,
        from_phone: "+14155550501",
        conversations_moved: 2,
      },
    });
  });

  it("refuses to build a chain, and says where to go instead", async () => {
    // Every reader follows merged_into exactly one hop, so a chain would make
    // that depth unknown. The message has to name the recovery, or somebody
    // retries the same thing.
    const sb = stubWithRole("admin");
    sb.on("POST", "/rest/v1/rpc/api_merge_contacts", () => ({
      outcome: "already_merged",
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/merge`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { into_contact_id: OTHER_ID },
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("surviving contact");
  });

  it("is not a member's call", async () => {
    // A merge rewrites whose history is whose and cannot be fully undone —
    // the row comes back, but which thread came from which record does not.
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/merge`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { into_contact_id: OTHER_ID },
      },
    );
    expect(res.status).toBe(403);
    expect(sb.find("POST", "/rest/v1/rpc/api_merge_contacts")).toHaveLength(0);
  });

  it("undoes a merge without undoing the opt-out", async () => {
    const sb = stubWithRole("admin");
    sb.on("POST", "/rest/v1/rpc/api_unmerge_contact", () => ({
      outcome: "unmerged",
      phone: "+14155550501",
    }));
    sb.on("POST", "/rest/v1/audit_log", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/unmerge`,
      { method: "POST", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    expect(sb.find("POST", "/rest/v1/audit_log")[0].body).toMatchObject({
      action: "contact.unmerged",
    });
  });

  it("lists likely duplicates rather than treating the word as a contact id", async () => {
    // Hono matches in REGISTRATION order. Registered after `/contacts/:id`,
    // this path is swallowed by the pattern and "duplicates" is parsed as a
    // uuid — which is exactly what happened on the first attempt.
    const sb = stubWithRole("member");
    sb.on("POST", "/rest/v1/rpc/api_duplicate_contacts", () => [
      {
        contact_a: CONTACT_ID,
        name_a: "Mike",
        phone_a: "+14155550501",
        contact_b: OTHER_ID,
        name_b: "Michael Chen",
        phone_b: "+14155550502",
        reason: "same digits",
      },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/duplicates",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { reason: string }[] };
    expect(body.data[0].reason).toBe("same digits");
  });
});

/**
 * #291 — the fields a crew actually needs.
 *
 * The email guard is the one worth having: quote delivery (#287) and receipts
 * (#224) will trust this field, and a phone number stored in it fails at the
 * moment somebody is waiting for a quote rather than at the moment it was
 * typed.
 */
describe("#291 email and business name", () => {
  it("CN-1: stores an email and a business name", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", () => [contactRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contacts", {
      method: "POST",
      companyId: COMPANY_ID,
      body: {
        phone_e164: "(416) 555-0199",
        email: "dave@mapleproperty.example",
        business_name: "Maple Property Group",
      },
    });

    expect(res.status).toBe(201);
    expect(sb.find("POST", "/rest/v1/contacts")[0].body).toMatchObject({
      email: "dave@mapleproperty.example",
      business_name: "Maple Property Group",
    });
  });

  it("CN-2: refuses something that is plainly not an email", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", () => [contactRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    for (const email of ["not-an-email", "+16135550000", "a@b", "no spaces@x.com y"]) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        "/v1/contacts",
        {
          method: "POST",
          companyId: COMPANY_ID,
          body: { phone_e164: "(416) 555-0199", email },
        },
      );
      expect(res.status, email).toBe(422);
    }
  });

  it("CN-3: a mistyped email can be cleared", async () => {
    // A field somebody cannot empty is a field they stop trusting — and the
    // wrong email is worse than none, because a quote goes to a stranger.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("PATCH", "/rest/v1/contacts", () => [contactRow()]);
    // The same three a PATCH always touches: the opt-out check, the thread it
    // might annotate, and the event it writes there.
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { method: "PATCH", companyId: COMPANY_ID, body: { email: null } },
    );

    expect(res.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/contacts")[0].body).toMatchObject({
      email: null,
    });
  });

  it("CN-4: search reaches the business name and the email", () => {
    // The issue's whole complaint is that this knowledge is unfindable.
    // "Maple" has to find Dave at Maple Property Group.
    const arm = contactSearchOr("maple");
    expect(arm).toContain("business_name.ilike.*maple*");
    expect(arm).toContain("email.ilike.*maple*");
  });
});

/**
 * #291 — a contact's addresses.
 *
 * Every test here is about the PRIMARY flag, because that is the one whose
 * failure is silent: a contact with two primaries or none is not an error
 * state anywhere, and whichever row the query happens to return is where the
 * van goes.
 */
describe("#291 contact addresses", () => {
  const ADDRESS_ID = "eeeeeeee-1111-4222-8333-444444444444";

  function addressWorld(existing: Record<string, unknown>[] = []) {
    const sb = stubWithRole("member", existing);
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("POST", "/rest/v1/contact_addresses", () => [
      { id: ADDRESS_ID, address: "12 Elm St", is_primary: true },
    ]);
    sb.on("PATCH", "/rest/v1/contact_addresses", () => [
      { id: ADDRESS_ID, address: "12 Elm St", is_primary: true },
    ]);
    sb.on("DELETE", "/rest/v1/contact_addresses", () => [
      { id: ADDRESS_ID, is_primary: false },
    ]);
    stubFetch(jwksRoute(auth), sb.route);
    return sb;
  }

  it("AD-1: the FIRST address is primary whether or not anybody said so", async () => {
    // A contact whose only address is not the primary has no answer to "where
    // is this job", which is the single question the flag exists for.
    const sb = addressWorld([]);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/addresses`,
      { method: "POST", companyId: COMPANY_ID, body: { address: "12 Elm St" } },
    );

    expect(res.status).toBe(201);
    expect(sb.find("POST", "/rest/v1/contact_addresses")[0].body).toMatchObject({
      is_primary: true,
    });
  });

  it("AD-2: a second address is NOT primary unless asked", async () => {
    const sb = addressWorld([{ id: "other", is_primary: true }]);

    await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/addresses`,
      { method: "POST", companyId: COMPANY_ID, body: { address: "99 Oak Ave" } },
    );

    expect(sb.find("POST", "/rest/v1/contact_addresses")[0].body).toMatchObject({
      is_primary: false,
    });
  });

  it("AD-3: making one primary DEMOTES the old one first", async () => {
    // The partial unique index refuses two primaries at any instant, so
    // promoting before demoting would collide with the row being replaced.
    const sb = addressWorld([{ id: "other", is_primary: true }]);

    await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/addresses`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { address: "99 Oak Ave", is_primary: true },
      },
    );

    const demote = sb.find("PATCH", "/rest/v1/contact_addresses")[0];
    expect(demote).toBeDefined();
    expect(demote.body).toMatchObject({ is_primary: false });
    // And it happened BEFORE the insert, which is the whole point.
    const order = sb.calls.map((call) => `${call.method} ${call.path}`);
    expect(order.indexOf("PATCH /rest/v1/contact_addresses")).toBeLessThan(
      order.indexOf("POST /rest/v1/contact_addresses"),
    );
  });

  it("AD-4: deleting the primary promotes the oldest survivor", async () => {
    // Leaving a contact with addresses but no primary sends a van nowhere —
    // and it would happen on the most ordinary action there is.
    const sb = stubWithRole("member", [{ id: "survivor" }]);
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("DELETE", "/rest/v1/contact_addresses", () => [
      { id: ADDRESS_ID, is_primary: true },
    ]);
    sb.on("PATCH", "/rest/v1/contact_addresses", () => [{ id: "survivor" }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/addresses/${ADDRESS_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );

    expect(res.status).toBe(204);
    expect(sb.find("PATCH", "/rest/v1/contact_addresses")[0].body).toMatchObject({
      is_primary: true,
    });
  });

  it("AD-5: deleting a NON-primary promotes nobody", async () => {
    const sb = addressWorld();

    await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/addresses/${ADDRESS_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );

    expect(sb.find("PATCH", "/rest/v1/contact_addresses")).toHaveLength(0);
  });

  it("AD-6: the list is capped, so one contact cannot become a database", async () => {
    addressWorld(
      Array.from({ length: 50 }, (_, index) => ({ id: `a${index}`, is_primary: false })),
    );

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/addresses`,
      { method: "POST", companyId: COMPANY_ID, body: { address: "51 Elm St" } },
    );

    expect(res.status).toBe(422);
  });

  it("AD-7: addresses ride the contact detail, not a second request", async () => {
    const sb = stubWithRole("member", [
      { id: ADDRESS_ID, label: "Site", address: "12 Elm St", is_primary: true },
    ]);
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { companyId: COMPANY_ID },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { addresses: unknown[] };
    expect(body.addresses).toHaveLength(1);
  });
});

/**
 * #291 — a workspace's own contact fields.
 *
 * CFA-10 is the one that matters most. A PUT rewrites the DEFINITIONS; it must
 * not go anywhere near the VALUES. Removing a field from the settings screen
 * and finding a customer's gate code gone is not a bug anyone reports as a bug
 * — it just looks like the data was never there.
 */
describe("contact field definitions", () => {
  const fieldRow = (overrides: Record<string, unknown> = {}) => ({
    key: "boiler_model",
    label: "Boiler model",
    kind: "text",
    options: null,
    position: 0,
    ...overrides,
  });

  it("CFA-1: lists a workspace's fields in the order it put them in", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contact_field_defs", () => [
      fieldRow(),
      fieldRow({ key: "gate_code", label: "Gate code", position: 1 }),
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contact-fields", {
      companyId: COMPANY_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { key: string }[]; cap: number };
    expect(body.data.map((f) => f.key)).toEqual(["boiler_model", "gate_code"]);
    // The cap travels with the list so the UI can say "that is all 10" without
    // hardcoding a number that then drifts from the server's.
    expect(body.cap).toBe(10);

    const call = sb.find("GET", "/rest/v1/contact_field_defs")[0];
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(call.url.searchParams.get("order")).toContain("position.asc");
  });

  it("CFA-2: replaces the whole set and numbers it by array order", async () => {
    const sb = stubWithRole("owner");
    sb.on("DELETE", "/rest/v1/contact_field_defs", () => []);
    sb.on("POST", "/rest/v1/contact_field_defs", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contact-fields", {
      method: "PUT",
      companyId: COMPANY_ID,
      body: {
        fields: [
          { key: "gate_code", label: "Gate code", kind: "text" },
          { key: "boiler_model", label: "Boiler model", kind: "text" },
        ],
      },
    });
    expect(res.status).toBe(200);

    // The delete is SCOPED. An unscoped one would empty every workspace on the
    // platform, and the test that only checks the response would pass.
    const del = sb.find("DELETE", "/rest/v1/contact_field_defs")[0];
    expect(del.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);

    const insert = sb.find("POST", "/rest/v1/contact_field_defs")[0];
    const rows = insert.body as Record<string, unknown>[];
    expect(rows.map((r) => [r.key, r.position])).toEqual([
      ["gate_code", 0],
      ["boiler_model", 1],
    ]);
    expect(rows.every((r) => r.company_id === COMPANY_ID)).toBe(true);
  });

  it("CFA-3: refuses two fields with the same key", async () => {
    const sb = stubWithRole("owner");
    sb.on("DELETE", "/rest/v1/contact_field_defs", () => []);
    sb.on("POST", "/rest/v1/contact_field_defs", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contact-fields", {
      method: "PUT",
      companyId: COMPANY_ID,
      body: {
        fields: [
          { key: "gate_code", label: "Gate code", kind: "text" },
          { key: "gate_code", label: "Gate code again", kind: "text" },
        ],
      },
    });
    expect(res.status).toBe(422);
    // Refused BEFORE the delete: a rejected save must leave the old set intact.
    expect(sb.find("DELETE", "/rest/v1/contact_field_defs")).toHaveLength(0);
  });

  it("CFA-4: a dropdown needs choices, and nothing else may have them", async () => {
    const sb = stubWithRole("owner");
    sb.on("DELETE", "/rest/v1/contact_field_defs", () => []);
    sb.on("POST", "/rest/v1/contact_field_defs", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const empty = await apiRequest(app, env, await auth.token(), "/v1/contact-fields", {
      method: "PUT",
      companyId: COMPANY_ID,
      body: { fields: [{ key: "system_type", label: "System type", kind: "select" }] },
    });
    expect(empty.status).toBe(422);

    const stray = await apiRequest(app, env, await auth.token(), "/v1/contact-fields", {
      method: "PUT",
      companyId: COMPANY_ID,
      body: {
        fields: [
          { key: "has_dog", label: "Dog on site", kind: "checkbox", options: ["yes"] },
        ],
      },
    });
    expect(stray.status).toBe(422);
  });

  it("CFA-5: stops at the cap", async () => {
    const sb = stubWithRole("owner");
    sb.on("DELETE", "/rest/v1/contact_field_defs", () => []);
    sb.on("POST", "/rest/v1/contact_field_defs", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contact-fields", {
      method: "PUT",
      companyId: COMPANY_ID,
      body: {
        fields: Array.from({ length: 11 }, (_unused, index) => ({
          key: `field_${index}`,
          label: `Field ${index}`,
          kind: "text",
        })),
      },
    });
    expect(res.status).toBe(422);
  });

  it("CFA-6: defining a field is workspace configuration, not note-taking", async () => {
    // A member can WRITE a value on a contact (conversations.note) but cannot
    // change what fields exist — that reshapes every contact for the whole crew.
    const sb = stubWithRole("member");
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/contact-fields", {
      method: "PUT",
      companyId: COMPANY_ID,
      body: { fields: [] },
    });
    expect(res.status).toBe(403);
  });

  it("CFA-7: refuses a value for a field that does not exist", async () => {
    // Rather than dropping it. Dropping is the failure where somebody types the
    // gate code into a stale form, watches it save, and finds it gone tomorrow.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("GET", "/rest/v1/contact_field_defs", () => []);
    sb.on("PATCH", "/rest/v1/contacts", () => [contactRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      {
        method: "PATCH",
        companyId: COMPANY_ID,
        body: { custom_fields: { gate_code: "1234" } },
      },
    );
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("gate_code");
    expect(sb.find("PATCH", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("CFA-8: names the field when a value is the wrong shape", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("GET", "/rest/v1/contact_field_defs", () => [
      fieldRow({ key: "warranty", label: "Warranty expiry", kind: "date" }),
    ]);
    sb.on("PATCH", "/rest/v1/contacts", () => [contactRow()]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      {
        method: "PATCH",
        companyId: COMPANY_ID,
        body: { custom_fields: { warranty: "next Tuesday" } },
      },
    );
    expect(res.status).toBe(422);
    // The LABEL, not the key — a form with ten fields and one error reading
    // "invalid" is a form somebody edits at random until it saves.
    expect(await res.text()).toContain("Warranty expiry");
  });

  it("CFA-9: writes a good value, and validates against the LIVE definitions", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("GET", "/rest/v1/contact_field_defs", () => [
      fieldRow({ key: "system_type", label: "System type", kind: "select", options: ["Combi"] }),
    ]);
    sb.on("PATCH", "/rest/v1/contacts", () => [
      contactRow({ custom_fields: { system_type: "Combi" } }),
    ]);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      {
        method: "PATCH",
        companyId: COMPANY_ID,
        body: { custom_fields: { system_type: "Combi" } },
      },
    );
    expect(res.status).toBe(200);
    const patch = sb.find("PATCH", "/rest/v1/contacts")[0];
    expect((patch.body as Record<string, unknown>).custom_fields).toEqual({
      system_type: "Combi",
    });
    // Read from the SERVER's definitions, scoped to this workspace — not from
    // whatever the client believed the fields were.
    const read = sb.find("GET", "/rest/v1/contact_field_defs")[0];
    expect(read.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
  });

  it("CFA-10: rewriting the definitions never touches the values", async () => {
    // THE SILENT ONE. Deleting a field is meant to hide it; what the crew typed
    // stays on each contact, which is exactly what the delete warning promises.
    const sb = stubWithRole("owner");
    sb.on("DELETE", "/rest/v1/contact_field_defs", () => []);
    sb.on("POST", "/rest/v1/contact_field_defs", () => []);
    sb.on("PATCH", "/rest/v1/contacts", () => []);
    sb.on("DELETE", "/rest/v1/contacts", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/contact-fields", {
      method: "PUT",
      companyId: COMPANY_ID,
      body: { fields: [] },
    });
    expect(res.status).toBe(200);
    expect(sb.find("PATCH", "/rest/v1/contacts")).toHaveLength(0);
    expect(sb.find("DELETE", "/rest/v1/contacts")).toHaveLength(0);
    // An empty set still clears the definitions — and inserts nothing.
    expect(sb.find("DELETE", "/rest/v1/contact_field_defs")).toHaveLength(1);
    expect(sb.find("POST", "/rest/v1/contact_field_defs")).toHaveLength(0);
  });
});

/**
 * #291 — a contact's other numbers.
 *
 * CPR-3 is the one that matters. A number recorded here is matched against
 * every inbound text and call, so adding one changes who a message is FROM.
 * Letting a crew claim a number another customer already has would silently
 * redirect that customer's conversations onto the wrong record — and nothing
 * about it would look like an error.
 */
describe("contact phone numbers", () => {
  const CONTACT_PHONE_ID = "eeeeeeee-1111-4222-8333-444444444444";

  /**
   * The route reads `contacts` TWICE for different reasons: once by id, to
   * find the contact being edited, and once by `phone_e164`, to ask whether
   * anybody already owns the number. Discriminated on the FILTER rather than
   * on call order — a counter breaks the moment a read is added or reordered,
   * and it breaks by returning the wrong shape rather than by failing.
   */
  function contactReads(
    sb: SupabaseStub,
    owner: Record<string, unknown>[] = [],
  ) {
    sb.on("GET", "/rest/v1/contacts", (call) =>
      call.url.searchParams.has("phone_e164") ? owner : [contactRow()],
    );
  }

  /**
   * `contact_phones` is read twice too — once asking "does anybody already
   * have this number", once counting what this contact holds. One stub serving
   * both made the cap test pass for the wrong reason: eight rows returned to
   * the FIRST probe read as "the number is taken", so the request was refused
   * before the cap was ever consulted. Found by removing the cap check and
   * watching the test stay green.
   */
  function phoneReads(
    sb: SupabaseStub,
    options: {
      taken?: Record<string, unknown>[];
      existing?: Record<string, unknown>[];
    } = {},
  ) {
    sb.on("GET", "/rest/v1/contact_phones", (call) =>
      call.url.searchParams.has("phone_e164")
        ? options.taken ?? []
        : options.existing ?? [],
    );
  }

  it("CPR-1: records a second number, normalised", async () => {
    // Normalised BEFORE storage, because this column is compared against a
    // webhook's `from`. A raw "(416) 555-0177" would look recorded and never
    // resolve.
    const sb = stubWithRole("member");
    contactReads(sb);
    phoneReads(sb);
    sb.on("POST", "/rest/v1/contact_phones", () => [
      { id: CONTACT_PHONE_ID, phone_e164: "+14165550177", label: "Landline" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/phones`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { phone_e164: "(416) 555-0177", label: "Landline" },
      },
    );
    expect(res.status).toBe(201);
    const insert = sb.find("POST", "/rest/v1/contact_phones")[0];
    const row = (insert.body as Record<string, unknown>[])[0] ??
      (insert.body as Record<string, unknown>);
    expect(row.phone_e164).toBe("+14165550177");
    expect(row.company_id).toBe(COMPANY_ID);
    expect(row.contact_id).toBe(CONTACT_ID);
  });

  it("CPR-2: refuses the customer's own main number", async () => {
    // Not an error worth a stack trace, but storing it would create a second
    // route to the same place and an inbound would resolve twice.
    const sb = stubWithRole("member");
    contactReads(sb);
    sb.on("POST", "/rest/v1/contact_phones", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/phones`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { phone_e164: "+14165550199" },
      },
    );
    expect(res.status).toBe(422);
    expect(sb.find("POST", "/rest/v1/contact_phones")).toHaveLength(0);
  });

  it("CPR-3: refuses a number another customer already has", async () => {
    // THE SILENT ONE. Taking it would redirect that customer's inbound texts
    // and calls onto this record, and nothing would look wrong until somebody
    // noticed a conversation on the wrong name.
    const sb = stubWithRole("member");
    contactReads(sb, [{ id: OTHER_ID, name: "Sam Rivera" }]);
    sb.on("POST", "/rest/v1/contact_phones", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/phones`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { phone_e164: "+14165550188" },
      },
    );
    expect(res.status).toBe(422);
    // Names them, and says what to do instead — "already taken" on its own
    // leaves somebody guessing which record has it.
    const text = await res.text();
    expect(text).toContain("Sam Rivera");
    expect(text).toContain("Merge");
    expect(sb.find("POST", "/rest/v1/contact_phones")).toHaveLength(0);
  });

  it("CPR-4: refuses a number already claimed as another contact's second line", async () => {
    // The other half of CPR-3: a number can be somebody's SECOND number too,
    // and checking only the primaries would miss half the collisions.
    const sb = stubWithRole("member");
    contactReads(sb);
    phoneReads(sb, { taken: [{ contact_id: OTHER_ID }] });
    sb.on("POST", "/rest/v1/contact_phones", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/phones`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { phone_e164: "+14165550166" },
      },
    );
    expect(res.status).toBe(422);
    expect(sb.find("POST", "/rest/v1/contact_phones")).toHaveLength(0);
  });

  it("CPR-5: stops at the cap", async () => {
    const sb = stubWithRole("member");
    contactReads(sb);
    phoneReads(sb, {
      // Nobody else has the number; this contact simply already has eight.
      existing: Array.from({ length: 8 }, (_unused, index) => ({
        id: `p${index}`,
      })),
    });
    sb.on("POST", "/rest/v1/contact_phones", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/phones`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { phone_e164: "+14165550155" },
      },
    );
    expect(res.status).toBe(422);
    expect(sb.find("POST", "/rest/v1/contact_phones")).toHaveLength(0);
  });

  it("CPR-6: deleting is scoped to the contact as well as the company", async () => {
    // A phone id from another customer's record has to be a 404, not a delete.
    // Company scope alone would let one crew member remove a number off a
    // record they were not even looking at.
    const sb = stubWithRole("member");
    sb.on("DELETE", "/rest/v1/contact_phones", () => [{ id: CONTACT_PHONE_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/phones/${CONTACT_PHONE_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);
    const call = sb.find("DELETE", "/rest/v1/contact_phones")[0];
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(call.url.searchParams.get("contact_id")).toBe(`eq.${CONTACT_ID}`);
    expect(call.url.searchParams.get("id")).toBe(`eq.${CONTACT_PHONE_ID}`);
  });

  it("CPR-7: deleting a number nobody has is a 404, not a success", async () => {
    const sb = stubWithRole("member");
    sb.on("DELETE", "/rest/v1/contact_phones", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/phones/${CONTACT_PHONE_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(res.status).toBe(404);
  });

  it("CPR-8: removing a number leaves its conversations alone", async () => {
    // A thread held with that number is a real history. Deleting the number is
    // a correction to the contact record, not a request to erase what was
    // said — and a crew that lost a conversation this way would have no way to
    // get it back.
    const sb = stubWithRole("member");
    sb.on("DELETE", "/rest/v1/contact_phones", () => [{ id: CONTACT_PHONE_ID }]);
    sb.on("DELETE", "/rest/v1/conversations", () => []);
    sb.on("PATCH", "/rest/v1/conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}/phones/${CONTACT_PHONE_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(sb.find("DELETE", "/rest/v1/conversations")).toHaveLength(0);
    expect(sb.find("PATCH", "/rest/v1/conversations")).toHaveLength(0);
  });
});
