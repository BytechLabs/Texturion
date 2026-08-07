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
import {
  CONTACT_IMPORT_COLUMN_FIELD,
  CONTACT_IMPORT_CONSENT_FIELD,
  CONTACT_IMPORT_CONSENT_REFUSED_NOTE,
  CONTACT_IMPORT_CONSENT_REQUIRED,
  CONTACT_IMPORT_CONSENT_VALUE,
  CONTACT_IMPORT_IGNORE,
  CONTACT_IMPORT_MAX_ROWS,
  CONTACT_IMPORT_UNREADABLE_ENCODING,
  CONTACT_IMPORT_VCARD_PROPERTY_FIELD,
  contactImportColumnMismatchMessage,
  contactImportConsentRefusedReason,
  contactImportUndeclaredColumnsMessage,
  contactImportUndeclaredPropertiesMessage,
  contactImportUnreadableFlagMessage,
  contactImportUnterminatedQuoteMessage,
  defaultContactImportColumns,
  formatContactImportColumn,
  formatVCardProperty,
  vcardParameterProperty,
  type ContactImportColumnDeclaration,
  type ContactImportColumnGuess,
} from "@loonext/shared";

import { parseCsvRows } from "./core/csv";
import {
  CONSENT_ATTEST_ALREADY_RECORDED,
  CONSENT_ATTEST_REFUSED_OPTED_OUT,
  EXPORT_HEADER,
  contactSearchOr,
  contactsRoutes,
} from "./contacts";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CONTACT_ID = "dddddddd-1111-4222-8333-444444444444";
/** #246: the second record for the same customer. */
const OTHER_ID = "dddddddd-2222-4222-8333-444444444444";
/**
 * #248 D1: the number the defect was proved against — an ACTIVE `opt_outs`
 * row, source `stop_keyword`, `revoked_at` null. Its carrier is blocking this
 * business's texts and only this customer can lift it.
 */
const STOPPED_PHONE = "+14163014444";

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
  /**
   * #291: the contact detail reads a contact's other numbers too. Passed IN
   * for the same reason as the addresses — this harness is first-match-wins,
   * so a later `sb.on` for a path registered here silently never runs, and the
   * test fails with the DEFAULT answer rather than the one it set up.
   */
  phones?: (call: { url: URL }) => Record<string, unknown>[],
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
  // #291: and the other numbers, read on the same detail. Registered here for
  // the same first-match-wins reason — a suite that wants numbers registers
  // the path itself before calling this and wins.
  sb.on("GET", "/rest/v1/contact_phones", (call) =>
    phones ? phones(call) : [],
  );
  return sb;
}

/**
 * "Nobody in this file has opted out" — SAID, never assumed.
 *
 * Every import now reads `opt_outs` per phone before deciding whether the
 * file's attestation may be written (#248 D1). That read is deliberately not an
 * ambient handler in the harness, unlike the addresses and phones above: the
 * ambient answer would be the PERMISSIVE one, so a future consent test that
 * forgot to register it would pass while asserting exactly the bug this
 * exists to prevent — an attestation manufactured over a live STOP.
 *
 * So each import test states the opt-out state it is about, and the ones about
 * opt-outs state a different one. Registered before anything else claims the
 * path, because this harness is first-match-wins.
 */
function noStandingOptOuts(sb: SupabaseStub): void {
  sb.on("GET", "/rest/v1/opt_outs", () => []);
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

/**
 * THE PERSON'S ANSWER, with a test standing in for the person.
 *
 * #248 H1: `defaultContactImportColumns` guesses a FIELD or nothing at all —
 * its `action` cannot even hold `ignore` — because a dismissal is an answer and
 * a detector has not seen a value. So somebody has to say `ignore`, and here
 * that somebody is this function. Written out rather than buried inside
 * `importForm` because the entire design turns on WHO said it: the version of
 * this that lived in the shared module posted a complete declaration for
 * `Phone,Name,Notes` over a "DO NOT CALL - asked us to stop" column with
 * nobody having looked at anything, and the message went out.
 */
/** The detector's guess for a whole file, read the way the route reads it. */
function guessFor(csv: string): ContactImportColumnGuess[] {
  const parsed = parseCsvRows(csv);
  return defaultContactImportColumns(
    (parsed[0]?.cells ?? []).map((cell) => cell.trim()),
    parsed.slice(1).map((row) => row.cells),
  );
}

function answered(
  guesses: readonly ContactImportColumnGuess[],
): ContactImportColumnDeclaration[] {
  return guesses.map(({ index, header, action }) => ({
    index,
    header,
    action: action ?? CONTACT_IMPORT_IGNORE,
  }));
}

/**
 * A file a person has looked at: attested, and every column answered for.
 *
 * #226's attestation and #248 round 3's per-column declaration are BOTH
 * defaulted here, for the same reason — every pre-existing test still describes
 * the case it was written for, and each gate is asserted directly by tests of
 * its own rather than incidentally by all of them.
 *
 * The declaration defaults to the detector's guess with every unrecognised
 * column dismissed by `answered` above, which is what a real client posts after
 * the person confirms: the wizard shows the guess plus each column's VALUES and
 * sends back what they answered. Pass `columns: null` to send no declaration at
 * all, or an explicit list to declare something other than the guess — which is
 * the whole point of the design, since the person's answer is what the server
 * maps by.
 */
function importForm(
  csv: string,
  attested = true,
  columns?: ContactImportColumnDeclaration[] | null,
): FormData {
  const form = new FormData();
  form.append("file", new File([csv], "contacts.csv", { type: "text/csv" }));
  // #226: an import cannot complete without a stated consent basis. The field
  // name and value come from the shared contract (#248) — the whole reason no
  // client could satisfy this gate for a week is that only the server knew what
  // it was.
  if (attested) {
    form.append(CONTACT_IMPORT_CONSENT_FIELD, CONTACT_IMPORT_CONSENT_VALUE);
  }
  if (columns !== null) {
    // Parsed only when nobody handed us a declaration: a fixture about a file
    // this parser REFUSES (an unterminated quote, #248 H5) still has to be
    // postable, and a helper that parses it first fails the test in the helper.
    const declarations = columns ?? answered(guessFor(csv));
    for (const declaration of declarations) {
      form.append(
        CONTACT_IMPORT_COLUMN_FIELD,
        formatContactImportColumn(declaration),
      );
    }
  }
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
      "(name.ilike.*smi*,phone_e164.ilike.*smi*,business_name.ilike.*smi*,email.ilike.*smi*,custom_values.ilike.*smi*)",
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
      "(name.ilike.*abcd*,phone_e164.ilike.*abcd*,business_name.ilike.*abcd*,email.ilike.*abcd*,custom_values.ilike.*abcd*)",
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
      "(name.ilike.*647 892-3862*,phone_e164.ilike.*647 892-3862*,business_name.ilike.*647 892-3862*,email.ilike.*647 892-3862*,custom_values.ilike.*647 892-3862*," +
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
      "(name.ilike.*smith*,phone_e164.ilike.*smith*,business_name.ilike.*smith*,email.ilike.*smith*,custom_values.ilike.*smith*)",
    );
    // Already bare digits: the same term twice would only cost a scan.
    expect(calls[1].url.searchParams.get("or")).toBe(
      "(name.ilike.*6478923862*,phone_e164.ilike.*6478923862*,business_name.ilike.*6478923862*,email.ilike.*6478923862*,custom_values.ilike.*6478923862*)",
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

  it("#228 sets a per-contact language, and null hands them back to the company", async () => {
    // The null is the whole design. It means "follow the company", not
    // English, so an owner who switches the workspace to French moves every
    // customer who never chose - and "actually, treat them like everyone else"
    // has to stay sayable after an override is set.
    for (const [locale, expected] of [
      ["fr-CA", "fr-CA"],
      [null, null],
    ] as const) {
      const sb = stubWithRole("member");
      sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
      sb.on("PATCH", "/rest/v1/contacts", (call) => [
        { ...contactRow(), ...(call.body as Record<string, unknown>) },
      ]);
      sb.on("GET", "/rest/v1/opt_outs", () => []);
      sb.on("GET", "/rest/v1/conversations", () => []);
      stubFetch(jwksRoute(auth), sb.route);

      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/contacts/${CONTACT_ID}`,
        { method: "PATCH", companyId: COMPANY_ID, body: { locale } },
      );
      expect(res.status, String(locale)).toBe(200);
      expect(
        (sb.find("PATCH", "/rest/v1/contacts")[0].body as Record<string, unknown>)
          .locale,
        String(locale),
      ).toBe(expected);
    }
  });

  it("#228 422s a language nothing is written in", async () => {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    stubFetch(jwksRoute(auth), sb.route);
    for (const locale of ["fr", "FR-CA", "de"]) {
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/contacts/${CONTACT_ID}`,
        { method: "PATCH", companyId: COMPANY_ID, body: { locale } },
      );
      expect(res.status, locale).toBe(422);
    }
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

  it("#248 B4: PATCH consent_attested is refused over a standing opt-out", async () => {
    // THE THIRD DOOR. Round one gated both bulk importers and left this one
    // open: it wrote `attested / now / this member` with no opt-out check of
    // any kind, over a live `stop_keyword` row — and then read `opt_outs`
    // twelve lines later, purely to decorate the response. The fact was in
    // hand and unused.
    //
    // An import may lower a contact's standing, never raise it. So may
    // everything else.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [
      contactRow({ phone_e164: STOPPED_PHONE }),
    ]);
    sb.on("PATCH", "/rest/v1/contacts", (call) => [
      { ...contactRow(), ...(call.body as Record<string, unknown>) },
    ]);
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { id: OTHER_ID, source: "stop_keyword" },
    ]);
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
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(CONSENT_ATTEST_REFUSED_OPTED_OUT);
    // Whole request or nothing: a saved name beside a refused attestation is a
    // response that looks like success while the one thing they asked for did
    // not happen.
    expect(sb.find("PATCH", "/rest/v1/contacts")).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });

  it("#248 B4: PATCH consent_attested never overwrites an existing basis", async () => {
    // "They texted us first on 12 March" is strong evidence; replacing it with
    // "Sam says so, today" is weaker evidence AND an unrecordable change —
    // `contacts_record_consent` only fires on the null → value transition, so
    // the ledger cannot even hold the rewrite and the panel would show an
    // attestation with no row behind it. The importer coalesces; this door
    // used to overwrite, on the same three columns, in the same product.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [
      contactRow({
        consent_source: "inbound_sms",
        consent_at: "2026-03-12T15:04:00+00:00",
      }),
    ]);
    sb.on("PATCH", "/rest/v1/contacts", (call) => [
      { ...contactRow(), ...(call.body as Record<string, unknown>) },
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
        body: { consent_attested: true },
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(CONSENT_ATTEST_ALREADY_RECORDED);
    expect(sb.find("PATCH", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("#248 M10: with BOTH true, the opt-out is the one it says", async () => {
    // The two tests above each assert ONE condition alone, so swapping the two
    // throws survived all 3946 of them — no fixture had ever paired an active
    // `opt_outs` row WITH an existing basis.
    //
    // That pairing is not an edge case, it is the ordinary shape of a carrier
    // STOP: `thread_inbound_message` stamps `consent_source='inbound_sms'` on
    // the STOP message itself, so every customer who texted STOP has a basis
    // AND a block. Under the swapped order every one of them would be told
    // their consent is "already on record and it stands" — which reads as a
    // filing detail — instead of that they asked this business to stop and only
    // they can lift it.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [
      contactRow({
        phone_e164: STOPPED_PHONE,
        consent_source: "inbound_sms",
        consent_at: "2026-03-12T15:04:00+00:00",
      }),
    ]);
    sb.on("PATCH", "/rest/v1/contacts", (call) => [
      { ...contactRow(), ...(call.body as Record<string, unknown>) },
    ]);
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { id: OTHER_ID, source: "stop_keyword" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      {
        method: "PATCH",
        companyId: COMPANY_ID,
        body: { consent_attested: true },
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(CONSENT_ATTEST_REFUSED_OPTED_OUT);
    expect(body.error.message).not.toBe(CONSENT_ATTEST_ALREADY_RECORDED);
    expect(sb.find("PATCH", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("#248 M10: the importer answers the same pair the same way", async () => {
    // The identical ordering lives in `importConsent`, and the same swap is
    // available there — where it is worse, because the answer is a COUNT rather
    // than a sentence: asking about the basis first made the refusal silent for
    // every carrier STOP, and a workspace uploading a competitor export
    // containing forty of them was told 0 refused.
    //
    // A MIX, so a resolver that decided once for the file cannot pass: one row
    // has a basis and a standing block, one has a basis and no block, one is
    // new.
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { phone_e164: STOPPED_PHONE, source: "stop_keyword" },
    ]);
    sb.on("GET", "/rest/v1/contacts", () => [
      {
        phone_e164: STOPPED_PHONE,
        consent_at: "2026-03-12T15:04:00+00:00",
        consent_source: "inbound_sms",
      },
      {
        phone_e164: "+14165550102",
        consent_at: "2026-03-12T15:04:00+00:00",
        consent_source: "inbound_sms",
      },
    ]);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const csv = [
      "phone,name",
      `${STOPPED_PHONE},Jo`,
      "+14165550102,Sam",
      "+14165550103,Ali",
    ].join("\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(csv) },
    );
    expect(res.status).toBe(200);
    // ONE refusal: the row where the file and the record disagree. Not the row
    // that merely already had a basis — nothing was going to be written there,
    // so nothing was refused, and naming it would inflate a count people learn
    // to ignore.
    expect(await res.json()).toMatchObject({
      consent_refused: 1,
      consent_refusals: [
        { row: 2, reason: contactImportConsentRefusedReason(STOPPED_PHONE) },
      ],
    });
  });

  it("#248 B4: fails the edit rather than guess at a flaky opt-out read", async () => {
    // The importer has had this guard since round two ("fails the whole import
    // rather than guess at a flaky opt-out read"). THIS door did not, and one
    // try/catch answering "found nothing" survived all 3964 tests — the two B4
    // fixtures above both stub a read that SUCCEEDS, so neither can see what
    // happens when it does not.
    //
    // The asymmetry is the whole point: `unwrap` throwing is the only thing
    // standing between an unreadable `opt_outs` table and an attestation
    // stamped over a live carrier STOP, and a defence that exists at two of the
    // three doors is a defence somebody will "tidy up" at the third.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [
      contactRow({ phone_e164: STOPPED_PHONE }),
    ]);
    sb.on("PATCH", "/rest/v1/contacts", (call) => [
      { ...contactRow(), ...(call.body as Record<string, unknown>) },
    ]);
    // A PostgREST 500, not a thrown fetch: supabase-js RETRIES ONCE on a
    // transport-level rejection, so a harness that throws from `fetch` shows
    // the run succeeding and proves nothing.
    sb.on(
      "GET",
      "/rest/v1/opt_outs",
      () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    );
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
    // Told, and nothing written. "I could not check" is not "they are clear".
    expect(res.status).toBe(500);
    expect(sb.find("PATCH", "/rest/v1/contacts")).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });

  it("#248 M7b: the DETAIL fails rather than reporting a flaky read as clear", async () => {
    // The same mutation, at the door next to it: wrapping this read in a
    // try/catch that answers `[]` survived all 3970 tests, because every
    // fixture here stubs a read that SUCCEEDS. `opted_out: false` is the answer
    // the screen believes — it is what hides the blocked banner and offers the
    // composer — so "I could not check" arriving as "they are clear" is a
    // person being invited to text somebody who said stop.
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [
      contactRow({ phone_e164: STOPPED_PHONE }),
    ]);
    // A PostgREST 500, not a thrown fetch: supabase-js retries once on a
    // transport rejection, so a harness that throws shows the run succeeding.
    sb.on(
      "GET",
      "/rest/v1/opt_outs",
      () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/contacts/${CONTACT_ID}`,
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(500);
    // And it is not a 200 carrying a quiet lie.
    expect(await res.text()).not.toContain('"opted_out":false');
  });

  it("#248 B4: an ordinary edit still costs one opt-out read, not two", async () => {
    // The gate reuses the read the response was already making. Two reads of
    // the same fact in one request is a pair that can disagree, and this one
    // would disagree in the direction that matters: the check saying "clear"
    // and the response saying "opted out".
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", () => [contactRow()]);
    sb.on("PATCH", "/rest/v1/contacts", (call) => [
      { ...contactRow(), ...(call.body as Record<string, unknown>) },
    ]);
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
    expect(sb.find("GET", "/rest/v1/opt_outs")).toHaveLength(1);
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
    noStandingOptOuts(sb);
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
    expect(body.error.message).toBe(CONTACT_IMPORT_CONSENT_REQUIRED);
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
    expect(body.error.message).toBe(CONTACT_IMPORT_CONSENT_REQUIRED);
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
    // Pre-existing contact check: +14165550100 already exists — and carries a
    // basis, because that is the case #248 is about. The stub used to answer
    // with the phone alone, so "an existing contact keeps its consent" could
    // not be told apart from "an existing contact has none".
    sb.on("GET", "/rest/v1/contacts", () => [
      {
        phone_e164: "+14165550100",
        consent_source: "inbound_sms",
        consent_at: "2026-03-12T15:04:00+00:00",
      },
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
      // #248: nobody in this file is opted out at the carrier, so the
      // attestation applied to every row it was written on and there is
      // nothing to report. The note is null rather than the sentence, so a
      // client renders the banner by presence rather than by counting.
      consent_refused: 0,
      consent_refusals: [],
      consent_refused_note: null,
    });

    // Upsert payload: E.164-normalized, deleted_at cleared, only CSV columns.
    // Writing the `address` column also resets the geocode cache (D25): a row
    // with an address queues geocode_status='pending', a row whose address cell
    // is empty settles to 'no_address' — exactly as POST/PATCH /contacts do, so
    // a re-import that CHANGES an already-geocoded contact's address re-geocodes.
    //
    // ONE call, because NEITHER row takes the attestation and the two
    // therefore share a key set — and the two reasons are the whole of #248's
    // consent rule:
    //
    //   +14165550100 texted this business first on 12 March, so it keeps
    //   `inbound_sms` and that date. The three consent keys are ABSENT — not
    //   null, absent — because the upsert merges on conflict, so sending them
    //   at all is what overwrote a stronger basis (they contacted us, with a
    //   message to prove it) with a weaker one (a member says so) every time
    //   somebody re-uploaded last year's spreadsheet.
    //
    //   +14165550101 is brand new and the file marks it opted_out. A file
    //   whose attestation says everyone agreed and whose row says this one
    //   opted out has contradicted itself, and the restriction is the half to
    //   believe. Writing "attested, today" beside an opt-out created in the
    //   same request is the manufactured consent this issue is about.
    const upserts = sb.find("POST", "/rest/v1/contacts");
    expect(upserts).toHaveLength(1);
    expect(upserts[0].body).toEqual([
      {
        company_id: COMPANY_ID,
        phone_e164: "+14165550100",
        deleted_at: null,
        created_by_user_id: auth.subject, // #191 attribution
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
        name: "New Person",
        address: null,
        lat: null,
        lng: null,
        geocoded_at: null,
        geocode_status: "no_address",
      },
    ]);
    for (const upsert of upserts) {
      expect(upsert.url.searchParams.get("on_conflict")).toBe(
        "company_id,phone_e164",
      );
    }

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
    noStandingOptOuts(sb);
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

  it("#248: refuses an import when the workspace is over its import rate", async () => {
    // Import is the one route where a customer hands us unbounded input. Rows
    // and bytes were capped per REQUEST and nothing capped the requests, so
    // 2000 rows of reads-plus-upserts could be replayed as fast as the network
    // allowed. Keyed on the company, because the cost is the company's.
    const sb = stubWithRole("admin");
    stubFetch(jwksRoute(auth), sb.route);
    const keys: string[] = [];
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    };

    const res = await apiRequest(
      app,
      { ...env, CONTACT_IMPORT_RATE_LIMITER: limiter },
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm("phone,name\n+14165550100,Jo\n"),
      },
    );
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
    expect(keys).toEqual([`contact-import:${COMPANY_ID}`]);
    // Refused before the body was read: no contacts were touched.
    expect(sb.find("GET", "/rest/v1/contacts")).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("#248: the vCard route spends the same import budget", async () => {
    // One budget for both doors. Two limiters would mean a script alternating
    // routes gets twice the allowance for the same cost.
    const sb = stubWithRole("admin");
    stubFetch(jwksRoute(auth), sb.route);
    const keys: string[] = [];
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    };

    const res = await apiRequest(
      app,
      { ...env, CONTACT_IMPORT_RATE_LIMITER: limiter },
      await auth.token(),
      "/v1/contacts/import-vcard",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: vcardForm("BEGIN:VCARD\r\nVERSION:3.0\r\nTEL:+14165550100\r\nEND:VCARD"),
      },
    );
    expect(res.status).toBe(429);
    expect(keys).toEqual([`contact-import:${COMPANY_ID}`]);
  });

  it("#248: an existing contact with NO recorded basis takes the attestation", async () => {
    // The other half of the rule, and the half that makes it honest rather
    // than merely cautious. Rows that carry nothing about consent — a contact
    // added by a vCard import back when that route asked no question, or one
    // created before the columns existed — DO take the importer's attestation:
    // it is a genuine first record, and it is the transition
    // `contacts_record_consent` fires on, so the ledger gets its row.
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => [
      { phone_e164: "+14165550100", consent_source: null, consent_at: null },
    ]);
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
    expect(upsert[0]).toMatchObject({
      phone_e164: "+14165550100",
      consent_source: "attested",
      consent_attested_by: auth.subject,
    });
    expect(typeof upsert[0].consent_at).toBe("string");
  });

  it("#248: re-uploading the same file writes no consent at all the second time", async () => {
    // What "resumable" means for this importer: it is idempotent, so the cure
    // for an import that died half way is to upload the file again. That is
    // only true if the second run is harmless, which it was not — every row
    // the first run created came back with its basis re-dated to the retry.
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => [
      {
        phone_e164: "+14165550100",
        consent_source: "attested",
        consent_at: "2026-08-01T00:00:00+00:00",
      },
      {
        phone_e164: "+14165550101",
        consent_source: "attested",
        consent_at: "2026-08-01T00:00:00+00:00",
      },
    ]);
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
        rawBody: importForm("phone,name\n+14165550100,Jo\n+14165550101,Sam\n"),
      },
    );
    expect(res.status).toBe(200);
    // Everything is an update, and not one consent key crosses the wire.
    expect(await res.json()).toMatchObject({ imported: 0, updated: 2 });
    const rows = sb
      .find("POST", "/rest/v1/contacts")
      .flatMap((call) => call.body as Record<string, unknown>[]);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).not.toHaveProperty("consent_source");
      expect(row).not.toHaveProperty("consent_at");
      expect(row).not.toHaveProperty("consent_attested_by");
    }
  });

  it("#248 D1: refuses the attestation over a standing STOP, and reports it", async () => {
    // The defect this issue turns on, in the exact shape it was proved in: a
    // number with an ACTIVE opt_outs row, source 'stop_keyword', never
    // revoked — and a CSV with NO `opted_out` column at all, which is what
    // every competitor export looks like, because no other tool has one.
    //
    // The decision used to be made from `contacts.consent_at` alone, and an
    // opt-out is not written there. So the file's attestation landed as
    // "consent_source=attested, consent_at=now, attested_by=whoever uploaded
    // it" over a person whose carrier is blocking this business's texts, and
    // the append-only consent ledger — which already holds their revocation —
    // took an `express` row dated after it.
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { phone_e164: STOPPED_PHONE, source: "stop_keyword" },
    ]);
    sb.on("GET", "/rest/v1/contacts", () => []); // brand new to this workspace
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    sb.on("POST", "/rest/v1/audit_log", () => new Response(null, { status: 201 }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm(`phone,name\n${STOPPED_PHONE},Jo Smith\n`),
      },
    );
    expect(res.status).toBe(200);

    const rows = sb
      .find("POST", "/rest/v1/contacts")
      .flatMap((call) => call.body as Record<string, unknown>[]);
    // An import may ADD: the contact is written, with the name the file gave.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      phone_e164: STOPPED_PHONE,
      name: "Jo Smith",
    });
    // It may not RAISE: not one word about consent crosses the wire.
    expect(rows[0]).not.toHaveProperty("consent_source");
    expect(rows[0]).not.toHaveProperty("consent_at");
    expect(rows[0]).not.toHaveProperty("consent_attested_by");

    // And the workspace is told, because a silent refusal is its own defect —
    // the person who uploaded the file otherwise believes it covered everyone.
    // Against the shipped strings, so a reworded sentence has to be rewritten
    // in one place rather than agreed with in two.
    expect(await res.json()).toMatchObject({
      imported: 1,
      consent_refused: 1,
      consent_refusals: [
        { row: 2, reason: contactImportConsentRefusedReason(STOPPED_PHONE) },
      ],
      consent_refused_note: CONTACT_IMPORT_CONSENT_REFUSED_NOTE,
    });
    // And on the audit row, which outlives the tab the response was read in.
    // This is the number a carrier audit or a demand letter turns on: how many
    // people in that file the workspace's attestation did not cover.
    const audit = sb.find("POST", "/rest/v1/audit_log")[0].body as {
      after: Record<string, unknown>;
    };
    expect(audit.after).toMatchObject({ consent_refused: 1, source: "csv" });
  });

  it("#248 D1: asks opt_outs in batches, never per row", async () => {
    // The check has to survive the file it exists for. A per-phone query over
    // a full 2000-row import is 2000 round trips inside one Worker request —
    // which is not a check that ships, it is a check that times out and gets
    // taken out again. Same IMPORT_CHUNK shape as every other read here.
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    stubFetch(jwksRoute(auth), sb.route);

    // 300 distinct numbers → two chunks of 200, not 300 requests.
    const lines = ["phone"];
    for (let i = 0; i < 300; i += 1) {
      lines.push(`+1416555${String(1000 + i).padStart(4, "0")}`);
    }
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm(`${lines.join("\n")}\n`),
      },
    );
    expect(res.status).toBe(200);
    const reads = sb.find("GET", "/rest/v1/opt_outs");
    expect(reads).toHaveLength(2);
    for (const read of reads) {
      // An `in.(…)` list, and only rows that are actually standing: a revoked
      // opt-out is a customer who texted START, and holding that against them
      // forever would make import the one path nobody gets back in through.
      expect(read.url.searchParams.get("phone_e164")).toMatch(/^in\.\(/);
      expect(read.url.searchParams.get("revoked_at")).toBe("is.null");
    }
  });

  it("#248: reports the carrier STOP that leaves a consent basis behind", async () => {
    // THE PAIRING THE DATABASE ACTUALLY PRODUCES, and the one the shipped test
    // used to assert `consent_refused: 0` against.
    //
    // A carrier STOP always leaves a basis: `thread_inbound_message` threads
    // the STOP message itself, and stamps `consent_source='inbound_sms'` doing
    // it. So a contact whose ONLY message is the word STOP has both an active
    // opt_outs row AND a consent basis — and the refusal, which asked about
    // the basis first, returned "nothing was going to be written, so nothing
    // was refused" before it ever looked at the opt-out.
    //
    // The workspace uploading a competitor export with forty such people was
    // told 0 refused, and all three clients correctly showed nothing, because
    // the number they were given was zero. Whether the columns are written is
    // NOT what changed — `{}` either way — only whether anybody is told.
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { phone_e164: STOPPED_PHONE, source: "stop_keyword" },
    ]);
    sb.on("GET", "/rest/v1/contacts", () => [
      {
        phone_e164: STOPPED_PHONE,
        consent_source: "inbound_sms",
        consent_at: "2026-03-12T15:04:00+00:00",
      },
    ]);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm(`phone,name\n${STOPPED_PHONE},Jo\n`),
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      consent_refused: 1,
      consent_refusals: [
        { row: 2, reason: contactImportConsentRefusedReason(STOPPED_PHONE) },
      ],
      consent_refused_note: CONTACT_IMPORT_CONSENT_REFUSED_NOTE,
    });
    // The basis they already had is still not touched — the rule that moved is
    // about REPORTING, not about writing.
    const rows = sb
      .find("POST", "/rest/v1/contacts")
      .flatMap((call) => call.body as Record<string, unknown>[]);
    expect(rows[0]).not.toHaveProperty("consent_source");
  });

  it("#248: does not pad the count with rows the uploader flagged themselves", async () => {
    // The other half of the same number, and the reason it is not simply "any
    // standing opt-out". A row the file itself marked opted out is not news to
    // the person who uploaded it, and a count inflated by rows they already
    // know about is a count they learn to ignore — which would cost them the
    // rows that ARE news.
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { phone_e164: STOPPED_PHONE, source: "stop_keyword" },
    ]);
    sb.on("GET", "/rest/v1/contacts", () => [
      {
        phone_e164: STOPPED_PHONE,
        consent_source: "inbound_sms",
        consent_at: "2026-03-12T15:04:00+00:00",
      },
    ]);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    sb.on("PATCH", "/rest/v1/opt_outs", () => []);
    sb.on("POST", "/rest/v1/opt_outs", () => []);
    // Already standing AND already announced, so the timeline says it once.
    sb.on("GET", "/rest/v1/conversation_events", () => [
      { payload: { phone_e164: STOPPED_PHONE, source: "stop_keyword" } },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm(`phone,name,opted_out\n${STOPPED_PHONE},Jo,yes\n`),
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      consent_refused: 0,
      consent_refusals: [],
      consent_refused_note: null,
    });
  });

  it("#248 D2: an opt-out on a duplicate row is the person's, not the row's", async () => {
    // The de-dupe pushed "duplicate phone in file" and RETURNED before the
    // opted_out cell was ever read, so a file listing the same person twice —
    // once plain, once flagged, which is what a merge of two exports looks
    // like — kept the first row and threw the second away. The row it threw
    // away was the one saying "do not text this person".
    //
    // Both orders, because keeping the LAST row would be the same bug facing
    // the other way: an opt-out anywhere in the file is true of that contact.
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    sb.on("PATCH", "/rest/v1/opt_outs", () => []);
    sb.on("POST", "/rest/v1/opt_outs", () => [{ id: OTHER_ID }]);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const csv = [
      "phone,name,opted_out",
      "+14165550100,Jo,", // plain first…
      "+14165550100,Jo Smith,yes", // …flagged second (the discarded row)
      "+14165550101,Sam,yes", // flagged first…
      "+14165550101,Samir,", // …plain second, which must not clear it
    ].join("\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(csv) },
    );
    expect(res.status).toBe(200);

    const optOuts = sb
      .find("POST", "/rest/v1/opt_outs")
      .flatMap((call) => call.body as { phone_e164: string }[])
      .map((row) => row.phone_e164)
      .sort();
    expect(optOuts).toEqual(["+14165550100", "+14165550101"]);
    // The extra ROW is still discarded and still reported — which of two
    // spellings of a name to keep is not a judgement to make silently.
    expect(await res.json()).toMatchObject({
      imported: 2,
      skipped: 2,
      errors: [
        { row: 3, reason: "duplicate phone in file: +14165550100" },
        { row: 5, reason: "duplicate phone in file: +14165550101" },
      ],
    });
  });

  it("#248 D3: writes the opt-outs before the contacts", async () => {
    // Nothing here runs in a transaction, so any prefix of it may be the last
    // thing that happens. Contacts first meant every partial failure landed on
    // the most permissive state the file could produce: contacts created, the
    // attestation stamped on them, and not one of the opt-outs declared.
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    sb.on("PATCH", "/rest/v1/opt_outs", () => []);
    sb.on("POST", "/rest/v1/opt_outs", () => [{ id: OTHER_ID }]);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm("phone,opted_out\n+14165550100,yes\n"),
      },
    );
    expect(res.status).toBe(200);

    const order = sb.calls
      .filter(
        (call) =>
          (call.method === "POST" || call.method === "PATCH") &&
          (call.path === "/rest/v1/opt_outs" ||
            call.path === "/rest/v1/contacts" ||
            call.path === "/rest/v1/conversation_events"),
      )
      .map((call) => `${call.method} ${call.path}`);
    expect(order).toEqual([
      // The restriction, both halves of its two-step transition…
      "PATCH /rest/v1/opt_outs",
      "POST /rest/v1/opt_outs",
      // …then the record…
      "POST /rest/v1/contacts",
      // …then the timeline entry, which is the only part needing contact ids.
      "POST /rest/v1/conversation_events",
    ]);
  });

  it("#248 D3: a failure on the contacts write leaves the opt-out standing", async () => {
    // The proof, run the way the defect was: fail the first contacts POST and
    // look at what the half-finished import left behind. A half-import that
    // blocked people who should be blocked and wrote no contacts costs a
    // re-upload; the reverse costs a text to somebody who said stop.
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on(
      "POST",
      "/rest/v1/contacts",
      () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    );
    sb.on("PATCH", "/rest/v1/opt_outs", () => []);
    sb.on("POST", "/rest/v1/opt_outs", () => [{ id: OTHER_ID }]);
    sb.on("POST", "/rest/v1/audit_log", () => new Response(null, { status: 201 }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm("phone,opted_out\n+14165550100,yes\n"),
      },
    );
    expect(res.status).toBe(500);
    // The restriction landed before the write that died.
    const optOuts = sb
      .find("POST", "/rest/v1/opt_outs")
      .flatMap((call) => call.body as { phone_e164: string; source: string }[]);
    expect(optOuts).toEqual([
      expect.objectContaining({
        phone_e164: "+14165550100",
        source: "import",
      }),
    ]);
    // #248 D4: and the attempt is in the audit log, so a workspace left with
    // half a contact list can account for where it came from. `attempted`
    // rather than a count of what landed — we genuinely do not know that, and
    // a made-up number is worse than an honest bound.
    const audit = sb.find("POST", "/rest/v1/audit_log")[0].body as {
      action: string;
      after: Record<string, unknown>;
    };
    expect(audit.action).toBe("contacts.imported");
    expect(audit.after).toMatchObject({
      attempted: 1,
      source: "csv",
      outcome: "failed",
    });
  });

  it("#248 D4: re-uploading after a half-finished import is the whole recovery", async () => {
    // The second run, against the state the first one left: the opt-out is
    // standing now, so this run must not write a second opt_outs row and must
    // not attest — the contact it is finishing is opted out. Idempotent by
    // (company_id, phone_e164) at every step, which is why this import needs
    // no job table, no idempotency key and no resume: its result IS the
    // database state, and that state is a fixed point.
    //
    // AND IT RESTORES THE TIMELINE ENTRY THE FIRST RUN NEVER WROTE. The events
    // are the last thing an import does, so a run that died at the contacts
    // upsert wrote the opt-outs and announced none of them. Deciding what to
    // announce by diffing against the pre-write state — which is what this
    // test used to assert — made that permanent: the re-run saw them already
    // standing and stayed silent, forever, because the state change it keyed
    // on had already happened. The data recovered and the audit trail could
    // not, which is the wrong half to lose.
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { phone_e164: "+14165550100", source: "import" },
    ]);
    sb.on("GET", "/rest/v1/contacts", () => []); // the row the first run never wrote
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    sb.on("PATCH", "/rest/v1/opt_outs", () => []);
    sb.on("POST", "/rest/v1/opt_outs", () => []); // ON CONFLICT DO NOTHING
    // Nothing was ever announced for this number: the first run died before it
    // got here.
    sb.on("GET", "/rest/v1/conversation_events", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm("phone,name,opted_out\n+14165550100,Jo,yes\n"),
      },
    );
    expect(res.status).toBe(200);
    // The announcement the first attempt owed, paid by the re-run.
    const events = sb
      .find("POST", "/rest/v1/conversation_events")
      .flatMap((call) => call.body as Record<string, unknown>[]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "opted_out",
      payload: { phone_e164: "+14165550100", source: "import" },
    });
    // Asked of the events table, and only about the numbers the pre-write read
    // already found standing — an ordinary import asks nothing.
    const asked = sb.find("GET", "/rest/v1/conversation_events");
    expect(asked).toHaveLength(1);
    expect(asked[0].url.searchParams.get("type")).toBe("eq.opted_out");

    const rows = sb
      .find("POST", "/rest/v1/contacts")
      .flatMap((call) => call.body as Record<string, unknown>[]);
    expect(rows[0]).toMatchObject({ phone_e164: "+14165550100", name: "Jo" });
    expect(rows[0]).not.toHaveProperty("consent_source");
  });

  it("#248: re-uploading a finished import announces nothing twice", async () => {
    // The other side of the same rule, and the reason it is not "announce
    // every flagged row every time". A workspace re-uploading its book —
    // which this route tells them to do — must not pile a second `opted_out`
    // entry onto every already-blocked customer's timeline. A record that
    // says a person revoked eleven times is one somebody has to explain.
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { phone_e164: "+14165550100", source: "import" },
    ]);
    sb.on("GET", "/rest/v1/contacts", () => [
      { phone_e164: "+14165550100", consent_source: null, consent_at: null },
    ]);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    sb.on("PATCH", "/rest/v1/opt_outs", () => []);
    sb.on("POST", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversation_events", () => [
      { payload: { phone_e164: "+14165550100", source: "import" } },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm("phone,name,opted_out\n+14165550100,Jo,yes\n"),
      },
    );
    expect(res.status).toBe(200);
    expect(sb.find("POST", "/rest/v1/conversation_events")).toHaveLength(0);
  });

  it("#248: an active STOP is never rewritten to source='import'", async () => {
    // The rule this shares with `revokeOptOut`: an imported opt-out is the
    // workspace's own record and the workspace may lift it, while a STOP lives
    // at the carrier and only the customer can. Downgrading an ACTIVE
    // stop_keyword row to 'import' would make the refusal in revokeOptOut stop
    // firing, so the app would offer to opt somebody back in while the carrier
    // block stood — every send then failing 40300 against a contact the UI
    // showed as textable.
    //
    // Two statements enforce it, and this asserts the shape of both: the
    // revive touches only rows that are ALREADY revoked, and the insert is ON
    // CONFLICT DO NOTHING, so an active row of any source is left alone.
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { phone_e164: STOPPED_PHONE, source: "stop_keyword" },
    ]);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    sb.on("PATCH", "/rest/v1/opt_outs", () => []);
    sb.on("POST", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversation_events", () => [
      { payload: { phone_e164: STOPPED_PHONE, source: "stop_keyword" } },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm(`phone,opted_out\n${STOPPED_PHONE},yes\n`),
      },
    );
    expect(res.status).toBe(200);
    const revive = sb.find("PATCH", "/rest/v1/opt_outs")[0];
    expect(revive.url.searchParams.get("revoked_at")).toBe("not.is.null");
    const insert = sb.find("POST", "/rest/v1/opt_outs")[0];
    expect(insert.url.searchParams.get("on_conflict")).toBe(
      "company_id,phone_e164",
    );
    expect(insert.headers.get("prefer")).toContain("resolution=ignore-duplicates");
    // Nothing to report: the file said what the record says. The refusal count
    // is for the DISAGREEMENTS — rows the uploader believed their attestation
    // covered — and padding it with rows they flagged themselves is how a
    // count becomes something people stop reading.
    expect(await res.json()).toMatchObject({
      consent_refused: 0,
      consent_refusals: [],
      consent_refused_note: null,
    });
  });

  it("#248: joins split first/last name columns into the stored name", async () => {
    // The shape every CRM and phone export uses, and the one the detector used
    // to read as "the whole name is whatever is in the first column" — so a
    // crew switching tools got a book of first names, with every row reported
    // as imported cleanly.
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) => {
      const rows = call.body as { phone_e164: string }[];
      return rows.map((row) => ({ id: CONTACT_ID, phone_e164: row.phone_e164 }));
    });
    stubFetch(jwksRoute(auth), sb.route);

    const csv = [
      "First Name,Last Name,Company,Phone Number",
      "Jo,Smith,Smith Roofing,+14165550100",
      // A row with only a surname collapses rather than storing " Chen".
      ",Chen,,+14165550101",
    ].join("\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(csv) },
    );
    expect(res.status).toBe(200);
    const rows = sb
      .find("POST", "/rest/v1/contacts")
      .flatMap((call) => call.body as Record<string, unknown>[]);
    expect(rows.map((row) => row.name)).toEqual(["Jo Smith", "Chen"]);
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
    // ...and the timeline already carries the entry for it, which is what makes
    // this a re-emission rather than a lost announcement (#248 B3).
    sb.on("GET", "/rest/v1/conversation_events", () => [
      { payload: { phone_e164: "+14165550199", source: "stop_keyword" } },
    ]);
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
    // Standing but never announced, so the timeline entry is still owed (B3).
    sb.on("GET", "/rest/v1/conversation_events", () => []);
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

/**
 * #248 round 3 — every column is answered for, or nothing is imported.
 *
 * The defect these are about was proved end to end twice. Round one: a file
 * carrying a "Do Not Call" column imported with `consent_source='attested'` and
 * no `opt_outs` row, and a real text then reached one of those people. Round
 * two replaced the header vocabulary with a test on the SHAPE of a dropped
 * column's values, and three independent verifiers walked messages through it
 * — 16 of 26, 4 of 9, 7 of 24 delivered.
 *
 * Nothing in either file was malformed. The importer simply dropped a column
 * without a word and attested anyway, so the fix is that it cannot drop one.
 */
describe("#248 every column of the file is answered for", () => {
  /** A CSV whose unmapped column decides something about these people. */
  const marketingStatus = [
    "phone,name,Marketing Status",
    "+14165550101,Jo,Subscribed",
    "+14165550102,Sam,Unsubscribed",
    "+14165550103,Ali,Subscribed",
    "+14165550104,Kim,Subscribed",
  ].join("\n");

  function refusingStub(): SupabaseStub {
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    stubFetch(jwksRoute(auth), sb.route);
    return sb;
  }

  function importingStub(): SupabaseStub {
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    stubFetch(jwksRoute(auth), sb.route);
    return sb;
  }

  it("refuses a file that declared nothing, naming every column", async () => {
    const sb = refusingStub();
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        // `null` — the wire as it looked before this existed.
        rawBody: importForm(marketingStatus, true, null),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    // The shipped sentence, so a reworded refusal is rewritten in one place
    // rather than agreed with in two. `phone` and `name` are named too: this
    // gate does not ask which columns look suspicious, it asks whether every
    // one of them was answered for.
    expect(body.error.message).toBe(
      contactImportUndeclaredColumnsMessage(
        [
          { index: 0, header: "phone" },
          { index: 1, header: "name" },
          { index: 2, header: "Marketing Status" },
        ],
        3,
      ),
    );
    // NOTHING was written. "Refuse the flagged rows" is not available to us —
    // `y` under "Do Not Call" and `y` under "OK to Text" are opposite
    // instructions — and refusing only the attestation would not protect
    // anybody, because the send gate asks `opt_outs`, never the consent basis.
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/opt_outs")).toHaveLength(0);
  });

  it("refuses the ONE column nobody answered for", async () => {
    const sb = refusingStub();
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm(marketingStatus, true, [
          { index: 0, action: "phone", header: "phone" },
          { index: 1, action: "name", header: "name" },
        ]),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(
      contactImportUndeclaredColumnsMessage(
        [{ index: 2, header: "Marketing Status" }],
        3,
      ),
    );
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("refuses every shape that walked through round two's shape test", async () => {
    // Each of these was demonstrated LIVE against the shipped `unmappedFlagColumns`
    // and ended in an outbound `messages` row. None of them is refused here for
    // looking like anything — they are refused because nobody answered for the
    // column, which is the only property that does not depend on a vocabulary.
    const escapes: [string, string][] = [
      [
        "four distinct answers (distinct.size <= FLAG_MAX_DISTINCT was 3)",
        [
          "phone,name,Status",
          "+14165550101,Jo,DNC",
          "+14165550102,Sam,OK",
          "+14165550103,Ali,HOLD",
          "+14165550104,Kim,PENDING",
        ].join("\n"),
      ],
      [
        "a value longer than FLAG_MAX_LENGTH (16) — a real CRM writes sentences",
        [
          "phone,name,Contact Preference",
          "+14165550101,Jo,Do not text this customer",
          "+14165550102,Sam,Fine to text",
          "+14165550103,Ali,Do not text this customer",
        ].join("\n"),
      ],
      [
        "the same answer on every row, read as a constant column",
        [
          "phone,name,Marketing Status",
          "+14165550101,Jo,Unsubscribed",
          "+14165550102,Sam,Unsubscribed",
          "+14165550103,Ali,Unsubscribed",
        ].join("\n"),
      ],
      [
        "small-file arithmetic: four rows, three answers",
        [
          "phone,name,Segment",
          "+14165550101,Jo,DNC",
          "+14165550102,Sam,Keep",
          "+14165550103,Ali,Keep",
          "+14165550104,Kim,Later",
        ].join("\n"),
      ],
    ];
    for (const [why, csv] of escapes) {
      const sb = refusingStub();
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        "/v1/contacts/import",
        {
          method: "POST",
          companyId: COMPANY_ID,
          // Only the two columns the detector recognises, which is exactly what
          // a client that trusted the guess would send.
          rawBody: importForm(csv, true, [
            { index: 0, action: "phone", header: "phone" },
            { index: 1, action: "name", header: "name" },
          ]),
        },
      );
      expect(res.status, why).toBe(422);
      expect(sb.find("POST", "/rest/v1/contacts"), why).toHaveLength(0);
    }
  });

  it("counts a cell PAST the header row as a column, and refuses it", async () => {
    // Every loop in round two was bounded by `headers.length`, so this third
    // cell was never looked at by any rule at all — not misread, unread. Hand-
    // edited files do it constantly.
    const sb = refusingStub();
    const csv = [
      "Phone,Name",
      "+12065550101,Ann,DO NOT CALL",
      "+12065550102,Bo",
    ].join("\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        // The declaration a client that read only the HEADER row would build.
        rawBody: importForm(
          csv,
          true,
          answered(defaultContactImportColumns(["Phone", "Name"])),
        ),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(
      contactImportUndeclaredColumnsMessage([{ index: 2, header: "" }], 3),
    );
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("tells two NAMELESS columns apart, which is why the identity is the index", async () => {
    // M15. Round two matched its field on `normalizeContactHeader`, which
    // strips everything but [a-z0-9] — so every header with no ASCII
    // alphanumerics normalised to the same empty string and one answer cleared
    // both columns. Here column 3 is answered and column 4 is not.
    const sb = refusingStub();
    const csv = [
      "Phone,Name,,",
      "+14165550101,Jo,,DO NOT CALL",
      "+14165550102,Sam,x,",
    ].join("\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm(csv, true, [
          { index: 0, action: "phone", header: "Phone" },
          { index: 1, action: "name", header: "Name" },
          { index: 2, action: CONTACT_IMPORT_IGNORE, header: "" },
        ]),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(
      contactImportUndeclaredColumnsMessage([{ index: 3, header: "" }], 4),
    );
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("blocks the rows of a column the detector would have filed as notes", async () => {
    // The mapped-somewhere-inert hole. `Description` is claimed by `notes` on
    // every pattern we own, so a row reading "DO NOT CONTACT" was filed as a
    // note and the person was texted — and round two's gate only examined
    // UNMAPPED columns, so it could not see this at all. The person's answer is
    // the mapping now, so declaring it `opted_out` actually blocks them.
    //
    // A MIX: one row blocked, one not, so a resolver that answered once for the
    // file could not pass.
    const sb = importingStub();
    sb.on("PATCH", "/rest/v1/opt_outs", () => []);
    sb.on("POST", "/rest/v1/opt_outs", () => [{ id: OTHER_ID }]);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("POST", "/rest/v1/conversation_events", () => []);

    const csv = [
      "phone,Description",
      "+14165550101,x",
      "+14165550102,",
    ].join("\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm(csv, true, [
          { index: 0, action: "phone", header: "phone" },
          { index: 1, action: "opted_out", header: "Description" },
        ]),
      },
    );
    expect(res.status).toBe(200);
    const blocked = sb
      .find("POST", "/rest/v1/opt_outs")
      .flatMap((call) => call.body as { phone_e164: string }[])
      .map((row) => row.phone_e164);
    expect(blocked).toEqual(["+14165550101"]);
    // And the column is NOT also written as a note — the declaration replaced
    // the detector's answer rather than being added to it.
    const rows = sb
      .find("POST", "/rest/v1/contacts")
      .flatMap((call) => call.body as Record<string, unknown>[]);
    expect(rows.every((row) => !("notes" in row))).toBe(true);
  });

  it("refuses a declaration that describes some other file", async () => {
    // What replaces round two's echo loop. A caller could regex the column
    // names out of the 422 and re-post; there is no 422 to learn from now, and
    // a declaration whose header does not match the file at that index is a
    // declaration built from something other than the file attached.
    const sb = refusingStub();
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm(marketingStatus, true, [
          { index: 0, action: "phone", header: "phone" },
          { index: 1, action: "name", header: "name" },
          { index: 2, action: CONTACT_IMPORT_IGNORE, header: "Marketing status" },
        ]),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(
      contactImportColumnMismatchMessage(
        `column 3 was declared as "Marketing status" and this file calls it "Marketing Status"`,
      ),
    );
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("#528 M3b: a header that matches SOME OTHER column does not rescue a declaration", async () => {
    // THE POSITION IS THE IDENTITY AND THE HEADER IS ONLY CONFIRMATION. This is
    // the exact shape a match-by-header fallback would quietly rescue: every
    // header below is a real header of this file, so a resolver that fell back to
    // searching by name would find all three and accept the lot — while the
    // answers landed on the wrong columns, and "Marketing Status" was read as a
    // phone number.
    //
    // Held as its own test because the fallback has been removed and reintroduced
    // before. Two headers in one file are allowed to be identical, so a name can
    // never identify a column; the index always can. The refusal below is what
    // makes that a rule rather than a preference.
    const sb = refusingStub();
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm(marketingStatus, true, [
          // Rotated by one: each header exists, none is where it says it is.
          { index: 0, action: "name", header: "name" },
          { index: 1, action: CONTACT_IMPORT_IGNORE, header: "Marketing Status" },
          { index: 2, action: "phone", header: "phone" },
        ]),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    // Named by POSITION, and the first one wrong is the one reported.
    expect(body.error.message).toBe(
      contactImportColumnMismatchMessage(
        `column 1 was declared as "name" and this file calls it "phone"`,
      ),
    );
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("refuses a declaration that is not about a column of this file", async () => {
    for (const [detail, columns] of [
      [
        // Past the end. Nothing stops a caller listing a column the file does
        // not have, and it is never harmless: an out-of-range `phone` points
        // the importer at cells that do not exist, and the file still looks
        // fully declared.
        "column 4 was declared and this file has 3 columns",
        [
          { index: 0, action: "phone", header: "phone" },
          { index: 1, action: "name", header: "name" },
          { index: 2, action: CONTACT_IMPORT_IGNORE, header: "Marketing Status" },
          { index: 3, action: CONTACT_IMPORT_IGNORE, header: "" },
        ],
      ],
      [
        "column 2 is declared twice",
        [
          { index: 0, action: "phone", header: "phone" },
          { index: 1, action: "name", header: "name" },
          { index: 1, action: CONTACT_IMPORT_IGNORE, header: "name" },
          { index: 2, action: CONTACT_IMPORT_IGNORE, header: "Marketing Status" },
        ],
      ],
      [
        "columns 2 and 3 were both declared `name`, and a contact has one",
        [
          { index: 0, action: "phone", header: "phone" },
          { index: 1, action: "name", header: "name" },
          { index: 2, action: "name", header: "Marketing Status" },
        ],
      ],
    ] as [string, ContactImportColumnDeclaration[]][]) {
      const sb = refusingStub();
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        "/v1/contacts/import",
        {
          method: "POST",
          companyId: COMPANY_ID,
          rawBody: importForm(marketingStatus, true, columns),
        },
      );
      expect(res.status, detail).toBe(422);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toBe(contactImportColumnMismatchMessage(detail));
      expect(sb.find("POST", "/rest/v1/contacts"), detail).toHaveLength(0);
    }
  });

  it("answers for a header that contains a COLON, which is why the header is last", async () => {
    // The wire format is `<index>:<action>:<header>` and the two splits before
    // the header are on fixed tokens precisely so the header may contain
    // anything. "Do Not Call: Y/N" is an ordinary CRM spelling, and if it could
    // not be declared the file would be permanently unimportable — which is a
    // usability defect right up until somebody works around it, and then it is
    // this one.
    //
    // A MIX: Y on one row, N on the other, so the column has to be READ rather
    // than merely accepted.
    const sb = importingStub();
    sb.on("PATCH", "/rest/v1/opt_outs", () => []);
    sb.on("POST", "/rest/v1/opt_outs", () => [{ id: OTHER_ID }]);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("POST", "/rest/v1/conversation_events", () => []);

    const csv = [
      "phone,name,Do Not Call: Y/N",
      "+14165550101,Jo,Y",
      "+14165550102,Sam,N",
    ].join("\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm(csv, true, [
          { index: 0, action: "phone", header: "phone" },
          { index: 1, action: "name", header: "name" },
          { index: 2, action: "opted_out", header: "Do Not Call: Y/N" },
        ]),
      },
    );
    expect(res.status).toBe(200);
    const blocked = sb
      .find("POST", "/rest/v1/opt_outs")
      .flatMap((call) => call.body as { phone_e164: string }[])
      .map((row) => row.phone_e164);
    expect(blocked).toEqual(["+14165550101"]);
  });

  it("refuses a `column` field that is not in the wire format at all", async () => {
    // Every other test here posts a WELL-FORMED declaration, because the helper
    // that builds them cannot produce anything else — so "be forgiving: match
    // it by header when the index is missing" survived all 3964 of them. That
    // refactor is header-as-identity restored under a new spelling, and header
    // identity is precisely what could not tell two nameless columns apart.
    //
    // Raw strings, posted directly, one malformed field among two good ones.
    for (const raw of [
      "ignore:Marketing Status", // no index — matchable by header
      ":ignore:Marketing Status", // empty index, and `Number("")` is 0
      "2:skip:Marketing Status", // not an action this importer has
      "Marketing Status", // not a declaration at all
    ]) {
      const sb = refusingStub();
      const form = new FormData();
      form.append(
        "file",
        new File([marketingStatus], "contacts.csv", { type: "text/csv" }),
      );
      form.append(CONTACT_IMPORT_CONSENT_FIELD, CONTACT_IMPORT_CONSENT_VALUE);
      form.append(CONTACT_IMPORT_COLUMN_FIELD, "0:phone:phone");
      form.append(CONTACT_IMPORT_COLUMN_FIELD, "1:name:name");
      form.append(CONTACT_IMPORT_COLUMN_FIELD, raw);

      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        "/v1/contacts/import",
        { method: "POST", companyId: COMPANY_ID, rawBody: form },
      );
      expect(res.status, raw).toBe(422);
      const body = (await res.json()) as { error: { message: string } };
      // The exact sentence, so a lenient parser that reads it as SOME column is
      // caught by the message even when it still ends in a 422.
      expect(body.error.message, raw).toBe(
        contactImportColumnMismatchMessage(
          `\`${raw}\` is not \`<index>:<field or ignore>:<header>\``,
        ),
      );
      expect(sb.find("POST", "/rest/v1/contacts"), raw).toHaveLength(0);
    }
  });

  it("imports it once somebody answers for the column", async () => {
    const sb = importingStub();
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm(marketingStatus, true, [
          { index: 0, action: "phone", header: "phone" },
          { index: 1, action: "name", header: "name" },
          { index: 2, action: CONTACT_IMPORT_IGNORE, header: "Marketing Status" },
        ]),
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 4 });
    // And the workspace's claim is on the audit row, next to the consent
    // attestation it stands beside — it is a claim, not a fact we verified.
    const audit = sb
      .find("POST", "/rest/v1/audit_log")
      .flatMap((call) => call.body as { after: { columns?: string[] } }[]);
    expect(audit[0]?.after.columns).toEqual([
      "0:phone:phone",
      "1:name:name",
      `2:${CONTACT_IMPORT_IGNORE}:Marketing Status`,
    ]);
  });

  it("reads a Do Not Call column, marked the way a person marks one", async () => {
    // The default guess widened — "Do Not Call" is the commonest spelling of
    // this column and none of the original patterns matched it — and the `x`
    // that a hand-maintained sheet uses, which the API's own truthy set left
    // out, so an x-marked opt-out column imported as nobody opted out at all.
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    sb.on("PATCH", "/rest/v1/opt_outs", () => []);
    sb.on("POST", "/rest/v1/opt_outs", () => [{ id: OTHER_ID }]);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const csv = [
      "Phone,Name,Do Not Call",
      "+14165550101,Jo,x",
      "+14165550102,Sam,",
      "+14165550103,Ali,X",
    ].join("\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(csv) },
    );
    expect(res.status).toBe(200);
    const blocked = sb
      .find("POST", "/rest/v1/opt_outs")
      .flatMap((call) => call.body as { phone_e164: string }[])
      .map((row) => row.phone_e164);
    expect(blocked).toEqual(["+14165550101", "+14165550103"]);
    // And the one they did not mark keeps the file's attestation.
    const rows = sb
      .find("POST", "/rest/v1/contacts")
      .flatMap((call) => call.body as Record<string, unknown>[]);
    expect(
      rows.find((row) => row.phone_e164 === "+14165550102"),
    ).toMatchObject({ consent_source: "attested" });
  });

  it("refuses a do-not-text column whose values it cannot read", async () => {
    // The same defect one level down: the column was identified CORRECTLY and
    // then read as nobody opted out, because anything that was not `yes` was
    // silently false. Not resolvable by a declaration — this column was
    // declared the thing that decides who may be texted.
    const sb = refusingStub();
    const csv = [
      "phone,Do Not Contact",
      "+14165550101,Subscribed",
      "+14165550102,Unsubscribed",
    ].join("\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(csv) },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(
      contactImportUnreadableFlagMessage("Do Not Contact", [
        "Subscribed",
        "Unsubscribed",
      ]),
    );
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("lets an ordinary export through once its columns are answered", async () => {
    // The cost of being wrong in this direction is a workspace that cannot
    // import its book, so the columns a real file carries and this importer
    // ignores — a note, an address it did not map, an email — go through once
    // somebody has said what they are. This is the shape of the default guess
    // a client shows: two mapped, three ignored.
    const sb = importingStub();
    const csv = [
      "phone,name,Email,Job,Country",
      "+14165550101,Jo,jo@example.com,gutters cleared before winter,US",
      "+14165550102,Sam,sam@example.com,quote for a new roof,US",
      "+14165550103,Ali,ali@example.com,leak over the porch,US",
    ].join("\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(csv) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 3 });
    // And nobody was blocked. An `ignore` is a person saying the column says
    // nothing about who may be texted, so it must not quietly become one.
    expect(sb.find("POST", "/rest/v1/opt_outs")).toHaveLength(0);
  });

  it("applies the row cap BEFORE it reads a single column", async () => {
    // I12. The ordering is stated as a guarantee — the column pass walks every
    // cell of every row and the cap is what bounds that walk — and a comment
    // stating a guarantee nothing enforces is how the guarantee stops being
    // true. This file declares NOTHING, so a cap that ran second would answer
    // with the undeclared-columns refusal instead.
    const sb = refusingStub();
    const lines = ["phone"];
    for (let i = 0; i <= CONTACT_IMPORT_MAX_ROWS; i += 1) {
      lines.push(`+1416${String(5550000 + i).padStart(7, "0")}`);
    }
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm(`${lines.join("\n")}\n`, true, null),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(
      `file: too many rows (max ${CONTACT_IMPORT_MAX_ROWS}).`,
    );
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
  });
});

/**
 * #248 H5 — the two ways a file was silently mangled.
 *
 * Neither delivers a message, and both lose data. That is not a lesser defect
 * wearing a smaller hat: a person who is silently absent from a crew's contact
 * list is never texted, and is also never seen, so nobody ever finds out. The
 * import's whole promise is that every row is either imported or reported.
 */
describe("#248 H5 a file that cannot be read is refused, not half-read", () => {
  function refusingStub(): SupabaseStub {
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    stubFetch(jwksRoute(auth), sb.route);
    return sb;
  }

  it("refuses an unterminated quote instead of eating every row after it", async () => {
    // Proved live: this file imported 200, with ordinary counts and NOT ONE
    // error row, having swallowed Ann and Cass into one enormous value. A MIX —
    // one row before the open quote, two after — so the rows that survive and
    // the rows that vanish are both in the fixture.
    const sb = refusingStub();
    const csv = [
      "phone,name",
      "+14165550100,Bo",
      '+14165550101,"Ann',
      "+14165550102,Cass",
    ].join("\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm(csv, true, [
          { index: 0, action: "phone", header: "phone" },
          { index: 1, action: "name", header: "name" },
        ]),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    // The shipped sentence, naming the line the quote OPENED on — by EOF the
    // position is the one place in the file that looks fine.
    expect(body.error.message).toBe(contactImportUnterminatedQuoteMessage(3));
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("refuses a UTF-16 save with a sentence, where it used to answer 500", async () => {
    // Excel's "Unicode Text". `File.text()` decodes it as UTF-8, so the zero
    // byte between every ASCII character survives, travels the whole route, and
    // dies at Postgres with `unsupported Unicode escape sequence` — which
    // reached the customer as a 500 telling them nothing. Refusing is a fine
    // answer; crashing is not.
    const sb = refusingStub();
    const utf16 = new Uint8Array([
      0xff, 0xfe, // BOM, as Excel writes it
      ...[..."phone,name\n+14165550100,Bo\n"].flatMap((char) => [
        char.charCodeAt(0),
        0x00,
      ]),
    ]);
    const form = new FormData();
    form.append(
      "file",
      new File([utf16], "contacts.csv", { type: "text/csv" }),
    );
    form.append(CONTACT_IMPORT_CONSENT_FIELD, CONTACT_IMPORT_CONSENT_VALUE);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: form },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(CONTACT_IMPORT_UNREADABLE_ENCODING);
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("refuses the same file at the vCard door, which decodes just as badly", async () => {
    // The gate belongs to both doors or to neither — a phone's export is the
    // file most likely to have been round-tripped through a desktop program.
    const sb = refusingStub();
    const card = "BEGIN:VCARD\r\nFN:Bo\r\nTEL:+14165550100\r\nEND:VCARD\r\n";
    const utf16 = new Uint8Array(
      [...card].flatMap((char) => [char.charCodeAt(0), 0x00]),
    );
    const form = new FormData();
    form.append(
      "file",
      new File([utf16], "contacts.vcf", { type: "text/vcard" }),
    );
    form.append(CONTACT_IMPORT_CONSENT_FIELD, CONTACT_IMPORT_CONSENT_VALUE);
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import-vcard",
      { method: "POST", companyId: COMPANY_ID, rawBody: form },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(CONTACT_IMPORT_UNREADABLE_ENCODING);
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("still imports an ordinary quoted file, which is the same branch", async () => {
    // A refusal that also refused every properly quoted export would be worse
    // than the defect: `"Smith, John"` is the reason quoting exists, and a
    // guard that fires on it is a guard somebody deletes.
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const csv = 'phone,name\n+14165550100,"Smith, John"\n+14165550101,Bo\n';
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(csv) },
    );
    expect(res.status).toBe(200);
    const rows = sb
      .find("POST", "/rest/v1/contacts")
      .flatMap((call) => call.body as Record<string, unknown>[]);
    expect(rows.map((row) => row.name)).toEqual(["Smith, John", "Bo"]);
  });
});

describe("#248 the import bounds a file has to stay inside", () => {
  it("refuses one row past the shared cap, and accepts the cap itself", async () => {
    // Both halves, because either alone is satisfiable by the wrong code: a
    // refusal alone passes with no bound at all if the fixture is big enough
    // to fail for another reason, and an acceptance alone passes with the
    // check deleted. Built FROM the shared constant, so a server that quietly
    // enforced a different number than the clients print would fail here.
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const rows = (count: number) => {
      const lines = ["phone"];
      for (let i = 0; i < count; i += 1) {
        lines.push(`+1416${String(5550000 + i).padStart(7, "0")}`);
      }
      return `${lines.join("\n")}\n`;
    };

    const over = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm(rows(CONTACT_IMPORT_MAX_ROWS + 1)),
      },
    );
    expect(over.status).toBe(422);
    const body = (await over.json()) as { error: { message: string } };
    expect(body.error.message).toContain(String(CONTACT_IMPORT_MAX_ROWS));

    const atCap = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: importForm(rows(CONTACT_IMPORT_MAX_ROWS)),
      },
    );
    expect(atCap.status).toBe(200);
  });

  it("takes only the literal word as an attestation", async () => {
    // A field that also accepts "false" is not an attestation, it is a field.
    // The strictness is the whole property — loosening the check to "present
    // and not null" reads a checkbox somebody left unticked as consent.
    const sb = stubWithRole("admin");
    stubFetch(jwksRoute(auth), sb.route);

    for (const value of ["false", "TRUE", "1", "yes", ""]) {
      const form = new FormData();
      form.append("file", new File(["phone\n+14165550101\n"], "c.csv"));
      form.append(CONTACT_IMPORT_CONSENT_FIELD, value);
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        "/v1/contacts/import",
        { method: "POST", companyId: COMPANY_ID, rawBody: form },
      );
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toBe(CONTACT_IMPORT_CONSENT_REQUIRED);
    }
  });
});

describe("#248 what an import says about the rows it refused", () => {
  /** A file with a refused row sitting beside attested ones. */
  const mixed = [
    "phone,name",
    "+14165550101,Jo",
    `${STOPPED_PHONE},Sam`,
    "+14165550103,Ali",
  ].join("\n");

  function mixedStub(): SupabaseStub {
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { phone_e164: STOPPED_PHONE, source: "stop_keyword" },
    ]);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    return sb;
  }

  it("decides per row, not once for the file", async () => {
    // EVERY shipped #248 consent test uploaded a one-row file, so a defect
    // that only appears when a refused row sits beside an attested one — the
    // shape of every real export — was invisible to all of them. Proved:
    // reading the map's first decision for every row survived the whole suite.
    const sb = mixedStub();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(mixed) },
    );
    expect(res.status).toBe(200);

    const rows = sb
      .find("POST", "/rest/v1/contacts")
      .flatMap((call) => call.body as Record<string, unknown>[]);
    const byPhone = new Map(rows.map((row) => [row.phone_e164, row]));
    // The two who never said stop take the file's attestation...
    expect(byPhone.get("+14165550101")).toMatchObject({
      consent_source: "attested",
    });
    expect(byPhone.get("+14165550103")).toMatchObject({
      consent_source: "attested",
    });
    // ...and the one who did takes none of it, sitting between them.
    expect(byPhone.get(STOPPED_PHONE)).not.toHaveProperty("consent_source");
    expect(byPhone.get(STOPPED_PHONE)).not.toHaveProperty("consent_at");
  });

  it("counts exactly what it lists", async () => {
    // Web renders the NUMBER. A list that was ever truncated for a response
    // size limit would print "40 refused" above five rows with nothing saying
    // the rest existed, and no test on either side would have noticed.
    const sb = stubWithRole("admin");
    const stopped = ["+14163014444", "+14163014445", "+14163014446"];
    sb.on("GET", "/rest/v1/opt_outs", () =>
      stopped.map((phone) => ({ phone_e164: phone, source: "stop_keyword" })),
    );
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const csv = ["phone,name", ...stopped.map((p, i) => `${p},Person ${i}`)].join(
      "\n",
    );
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(csv) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      consent_refused: number;
      consent_refusals: { row: number; reason: string }[];
    };
    expect(body.consent_refusals).toHaveLength(stopped.length);
    expect(body.consent_refused).toBe(body.consent_refusals.length);
    expect(body.consent_refusals.map((r) => r.reason)).toEqual(
      stopped.map((phone) => contactImportConsentRefusedReason(phone)),
    );
  });

  it("puts the refused count on the audit row of an import that DIED", async () => {
    // The refusals are decided before the first write, so they are known even
    // when the import fails — and this is the one path where the response body
    // never reaches anybody, because the caller gets a 500. Leaving it off
    // meant a failed import reported its refused rows nowhere at all.
    // Registered BEFORE the shared stub claims the path — this harness is
    // first-match-wins, so a later handler for a path already taken never runs.
    const sb = stubWithRole("admin");
    sb.on(
      "POST",
      "/rest/v1/contacts",
      () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    );
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { phone_e164: STOPPED_PHONE, source: "stop_keyword" },
    ]);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/audit_log", () => new Response(null, { status: 201 }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(mixed) },
    );
    expect(res.status).toBe(500);
    const audit = sb.find("POST", "/rest/v1/audit_log")[0].body as {
      after: Record<string, unknown>;
    };
    expect(audit.after).toMatchObject({
      outcome: "failed",
      consent_refused: 1,
    });
  });

  it("fails the whole import rather than guess at a flaky opt-out read", async () => {
    // The cheapest way to reintroduce every defect above is to stop this read
    // 500-ing: one try/catch that answers "found nothing" turns an unreadable
    // opt-out table into a permissive one, and an import would then attest
    // over every standing STOP in the workspace. Nothing written, and the
    // caller is told, which is the only honest answer to "I could not check".
    const sb = stubWithRole("admin");
    sb.on(
      "GET",
      "/rest/v1/opt_outs",
      () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    );
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/audit_log", () => new Response(null, { status: 201 }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(mixed) },
    );
    expect(res.status).toBe(500);
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
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

function vcardForm(
  vcf: string,
  attested = true,
  /**
   * #248 round 3: what somebody said the cards' unread properties mean. The
   * fixtures below carry only FN/N/TEL/VERSION, which the parser reads, so most
   * of them need none — the gate is asserted directly by the tests that add a
   * `CATEGORIES` or a `NOTE`.
   */
  properties: { property: string; action: "ignore" | "opted_out" }[] = [],
): FormData {
  const form = new FormData();
  form.append("file", new File([vcf], "contacts.vcf", { type: "text/vcard" }));
  // #248: this route now stands behind the same attestation the CSV route has
  // since #226. Defaulted, like importForm, so the tests below keep describing
  // what they were written for; the gate is asserted directly.
  if (attested) {
    form.append(CONTACT_IMPORT_CONSENT_FIELD, CONTACT_IMPORT_CONSENT_VALUE);
  }
  for (const declaration of properties) {
    form.append(
      CONTACT_IMPORT_VCARD_PROPERTY_FIELD,
      formatVCardProperty(declaration),
    );
  }
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

  it("#248: our own header comes back asking about its non-field columns", async () => {
    // D20 §3.1 promises a lossless round trip, and round two broke it: the
    // shape gate refused our own export 422, naming `tags` and `consent_source`.
    // Under round three every column has to be ANSWERED, and #248 H1 settles
    // who answers: the guess maps the two columns that are contact fields and
    // says nothing about the four that are not, so a person re-importing our
    // export dismisses `tags` and the consent columns the same way they would
    // dismiss anybody else's. The round-trip test below runs it end to end.
    //
    // Built from the shipped constant, so adding a column moves this with it.
    const guess = defaultContactImportColumns([...EXPORT_HEADER]);
    expect(guess).toHaveLength(EXPORT_HEADER.length);
    expect(guess.map((column) => column.header)).toEqual([...EXPORT_HEADER]);
    expect(guess.find((column) => column.header === "phone")?.action).toBe("phone");
    expect(guess.find((column) => column.header === "name")?.action).toBe("name");
    // NOT dismissed on the workspace's behalf. `consent_source` says how we may
    // text somebody, and a file we wrote is still a file somebody has to read:
    // an export edited in a spreadsheet before being re-imported is the normal
    // way this feature is used.
    expect(guess.find((column) => column.header === "consent_source")?.action)
      .toBeNull();
  });

  it("#248: exports, re-imports, and lands the same contact (D20 §3.1)", async () => {
    // The round-trip guard that actually runs the round trip. The one it
    // replaces asserted the exported HEADER string and stopped there, so it
    // went on passing while a re-import of that exact file was refused 422.
    //
    // The name is chosen to need the export's CSV-injection guard AND RFC
    // quoting: it begins with `=` and contains a comma, so it survives only if
    // both the guard and the importer's unguard are right.
    const exported = {
      id: CONTACT_ID,
      name: "=Jo, Smith",
      phone_e164: "+14165550199",
      consent_source: "attested",
      consent_at: "2026-06-01T00:00:00+00:00",
      created_at: "2026-05-01T00:00:00+00:00",
    };
    const exportSb = stubWithRole("admin");
    exportSb.on("GET", "/rest/v1/contacts", () => [exported]);
    exportSb.on("GET", "/rest/v1/conversations", () => [
      {
        contact_id: CONTACT_ID,
        conversation_tags: [{ tags: { name: "Quote sent" } }],
      },
    ]);
    stubFetch(jwksRoute(auth), exportSb.route);

    const exportRes = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/export",
      { companyId: COMPANY_ID },
    );
    expect(exportRes.status).toBe(200);
    const bytes = new Uint8Array(await exportRes.arrayBuffer());
    const csv = new TextDecoder("utf-8").decode(bytes.slice(3));

    const importSb = stubWithRole("admin");
    noStandingOptOuts(importSb);
    importSb.on("GET", "/rest/v1/contacts", () => []);
    importSb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    stubFetch(jwksRoute(auth), importSb.route);

    // The declaration a client builds from the file it is holding — no
    // hand-written list, so this fails if the guess stops covering our header.
    const importRes = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import",
      { method: "POST", companyId: COMPANY_ID, rawBody: importForm(csv) },
    );
    expect(importRes.status).toBe(200);
    expect(await importRes.json()).toMatchObject({ imported: 1, skipped: 0 });
    const landed = importSb
      .find("POST", "/rest/v1/contacts")
      .flatMap((call) => call.body as Record<string, unknown>[]);
    expect(landed).toHaveLength(1);
    expect(landed[0]).toMatchObject({
      phone_e164: exported.phone_e164,
      name: exported.name,
    });
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
      "(name.ilike.*smi*,phone_e164.ilike.*smi*,business_name.ilike.*smi*,email.ilike.*smi*,custom_values.ilike.*smi*)",
    );
  });
});

/**
 * What a person answers about an ORDINARY phone export's parameters.
 *
 * #248 H3: `TEL;TYPE=CELL` carries free text after the `=`, and everything
 * after the first `;` used to be discarded — so `TEL;TYPE=CELL;X-ABLabel=DO NOT
 * CALL:+1613…`, which is Apple's inline shape, imported and delivered. The
 * parameter is now enumerated as `TEL;TYPE` and answered like any other
 * property. On these fixtures the values are CELL, work and uri, and they
 * decide nothing — which is what somebody who has seen them says.
 *
 * Built through the shared formatter, so the token the server enumerates and
 * the token a caller declares cannot drift apart.
 */
const PHONE_EXPORT_PARAMS: { property: string; action: "ignore" }[] = [
  { property: vcardParameterProperty("TEL", "TYPE"), action: "ignore" },
  { property: vcardParameterProperty("TEL", "VALUE"), action: "ignore" },
];

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

  it("#248: refuses a vCard import that states no consent basis", async () => {
    // #226 put this gate on the CSV route and left this one open, so the only
    // working bulk-contact door was the one that asked nothing — and it is the
    // worse one to leave open. A phone's address book is not a consent record;
    // it is every number its owner ever dialled.
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
        rawBody: vcardForm(multiVcf, false),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("validation_failed");
    // The same sentence the CSV route answers with — one gate, one wording.
    expect(body.error.message).toBe(CONTACT_IMPORT_CONSENT_REQUIRED);
    // And refused before the file was parsed: nothing was read or written.
    expect(sb.find("GET", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("#248: writes the attested basis on new cards and leaves an existing one alone", async () => {
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => [
      {
        phone_e164: "+14165550111", // Alice already texted this business
        consent_source: "inbound_sms",
        consent_at: "2026-03-12T15:04:00+00:00",
      },
    ]);
    sb.on("POST", "/rest/v1/contacts", () => [{ id: CONTACT_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import-vcard",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: vcardForm(multiVcf, true, PHONE_EXPORT_PARAMS),
      },
    );
    expect(res.status).toBe(200);
    const rows = sb
      .find("POST", "/rest/v1/contacts")
      .flatMap((call) => call.body as Record<string, unknown>[]);
    const alice = rows.find((row) => row.phone_e164 === "+14165550111");
    expect(alice).not.toHaveProperty("consent_source");
    expect(alice).not.toHaveProperty("consent_at");
    for (const row of rows.filter((r) => r.phone_e164 !== "+14165550111")) {
      expect(row).toMatchObject({
        consent_source: "attested",
        consent_attested_by: auth.subject,
      });
    }
  });

  it("#248 D1: a card cannot attest over a standing STOP either", async () => {
    // This route is the one where the file CANNOT know. A .vcf has no property
    // for "this person told us to stop" — it is a phone's address book, every
    // number its owner ever dialled — so without the opt_outs read every
    // standing STOP in it would take the importer's attestation, every time.
    const sb = stubWithRole("admin");
    sb.on("GET", "/rest/v1/opt_outs", () => [
      { phone_e164: STOPPED_PHONE, source: "stop_keyword" },
    ]);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", () => [{ id: CONTACT_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Jo Smith",
      `TEL:${STOPPED_PHONE}`,
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Sam Lee",
      "TEL:+14165550152",
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
    const rows = sb
      .find("POST", "/rest/v1/contacts")
      .flatMap((call) => call.body as Record<string, unknown>[]);
    const stopped = rows.find((row) => row.phone_e164 === STOPPED_PHONE);
    expect(stopped).toMatchObject({ name: "Jo Smith" });
    expect(stopped).not.toHaveProperty("consent_source");
    // The card beside it is untouched by any of this: an ordinary new contact
    // still gets the basis the attestation records.
    expect(rows.find((row) => row.phone_e164 === "+14165550152")).toMatchObject({
      consent_source: "attested",
      consent_attested_by: auth.subject,
    });
    // Reported with the same three fields the CSV route answers with — a
    // client that had to branch on which door it used would eventually show
    // the note on one and not the other.
    expect(await res.json()).toMatchObject({
      consent_refused: 1,
      consent_refusals: [
        { row: 1, reason: contactImportConsentRefusedReason(STOPPED_PHONE) },
      ],
      consent_refused_note: CONTACT_IMPORT_CONSENT_REFUSED_NOTE,
    });
  });

  it("#248: batches by key set, so a nameless card cannot strip the names off the rest", async () => {
    // PostgREST takes the column list from the FIRST row of a batch. This route
    // sliced its rows straight into chunks, so a card with no FN landing first
    // dropped `name` from every row behind it — a phone book that starts with a
    // bare number imported as a page of numbers with no names.
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", () => [{ id: CONTACT_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0", // no FN at all → this row carries no `name` key
      "TEL:+14165550150",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Dana Diaz",
      "TEL:+14165550151",
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
    for (const call of sb.find("POST", "/rest/v1/contacts")) {
      const rows = call.body as Record<string, unknown>[];
      const shapes = new Set(rows.map((row) => Object.keys(row).sort().join(",")));
      expect(shapes.size).toBe(1);
    }
    const named = sb
      .find("POST", "/rest/v1/contacts")
      .flatMap((call) => call.body as Record<string, unknown>[])
      .find((row) => row.phone_e164 === "+14165550151");
    expect(named?.name).toBe("Dana Diaz");
  });

  it("parses a multi-card .vcf, normalizes E.164, and upserts (admin only)", async () => {
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []); // none pre-existing → all imported
    sb.on("POST", "/rest/v1/contacts", () => [{ id: CONTACT_ID }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import-vcard",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: vcardForm(multiVcf, true, PHONE_EXPORT_PARAMS),
      },
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
    noStandingOptOuts(sb);
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
    noStandingOptOuts(sb);
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

/**
 * #248 round 3 — the vCard door had no gate of any kind.
 *
 * `CATEGORIES:DNC` and `NOTE:DO NOT CONTACT - asked us to stop` are the only two
 * places the format lets a card say do-not-text, they are what Apple and Google
 * actually export, and both imported attested with a message delivered.
 */
describe("#248 every property on the cards is answered for", () => {
  const dncVcf = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Dana Diaz",
    "TEL:+14165550111",
    "CATEGORIES:DNC",
    "END:VCARD",
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Eli East",
    "TEL:+14165550112",
    "END:VCARD",
  ].join("\r\n");

  it("refuses a file whose CATEGORIES and NOTE nobody answered for", async () => {
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Dana Diaz",
      "TEL:+14165550111",
      "CATEGORIES:DNC",
      "NOTE:DO NOT CONTACT - asked us to stop",
      "END:VCARD",
    ].join("\r\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import-vcard",
      { method: "POST", companyId: COMPANY_ID, rawBody: vcardForm(vcf) },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(
      contactImportUndeclaredPropertiesMessage(["CATEGORIES", "NOTE"]),
    );
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("blocks the cards carrying a property somebody declared do-not-text", async () => {
    // A MIX: one card carries CATEGORIES, one does not, so a resolver that
    // answered once for the file could not pass. And the restriction is written
    // BEFORE the contacts, like every other import path — whichever prefix of a
    // half-finished run lands has to be the safe half.
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    sb.on("PATCH", "/rest/v1/opt_outs", () => []);
    sb.on("POST", "/rest/v1/opt_outs", () => [{ id: OTHER_ID }]);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import-vcard",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: vcardForm(dncVcf, true, [
          { property: "CATEGORIES", action: "opted_out" },
        ]),
      },
    );
    expect(res.status).toBe(200);
    const blocked = sb
      .find("POST", "/rest/v1/opt_outs")
      .flatMap((call) => call.body as { phone_e164: string }[])
      .map((row) => row.phone_e164);
    expect(blocked).toEqual(["+14165550111"]);
    // The blocked card takes no attestation — an import may lower a contact's
    // standing, never raise it — and the other card does.
    const rows = sb
      .find("POST", "/rest/v1/contacts")
      .flatMap((call) => call.body as Record<string, unknown>[]);
    expect(rows.find((row) => row.phone_e164 === "+14165550111")).not.toHaveProperty(
      "consent_source",
    );
    expect(
      rows.find((row) => row.phone_e164 === "+14165550112"),
    ).toMatchObject({ consent_source: "attested" });
    // And the workspace's claim is on the audit row.
    const audit = sb
      .find("POST", "/rest/v1/audit_log")
      .flatMap((call) => call.body as { after: { properties?: string[] } }[]);
    expect(audit[0]?.after.properties).toEqual(["CATEGORIES:opted_out"]);
  });

  it("blocks on the property somebody actually pointed at, not the one we expected", async () => {
    // The test above declares CATEGORIES, so narrowing the block to
    // `property === "CATEGORIES"` survived all 3964 tests — a whole gate proved
    // on one noun. `NOTE:DO NOT CONTACT - asked us to stop` is the OTHER of the
    // two places a .vcf can say this, it is what Apple exports, and under that
    // narrowing the person would tick "do not text" on it, be told 200, and the
    // card would be created textable. Which ends in a delivered message.
    //
    // A MIX in both directions: two unread properties, one blocking and one
    // not, over three cards that carry different combinations of them.
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    sb.on("PATCH", "/rest/v1/opt_outs", () => []);
    sb.on("POST", "/rest/v1/opt_outs", () => [{ id: OTHER_ID }]);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Dana Diaz",
      "TEL:+14165550111",
      "NOTE:DO NOT CONTACT - asked us to stop",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Eli East",
      "TEL:+14165550112",
      // Carries the property that was declared harmless, so a gate that blocked
      // on "any declared property" rather than the blocking one fails here too.
      "CATEGORIES:Regulars",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Fay Fox",
      "TEL:+14165550113",
      "END:VCARD",
    ].join("\r\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import-vcard",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: vcardForm(vcf, true, [
          { property: "NOTE", action: "opted_out" },
          { property: "CATEGORIES", action: "ignore" },
        ]),
      },
    );
    expect(res.status).toBe(200);
    const blocked = sb
      .find("POST", "/rest/v1/opt_outs")
      .flatMap((call) => call.body as { phone_e164: string }[])
      .map((row) => row.phone_e164);
    expect(blocked).toEqual(["+14165550111"]);
    const rows = sb
      .find("POST", "/rest/v1/contacts")
      .flatMap((call) => call.body as Record<string, unknown>[]);
    expect(
      rows.find((row) => row.phone_e164 === "+14165550111"),
    ).not.toHaveProperty("consent_source");
    expect(
      rows.find((row) => row.phone_e164 === "+14165550112"),
    ).toMatchObject({ consent_source: "attested" });
  });

  it("keeps the restriction a DUPLICATE card carried, like the CSV door does", async () => {
    // D2 at the other door. The CSV importer learned this the hard way — a
    // merge of two exports lists the same person twice, once plain and once
    // flagged, and dropping the duplicate ROW used to drop the RESTRICTION with
    // it. The vCard door has the identical branch and nothing asserted it, so
    // deleting `if (optedOut) seen.optedOut = true` survived all 3964 tests.
    //
    // The restriction belongs to the person, not to the card that happened to
    // carry it. Here the marked card is SECOND, which is the order that loses:
    // the first card wins the entry and the second is discarded.
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    sb.on("PATCH", "/rest/v1/opt_outs", () => []);
    sb.on("POST", "/rest/v1/opt_outs", () => [{ id: OTHER_ID }]);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Dana Diaz",
      "TEL:+14165550111",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Dana D.",
      "TEL:+14165550111",
      "CATEGORIES:DNC",
      "END:VCARD",
    ].join("\r\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import-vcard",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: vcardForm(vcf, true, [
          { property: "CATEGORIES", action: "opted_out" },
        ]),
      },
    );
    expect(res.status).toBe(200);
    const blocked = sb
      .find("POST", "/rest/v1/opt_outs")
      .flatMap((call) => call.body as { phone_e164: string }[])
      .map((row) => row.phone_e164);
    expect(blocked).toEqual(["+14165550111"]);
    // And the surviving row takes no attestation over the top of it.
    const rows = sb
      .find("POST", "/rest/v1/contacts")
      .flatMap((call) => call.body as Record<string, unknown>[]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("consent_source");
  });

  it("imports the same file untouched when somebody says the property is nothing", async () => {
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import-vcard",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: vcardForm(dncVcf, true, [
          { property: "CATEGORIES", action: "ignore" },
        ]),
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 2 });
    expect(sb.find("POST", "/rest/v1/opt_outs")).toHaveLength(0);
  });

  it("H3: asks about a PARAMETER, where Apple's inline label lives", async () => {
    // `TEL;TYPE=CELL;X-ABLabel=DO NOT CALL:+1613…`. The property is TEL, TEL is
    // mapped, and everything after the first `;` was discarded — so this card
    // imported attested and the message was delivered, while the same
    // instruction written Apple's OTHER way (`item1.X-ABLabel:`) was caught.
    // One shape of one export deciding whether somebody is texted is not a
    // gate.
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Dana Diaz",
      "TEL;TYPE=CELL;X-ABLabel=DO NOT CALL:+16135550111",
      "END:VCARD",
    ].join("\r\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import-vcard",
      { method: "POST", companyId: COMPANY_ID, rawBody: vcardForm(vcf) },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    // Both parameters, under the shared token shape — a client that enumerated
    // fewer than the server does is refused forever, so the two have to agree
    // on the string as well as on the rule.
    expect(body.error.message).toBe(
      contactImportUndeclaredPropertiesMessage([
        vcardParameterProperty("TEL", "TYPE"),
        vcardParameterProperty("TEL", "X-ABLABEL"),
      ]),
    );
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("H3: blocks the card once somebody says that parameter means do-not-text", async () => {
    // The other half: the refusal has to be answerable, and the answer has to
    // do something. A MIX — two cards, both carrying `TEL;TYPE`, only one
    // carrying the label — so a gate that blocked on "any declared parameter"
    // fails here alongside one that blocks nobody.
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("POST", "/rest/v1/contacts", (call) =>
      (call.body as { phone_e164: string }[]).map((row) => ({
        id: CONTACT_ID,
        phone_e164: row.phone_e164,
      })),
    );
    sb.on("PATCH", "/rest/v1/opt_outs", () => []);
    sb.on("POST", "/rest/v1/opt_outs", () => [{ id: OTHER_ID }]);
    sb.on("GET", "/rest/v1/conversations", () => []);
    sb.on("POST", "/rest/v1/conversation_events", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const vcf = [
      "BEGIN:VCARD",
      "FN:Dana Diaz",
      "TEL;TYPE=CELL;X-ABLabel=DO NOT CALL:+16135550111",
      "END:VCARD",
      "BEGIN:VCARD",
      "FN:Eli East",
      "TEL;TYPE=CELL:+16135550112",
      "END:VCARD",
    ].join("\r\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import-vcard",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: vcardForm(vcf, true, [
          { property: vcardParameterProperty("TEL", "TYPE"), action: "ignore" },
          {
            property: vcardParameterProperty("TEL", "X-ABLABEL"),
            action: "opted_out",
          },
        ]),
      },
    );
    expect(res.status).toBe(200);
    const blocked = sb
      .find("POST", "/rest/v1/opt_outs")
      .flatMap((call) => call.body as { phone_e164: string }[])
      .map((row) => row.phone_e164);
    expect(blocked).toEqual(["+16135550111"]);
    const rows = sb
      .find("POST", "/rest/v1/contacts")
      .flatMap((call) => call.body as Record<string, unknown>[]);
    expect(
      rows.find((row) => row.phone_e164 === "+16135550111"),
    ).not.toHaveProperty("consent_source");
    expect(
      rows.find((row) => row.phone_e164 === "+16135550112"),
    ).toMatchObject({ consent_source: "attested" });
  });

  it("H3: asks about a line with no colon, and one whose parameter ate it", async () => {
    // Two ways into the same hole, both of which reached `properties.add`
    // never having been parsed: a bare `DO-NOT-CALL` line (not a content line
    // by the RFC — a statement about the format, not about what the person
    // meant) and `CATEGORIES;TYPE="a:DNC`, where one unbalanced quote hides the
    // only colon and takes CATEGORIES with it.
    for (const [line, expected] of [
      ["DO-NOT-CALL", ["DO-NOT-CALL"]],
      ['CATEGORIES;TYPE="a:DNC', ["CATEGORIES", "CATEGORIES;TYPE"]],
    ] as [string, string[]][]) {
      const sb = stubWithRole("admin");
      noStandingOptOuts(sb);
      sb.on("GET", "/rest/v1/contacts", () => []);
      stubFetch(jwksRoute(auth), sb.route);

      const vcf = [
        "BEGIN:VCARD",
        "FN:Dana Diaz",
        "TEL:+14165550111",
        line,
        "END:VCARD",
      ].join("\r\n");
      const res = await apiRequest(
        app,
        env,
        await auth.token(),
        "/v1/contacts/import-vcard",
        { method: "POST", companyId: COMPANY_ID, rawBody: vcardForm(vcf) },
      );
      expect(res.status, line).toBe(422);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message, line).toBe(
        contactImportUndeclaredPropertiesMessage(expected),
      );
      expect(sb.find("POST", "/rest/v1/contacts"), line).toHaveLength(0);
      vi.unstubAllGlobals();
    }
  });

  it("still refuses a SECOND property the caller has not seen", async () => {
    // Answering is per property and per file, so the next phone export growing
    // an `X-DNC` is refused again rather than covered by yesterday's answer.
    const sb = stubWithRole("admin");
    noStandingOptOuts(sb);
    sb.on("GET", "/rest/v1/contacts", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const vcf = [
      "BEGIN:VCARD",
      "FN:Dana Diaz",
      "TEL:+14165550111",
      "CATEGORIES:DNC",
      "X-DNC:1",
      "END:VCARD",
    ].join("\r\n");
    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts/import-vcard",
      {
        method: "POST",
        companyId: COMPANY_ID,
        rawBody: vcardForm(vcf, true, [
          { property: "CATEGORIES", action: "ignore" },
        ]),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(
      contactImportUndeclaredPropertiesMessage(["X-DNC"]),
    );
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
    noStandingOptOuts(sb);
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
    noStandingOptOuts(sb);
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
    options: {
      taken?: Record<string, unknown>[];
      existing?: Record<string, unknown>[];
    } = {},
  ) {
    return (call: { url: URL }) =>
      call.url.searchParams.has("phone_e164")
        ? options.taken ?? []
        : options.existing ?? [];
  }

  it("CPR-1: records a second number, normalised", async () => {
    // Normalised BEFORE storage, because this column is compared against a
    // webhook's `from`. A raw "(416) 555-0177" would look recorded and never
    // resolve.
    const sb = stubWithRole("member", [], phoneReads());
    contactReads(sb);
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
    const sb = stubWithRole("member", [], phoneReads({
      taken: [{ contact_id: OTHER_ID }],
    }));
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
        body: { phone_e164: "+14165550166" },
      },
    );
    expect(res.status).toBe(422);
    expect(sb.find("POST", "/rest/v1/contact_phones")).toHaveLength(0);
  });

  it("CPR-5: stops at the cap", async () => {
    const sb = stubWithRole("member", [], phoneReads({
      // Nobody else has the number; this contact simply already has eight.
      existing: Array.from({ length: 8 }, (_unused, index) => ({
        id: `p${index}`,
      })),
    }));
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

/**
 * #291 — finding a customer by a number that is not their main one.
 *
 * The whole complaint the issue opens with is that this knowledge is
 * unfindable. A crew that recorded Dave's landline and then cannot find Dave
 * by typing it has a record that took effort to create and gives nothing back.
 *
 * CS-2 is the one to read twice. The second query is joined THROUGH the phones
 * table, so on its own it would return only contacts that have a second
 * number — nearly none of them. It has to be a union with the ordinary search,
 * not a replacement for it.
 */
describe("searching a customer's other numbers", () => {
  /** Which of the two list queries a call is: the plain one, or the join. */
  function listCalls(sb: SupabaseStub) {
    const calls = sb.find("GET", "/rest/v1/contacts");
    return {
      plain: calls.filter(
        (call) =>
          !String(call.url.searchParams.get("select") ?? "").includes(
            "contact_phones",
          ),
      ),
      joined: calls.filter((call) =>
        String(call.url.searchParams.get("select") ?? "").includes(
          "contact_phones",
        ),
      ),
    };
  }

  function searchStubs(options: {
    plain?: Record<string, unknown>[];
    joined?: Record<string, unknown>[];
  }) {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contacts", (call) =>
      String(call.url.searchParams.get("select") ?? "").includes(
        "contact_phones",
      )
        ? options.joined ?? []
        : options.plain ?? [],
    );
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    return sb;
  }

  it("CS-1: asks the phones table when the search looks like a number", async () => {
    const sb = searchStubs({ plain: [] });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts?q=5550177",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);

    const { joined } = listCalls(sb);
    expect(joined).toHaveLength(1);
    // Scoped and soft-delete aware, exactly like the query beside it — a
    // second search path that forgot either would leak or resurrect rows the
    // first one correctly hides.
    expect(joined[0].url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(joined[0].url.searchParams.get("deleted_at")).toBe("is.null");
    expect(joined[0].url.searchParams.get("contact_phones.phone_e164")).toBe(
      "ilike.*5550177*",
    );
  });

  it("CS-2: returns contacts found EITHER way, not just the ones with a second number", async () => {
    // THE ONE THAT MATTERS. The second query is an inner join through the
    // phones table, so alone it would answer with only the handful of
    // customers who have another number — and a search for "555" would stop
    // finding everybody else it used to.
    const sb = searchStubs({
      plain: [contactRow({ id: CONTACT_ID, phone_e164: "+14165550199" })],
      joined: [
        {
          ...contactRow({ id: OTHER_ID, phone_e164: "+14165550111" }),
          contact_phones: [{ id: "p1" }],
        },
      ],
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts?q=555",
      { companyId: COMPANY_ID },
    );
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data.map((row) => row.id).sort()).toEqual(
      [CONTACT_ID, OTHER_ID].sort(),
    );
  });

  it("CS-3: does not return the same customer twice", async () => {
    // A contact whose main number AND second number both match would appear
    // on the list twice, which reads as a duplicate record — the exact thing
    // #246 exists to clean up, manufactured by a search.
    const row = contactRow({ id: CONTACT_ID, phone_e164: "+14165550199" });
    const sb = searchStubs({
      plain: [row],
      joined: [{ ...row, contact_phones: [{ id: "p1" }] }],
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts?q=555",
      { companyId: COMPANY_ID },
    );
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data).toHaveLength(1);
  });

  it("CS-4: never leaks the join into the response", async () => {
    // `contact_phones!inner(id)` is how the filter is expressed, not something
    // a client asked for. Left in, every row on the list would carry a stray
    // array that three clients would then have to learn to ignore.
    const sb = searchStubs({
      plain: [],
      joined: [
        {
          ...contactRow({ id: OTHER_ID }),
          contact_phones: [{ id: "p1" }],
        },
      ],
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts?q=555",
      { companyId: COMPANY_ID },
    );
    expect(await res.text()).not.toContain("contact_phones");
  });

  it("CS-5: a name search costs no extra round trip", async () => {
    // "Dave" cannot be a phone number. Asking the phones table anyway would
    // put a second query on every keystroke of every search in the product.
    const sb = searchStubs({ plain: [contactRow()] });
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(app, env, await auth.token(), "/v1/contacts?q=Dave", {
      companyId: COMPANY_ID,
    });
    expect(listCalls(sb).joined).toHaveLength(0);
  });

  it("CS-6: an empty search asks neither", async () => {
    const sb = searchStubs({ plain: [contactRow()] });
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(app, env, await auth.token(), "/v1/contacts", {
      companyId: COMPANY_ID,
    });
    expect(listCalls(sb).joined).toHaveLength(0);
  });

  it("CS-7: the merged page stays newest-first", async () => {
    // Both queries come back sorted; the union has to be too, or the second
    // page starts from a cursor that does not match what was shown.
    const older = contactRow({
      id: CONTACT_ID,
      created_at: "2026-07-01T09:00:00+00:00",
    });
    const newer = contactRow({
      id: OTHER_ID,
      created_at: "2026-08-01T09:00:00+00:00",
    });
    const sb = searchStubs({
      plain: [older],
      joined: [{ ...newer, contact_phones: [{ id: "p1" }] }],
    });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts?q=555",
      { companyId: COMPANY_ID },
    );
    const body = (await res.json()) as { data: { id: string }[] };
    expect(body.data.map((row) => row.id)).toEqual([OTHER_ID, CONTACT_ID]);
  });
});

/**
 * #291 — narrowing the list to one answer in one of the workspace's fields.
 *
 * CF-4 is the one to read twice. A filter that holds on one of the two list
 * queries and not the other is worse than no filter at all: the list LOOKS
 * filtered, and the rows that leak through are exactly the ones somebody was
 * trying to exclude.
 */
describe("filtering contacts by a custom field", () => {
  function filterStubs(options: { defs?: Record<string, unknown>[] } = {}) {
    const sb = stubWithRole("member");
    sb.on("GET", "/rest/v1/contact_field_defs", () =>
      options.defs ?? [{ key: "system_type" }],
    );
    sb.on("GET", "/rest/v1/contacts", () => []);
    sb.on("GET", "/rest/v1/opt_outs", () => []);
    sb.on("GET", "/rest/v1/conversations", () => []);
    return sb;
  }

  it("CF-1: filters on the value inside the field", async () => {
    const sb = filterStubs();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts?field=system_type&value=Combi",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(200);

    const call = sb.find("GET", "/rest/v1/contacts")[0];
    // `->>` so the comparison is against the TEXT. Comparing the jsonb would
    // make "Combi" and a quoted "Combi" different answers, and the picker
    // only ever sends one of them.
    expect(call.url.searchParams.get("custom_fields->>system_type")).toBe(
      "eq.Combi",
    );
  });

  it("CF-2: refuses a field the workspace has not defined", async () => {
    // Filtered to nothing it would look like a workspace with no matching
    // customers; ignored it would look like a filter that does not work.
    // Both read as a product fault rather than a typo.
    const sb = filterStubs({ defs: [] });
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts?field=nonexistent&value=Combi",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("nonexistent");
    expect(sb.find("GET", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("CF-3: a field with no value is a refusal, not a filter on nothing", async () => {
    // `?field=system_type` alone could mean "has any answer" or "has none".
    // Guessing either would filter somebody's list by a rule they did not
    // choose.
    const sb = filterStubs();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts?field=system_type",
      { companyId: COMPANY_ID },
    );
    expect(res.status).toBe(422);
  });

  it("CF-4: the filter holds on the other-numbers query too", async () => {
    // THE ONE THAT MATTERS. Searching a number while filtered runs a SECOND
    // query; without the same filter it returns customers the filter excludes,
    // into a list that looks filtered.
    const sb = filterStubs();
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts?field=system_type&value=Combi&q=5550177",
      { companyId: COMPANY_ID },
    );

    const joined = sb
      .find("GET", "/rest/v1/contacts")
      .filter((call) =>
        String(call.url.searchParams.get("select") ?? "").includes(
          "contact_phones",
        ),
      );
    expect(joined).toHaveLength(1);
    expect(joined[0].url.searchParams.get("custom_fields->>system_type")).toBe(
      "eq.Combi",
    );
  });

  it("CF-5: an empty value is a real filter — 'we asked, there is no answer'", async () => {
    // Empty is an ANSWER on a custom field (#291), so it has to be selectable.
    // Treated as "no filter" it would silently widen to the whole list.
    const sb = filterStubs();
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts?field=system_type&value=",
      { companyId: COMPANY_ID },
    );
    const call = sb.find("GET", "/rest/v1/contacts")[0];
    expect(call.url.searchParams.get("custom_fields->>system_type")).toBe("eq.");
  });

  it("CF-6: no filter asks nothing about the definitions", async () => {
    // The ordinary list is every list view in the product. A definitions read
    // on each one would be a round trip nobody asked for.
    const sb = filterStubs();
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(app, env, await auth.token(), "/v1/contacts", {
      companyId: COMPANY_ID,
    });
    expect(sb.find("GET", "/rest/v1/contact_field_defs")).toHaveLength(0);
  });

  it("CF-7: the definition lookup is company-scoped", async () => {
    // Otherwise one workspace's field key would validate another's filter, and
    // the filter itself would then run against rows that do not have it.
    const sb = filterStubs();
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/contacts?field=system_type&value=Combi",
      { companyId: COMPANY_ID },
    );
    const call = sb.find("GET", "/rest/v1/contact_field_defs")[0];
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
  });
});
