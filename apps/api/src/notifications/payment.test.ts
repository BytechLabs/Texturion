/**
 * #607 option B — the phone buzzes when the money moves.
 *
 * Option A made an open thread update live, and this is the half for the phone
 * in a pocket. So what these pin is mostly the same shape as every other push
 * pipeline — who is told, who is deliberately not — plus the two things that
 * are specific to money:
 *
 * THE WORDS ARE THE TIMELINE'S WORDS. A crew reading "Refunded" on the lock
 * screen and "went back to them" in the thread is reading two glossaries for
 * one payment.
 *
 * A REFUND MUST NOT ERASE THE PAYMENT IT FOLLOWED. The collapse key carries the
 * outcome for exactly that reason: money arriving and then going back is two
 * facts, not a correction of one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { fcmEnv, fcmService, makeServiceAccount } from "../test/fcm-account";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import {
  notifyPayment,
  paymentAlert,
  PAYMENT_PUSH_KIND,
  type PaymentNotification,
} from "./payment";
import { encodeBase64Url } from "./webpush";

vi.mock("@sentry/cloudflare", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const OWNER = "aaaaaaaa-0000-4000-8000-00000000000a";
/** A second person on the crew, who is equally waiting on the deposit. */
const TECH = "bbbbbbbb-0000-4000-8000-00000000000b";
const CONVERSATION_ID = "11111111-0000-4000-8000-000000000011";
const REQUEST_ID = "33333333-0000-4000-8000-000000000033";
const NUMBER_ID = "99999999-0000-4000-8000-000000000099";
/**
 * A web-push service that is NOT `fcm.googleapis.com`, because these tests run
 * the FCM double on that origin — one route catching both would swallow the
 * native send and report zero. Mozilla's is on the `isAllowedPushEndpoint`
 * list, so the send goes through for the same reason a real one would.
 */
const PUSH_ORIGIN = "https://updates.push.services.mozilla.com";
const ORIGIN = "https://app.loonext.com";

const PAID: PaymentNotification = {
  companyId: COMPANY_ID,
  conversationId: CONVERSATION_ID,
  paymentRequestId: REQUEST_ID,
  outcome: "paid",
  amountCents: 25_000,
  currency: "usd",
  description: "Deposit — 42 Elm, gate code 4417",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** `in.(a,b)` → ["a","b"]; null for a query with no such filter. */
function inFilter(raw: string | null): string[] | null {
  if (raw === null) return null;
  const match = /^in\.\((.*)\)$/.exec(raw);
  if (!match) return null;
  return match[1].split(",").map((value) => value.replace(/^"|"$/g, ""));
}

async function subscriptionRow(userId: string) {
  const uaKeys = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const uaPublic = new Uint8Array(
    (await crypto.subtle.exportKey("raw", uaKeys.publicKey)) as ArrayBuffer,
  );
  return {
    id: `sub-${userId}`,
    user_id: userId,
    endpoint: `${PUSH_ORIGIN}/send/${userId}`,
    p256dh: encodeBase64Url(uaPublic),
    auth: encodeBase64Url(authSecret),
  };
}

/**
 * A workspace of two, both able to see the thread, both with push on and a
 * live subscription. Every test narrows from here, so a silence is always
 * attributable to the one thing that test changed.
 */
async function world(
  overrides: {
    members?: Record<string, unknown>[];
    prefs?: Record<string, unknown>[];
    conversation?: Record<string, unknown>[];
    contact?: Record<string, unknown>[];
    pushIncludeContent?: boolean;
    /** #228: the workspace rung of resolveUiLocale. Null means nobody chose. */
    companyLocale?: string | null;
    devices?: Record<string, unknown>[];
  } = {},
) {
  const sb = supabaseStub(env);
  const subs = [await subscriptionRow(OWNER), await subscriptionRow(TECH)];
  const sends: { payload: string }[] = [];

  sb.on("GET", "/rest/v1/company_members", () =>
    overrides.members ?? [
      { user_id: OWNER, role: "owner" },
      { user_id: TECH, role: "member" },
    ],
  );
  sb.on("GET", "/rest/v1/conversations", (call) => {
    // Two distinct reads hit this table: the phone_number_id access read and
    // the embedded contact read. The select tells them apart.
    const select = call.url.searchParams.get("select") ?? "";
    if (select.includes("contacts")) {
      return (
        overrides.contact ?? [
          { contacts: { name: "Maria Alvarez", phone_e164: "+15550100" } },
        ]
      );
    }
    return overrides.conversation ?? [{ phone_number_id: null }];
  });
  sb.on("GET", "/rest/v1/notification_prefs", () => overrides.prefs ?? []);
  sb.on("GET", "/rest/v1/companies", () => ({
    push_include_content: overrides.pushIncludeContent ?? true,
    locale: overrides.companyLocale ?? null,
  }));
  // Honours the `user_id=in.(…)` filter, which is the whole subject of half
  // these tests: a stub that returned everybody would send two pushes however
  // narrow the audience was, and every silence assertion would be vacuous.
  sb.on("GET", "/rest/v1/push_subscriptions", (call) => {
    const wanted = inFilter(call.url.searchParams.get("user_id"));
    return wanted === null
      ? subs
      : subs.filter((row) => wanted.includes(row.user_id));
  });
  sb.on("GET", "/rest/v1/device_push_tokens", () => overrides.devices ?? []);

  const push: FetchRoute = async (url, request) => {
    if (url.origin !== PUSH_ORIGIN) return undefined;
    sends.push({ payload: await request.clone().text() });
    return new Response(null, { status: 201 });
  };
  return { sb, sends, routes: [sb.route, push] as FetchRoute[] };
}

describe("what the alert says", () => {
  it("uses the thread's own words for each way money moves", () => {
    // ONE VOCABULARY WITH THE TIMELINE (thread.sysPaymentPaid and its
    // neighbours): "paid", "went back to", "pulled back". Two glossaries for
    // one payment is the #273 failure this product is otherwise careful about.
    const paid = paymentAlert(ORIGIN, PAID, "Maria Alvarez");
    const refunded = paymentAlert(
      ORIGIN,
      { ...PAID, outcome: "refunded" },
      "Maria Alvarez",
    );
    const disputed = paymentAlert(
      ORIGIN,
      { ...PAID, outcome: "disputed" },
      "Maria Alvarez",
    );

    expect(paid.title("en")).toBe("Maria Alvarez paid $250");
    expect(refunded.title("en")).toBe("$250 went back to Maria Alvarez");
    expect(disputed.title("en")).toBe("Maria Alvarez's bank pulled back $250");
    expect(paid.url).toBe(`${ORIGIN}/inbox/${CONVERSATION_ID}`);
  });

  it("#228 says the same three things in the reader's French", () => {
    // The same argument, one language over: these are the timeline's French
    // verbs (thread.sysPaymentPaid and its neighbours), so a French crew reads
    // one glossary too. The customer's name and the formatted figure are data
    // and cross untranslated.
    const paid = paymentAlert(ORIGIN, PAID, "Maria Alvarez");
    const refunded = paymentAlert(
      ORIGIN,
      { ...PAID, outcome: "refunded" },
      "Maria Alvarez",
    );
    const disputed = paymentAlert(
      ORIGIN,
      { ...PAID, outcome: "disputed", description: null },
      "Maria Alvarez",
    );

    // The figure arrives from `formatMoney` and is not this table's to
    // reformat: it is the same string the French billing screens already show.
    expect(paid.title("fr-CA")).toBe("Maria Alvarez a payé $250");
    expect(refunded.title("fr-CA")).toBe("$250 a été remboursé à Maria Alvarez");
    expect(disputed.title("fr-CA")).toBe(
      "La banque de Maria Alvarez a repris $250",
    );
    // And our own line, which is what a dispute with no description says.
    expect(disputed.body("fr-CA")).toBe(
      "Les détails sont dans votre tableau de bord Stripe.",
    );
  });

  it("#228 passes the member's own words through in whatever they typed", () => {
    // The description is somebody else's sentence. Translating it is not on
    // offer, and only the fallback beneath it is ours.
    const alert = paymentAlert(ORIGIN, PAID, "Maria Alvarez");

    expect(alert.body("fr-CA")).toBe("Deposit — 42 Elm, gate code 4417");
    expect(alert.withheldBody("fr-CA")).toBe("Le paiement est passé.");
  });

  it("still reads correctly when the event carried no figure", () => {
    // An alert with no number in it is worth sending; one that says
    // "Maria Alvarez paid null" is not.
    const noAmount = { ...PAID, amountCents: null };
    const unknownCurrency = { ...PAID, currency: "gbp" };

    expect(paymentAlert(ORIGIN, noAmount, "Maria Alvarez").title("en")).toBe(
      "Maria Alvarez paid",
    );
    // A currency we do not bill in would format as a "$" that lies about which
    // dollars they are. The generic sentence is the honest answer.
    expect(
      paymentAlert(ORIGIN, unknownCurrency, "Maria Alvarez").title("en"),
    ).toBe("Maria Alvarez paid");
    expect(
      paymentAlert(ORIGIN, { ...noAmount, outcome: "refunded" }, "Maria Alvarez")
        .title("en"),
    ).toBe("The money went back to Maria Alvarez");
    expect(
      paymentAlert(ORIGIN, { ...noAmount, outcome: "disputed" }, "Maria Alvarez")
        .title("en"),
    ).toBe("Maria Alvarez's bank pulled this payment back");
    // #228: the figureless arm is a whole sentence in each language rather than
    // a substitution, so French has its own — « L'argent », not « Le montant ».
    expect(
      paymentAlert(ORIGIN, { ...noAmount, outcome: "refunded" }, "Maria Alvarez")
        .title("fr-CA"),
    ).toBe("L'argent a été remboursé à Maria Alvarez");
  });

  it("withholds what the money was for, never who it was from (#430)", () => {
    // The description is a member's own words and per the personal-data
    // inventory routinely carries an address. The contact's name is most of the
    // triage value and stays.
    const alert = paymentAlert(ORIGIN, PAID, "Maria Alvarez");

    expect(alert.body("en")).toBe("Deposit — 42 Elm, gate code 4417");
    expect(alert.withheldBody("en")).toBe("The payment cleared.");
    expect(alert.title("en")).toContain("Maria Alvarez");
  });

  it("says something of its own when the ask had no description", () => {
    const paid = paymentAlert(ORIGIN, { ...PAID, description: "  " }, "Maria");
    const disputed = paymentAlert(
      ORIGIN,
      { ...PAID, outcome: "disputed", description: null },
      "Maria",
    );

    expect(paid.body("en")).toBe("The payment cleared.");
    // A dispute has a next step, and it is not in this app.
    expect(disputed.body("en")).toBe("Your Stripe dashboard has the details.");
  });

  it("keys the collapse per outcome, so a refund cannot erase the payment", () => {
    const paid = paymentAlert(ORIGIN, PAID, "Maria Alvarez");
    const refunded = paymentAlert(
      ORIGIN,
      { ...PAID, outcome: "refunded" },
      "Maria Alvarez",
    );

    expect(paid.collapseKey).toBe(`payment:paid:${REQUEST_ID}`);
    expect(refunded.collapseKey).not.toBe(paid.collapseKey);
  });
});

describe("who hears about it", () => {
  it("tells everyone who can see the thread, not only the assignee", async () => {
    // Money landing is not a message anybody has to answer, and the person
    // waiting on it is as often the owner who sent the ask as the tech on the
    // job.
    const w = await world();
    stubFetch(...w.routes);

    await notifyPayment(env, PAID, getDb(env));

    expect(w.sends).toHaveLength(2);
  });

  it("says nothing to somebody who turned push off", async () => {
    const w = await world({ prefs: [{ user_id: TECH, push_enabled: false }] });
    stubFetch(...w.routes);

    await notifyPayment(env, PAID, getDb(env));

    expect(w.sends).toHaveLength(1);
  });

  it("says nothing to somebody denied the number (#106)", async () => {
    // The alert names a customer and deep-links into their thread. A member
    // who cannot open it must not be told who paid on it.
    const w = await world({ conversation: [{ phone_number_id: NUMBER_ID }] });
    w.sb.on("POST", "/rest/v1/rpc/number_member_levels", () => [
      { user_id: OWNER, role: "owner", level: "full" },
      { user_id: TECH, role: "member", level: "none" },
    ]);
    stubFetch(...w.routes);

    await notifyPayment(env, PAID, getDb(env));

    expect(w.sends).toHaveLength(1);
  });

  it("stays silent when the thread is gone rather than failing the webhook", async () => {
    // Deleted between the payment clearing and this running. The money is
    // recorded either way, and there is nothing left to link to.
    const w = await world({ conversation: [] });
    stubFetch(...w.routes);

    await expect(notifyPayment(env, PAID, getDb(env))).resolves.toBeUndefined();
    expect(w.sends).toHaveLength(0);
  });

  it("stays silent when the customer row is gone", async () => {
    // Every sentence this alert can say names them.
    const w = await world({ contact: [] });
    stubFetch(...w.routes);

    await notifyPayment(env, PAID, getDb(env));

    expect(w.sends).toHaveLength(0);
  });
});

describe("what reaches the phones", () => {
  it("sends the discriminator both phones route on", async () => {
    // Without it the alert posts to Messages — indistinguishable from a phone
    // that has never heard of payments, and silenced by the switch a crew flips
    // when the inbox gets busy.
    const account = await makeServiceAccount();
    const service = fcmService();
    const w = await world({
      members: [{ user_id: OWNER, role: "owner" }],
      devices: [
        { id: "dev-1", user_id: OWNER, platform: "android", token: "tok-a" },
      ],
    });
    stubFetch(...w.routes, ...service.routes);

    await notifyPayment(fcmEnv(account), PAID, getDb(env));

    const data = service.sends[0].message.data as Record<string, string>;
    expect(data.kind).toBe(PAYMENT_PUSH_KIND);
    expect(data.kind).toBe("payment");
    expect(data.tag).toBe(`payment:paid:${REQUEST_ID}`);
    expect(data.title).toBe("Maria Alvarez paid $250");
  });

  it("#228 reaches a French workspace's phone in French", async () => {
    // End to end rather than at `paymentAlert`: what this pins is that the
    // locale deliverPush resolves is the one the payload is composed with. A
    // site that took the argument and returned English would pass every
    // assertion above and still put an English lock screen in front of a
    // French crew, which is the whole defect #228 exists to close.
    const account = await makeServiceAccount();
    const service = fcmService();
    const w = await world({
      members: [{ user_id: OWNER, role: "owner" }],
      companyLocale: "fr-CA",
      devices: [
        { id: "dev-1", user_id: OWNER, platform: "android", token: "tok-a" },
      ],
    });
    stubFetch(...w.routes, ...service.routes);

    await notifyPayment(fcmEnv(account), PAID, getDb(env));

    const data = service.sends[0].message.data as Record<string, string>;
    expect(data.title).toBe("Maria Alvarez a payé $250");
    // The routing discriminator and the collapse tag are not language: two
    // translations of one alert must still replace each other on a phone.
    expect(data.kind).toBe(PAYMENT_PUSH_KIND);
    expect(data.tag).toBe(`payment:paid:${REQUEST_ID}`);
  });

  it("holds back the description when the workspace has content off", async () => {
    const account = await makeServiceAccount();
    const service = fcmService();
    const w = await world({
      members: [{ user_id: OWNER, role: "owner" }],
      pushIncludeContent: false,
      devices: [
        { id: "dev-1", user_id: OWNER, platform: "android", token: "tok-a" },
      ],
    });
    stubFetch(...w.routes, ...service.routes);

    await notifyPayment(fcmEnv(account), PAID, getDb(env));

    const data = service.sends[0].message.data as Record<string, string>;
    expect(data.body).toBe("The payment cleared.");
    // The instruction survives: they still know who paid and where to look.
    expect(data.title).toBe("Maria Alvarez paid $250");
  });
});
