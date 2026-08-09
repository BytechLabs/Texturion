/**
 * #294 — the job photo page a customer opens with no account.
 *
 * This is the first consumer of D75's public-link primitive, and the person on the
 * other end of it is not our user. So most of what is asserted here is what the page
 * must NOT contain: the exclusions are the feature.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
  type SupabaseStub,
} from "../test/routes-harness";
import { completeEnv, createTestAuth, jwksRoute, stubFetch, type TestAuth } from "../test/support";
import { Hono } from "hono";

import type { AppEnv } from "../context";
import { jobPhotoShareRoutes, publicJobPhotoRoutes } from "./job-photos";

const env = completeEnv();
const COMPANY_ID = "5c5c5c5c-0000-4000-8000-00000000005c";
const MEMBER_ID = "6d6d6d6d-0000-4000-8000-00000000006d";
const TASK_ID = "7e7e7e7e-0000-4000-8000-00000000007e";
const NOTE_ID = "8f8f8f8f-0000-4000-8000-00000000008f";
const TOKEN = "a".repeat(43);

let auth: TestAuth;
const app = buildTestApp(jobPhotoShareRoutes);

/**
 * The public app mounted the way production mounts it: at the ROOT, with no auth
 * middleware anywhere near it.
 *
 * Not `buildTestApp`, which puts everything under /v1 behind `jwtAuth` — a public
 * route tested through that would be testing a route no customer can reach.
 */
const publicApp = new Hono<AppEnv>();
publicApp.route("/", publicJobPhotoRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

function crew(options: { role?: string } = {}): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, options.role ?? "admin"),
  );
  sb.on("GET", "/rest/v1/tasks", () => [{ id: TASK_ID }]);
  sb.on("POST", "/rest/v1/rpc/api_revoke_public_links_for_subject", () => 0);
  sb.on("POST", "/rest/v1/rpc/api_mint_public_link", () => "link-1");
  sb.on("POST", "/rest/v1/audit_log", () => []);
  return sb;
}

/**
 * The public side. `resolved` is what the link primitive says about the token;
 * everything else is what the page would then be built from.
 */
function visitor(options: {
  resolved?: Record<string, unknown>;
  notes?: Record<string, unknown>[];
  files?: Record<string, unknown>[];
} = {}): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/api_resolve_public_link", () =>
    options.resolved ?? {
      ok: true,
      outcome: "ok",
      link_id: "link-1",
      company_id: COMPANY_ID,
      subject_type: "task_photos",
      subject_id: TASK_ID,
    },
  );
  sb.on("GET", "/rest/v1/companies", () => [{ name: "Acme Plumbing" }]);
  sb.on("GET", "/rest/v1/messages", () =>
    options.notes ?? [
      { id: NOTE_ID, work_phase: "after", created_at: "2026-08-08T15:00:00Z" },
    ],
  );
  sb.on("GET", "/rest/v1/attachments", () =>
    options.files ?? [
      {
        id: "att-1",
        owner_id: NOTE_ID,
        content_type: "image/jpeg",
        storage_path: "c/note/att-1.jpg",
        created_at: "2026-08-08T15:00:05Z",
      },
    ],
  );
  sb.on(
    "POST",
    /\/storage\/v1\/object\/sign\//,
    () => ({ signedURL: "/object/sign/attachments/x?token=zzz" }),
  );
  return sb;
}

describe("minting a link (#294)", () => {
  it("gives back a url and an expiry, and records that it went out", async () => {
    const sb = crew();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tasks/${TASK_ID}/photos/share`,
      { method: "POST", companyId: COMPANY_ID },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; expires_at: string };
    expect(body.url).toContain("/photos/");
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());

    // The token is minted for ONE object and ONE purpose (D75).
    const mint = sb.find("POST", "/rest/v1/rpc/api_mint_public_link")[0].body as Record<
      string,
      unknown
    >;
    expect(mint).toMatchObject({
      p_purpose: "photo_set",
      p_subject_type: "task_photos",
      p_subject_id: TASK_ID,
    });
    // An expiry is never null. A link nobody remembers is the failure D75 exists
    // to prevent, and it cannot be represented.
    expect(mint.p_expires_at).toBeTruthy();
    // #294: the moment a record of the inside of somebody's home became reachable
    // without a login.
    expect(
      (sb.find("POST", "/rest/v1/audit_log")[0].body as { action: string }).action,
    ).toBe("job_photos.shared");
  });

  it("replaces the previous link rather than leaving two alive", async () => {
    // Two live links to the same photos is two things to remember to revoke.
    const sb = crew();
    stubFetch(jwksRoute(auth), sb.route);

    await apiRequest(app, env, await auth.token(), `/v1/tasks/${TASK_ID}/photos/share`, {
      method: "POST",
      companyId: COMPANY_ID,
    });

    expect(
      sb.find("POST", "/rest/v1/rpc/api_revoke_public_links_for_subject"),
    ).toHaveLength(1);
  });

  it("refuses a job that is not this workspace's, before minting anything", async () => {
    // A token must never outlive the thing it points at, so the check comes first.
    const sb = crew();
    sb.on("GET", "/rest/v1/tasks", () => []);
    const fresh = supabaseStub(env);
    fresh.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "admin"),
    );
    fresh.on("GET", "/rest/v1/tasks", () => []);
    fresh.on("POST", "/rest/v1/rpc/api_mint_public_link", () => "link-1");
    stubFetch(jwksRoute(auth), fresh.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tasks/${TASK_ID}/photos/share`,
      { method: "POST", companyId: COMPANY_ID },
    );

    expect(res.status).toBe(404);
    expect(fresh.find("POST", "/rest/v1/rpc/api_mint_public_link")).toHaveLength(0);
  });
});

describe("withdrawing a link (#571 / #545)", () => {
  it("refuses a job that is not this workspace's, and revokes nothing", async () => {
    // The gap this closes: the DELETE took a task id from the path and revoked
    // that task's live links with no ownership check anywhere — the POST above
    // has one, and this had no counterpart. The reachable actor was a `read_only`
    // or `member` of the AFFECTED workspace (the two roles the route's
    // `history.read` gate exists to exclude), acting from a workspace they own,
    // because the app shows them task ids and workspaces are self-serve.
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "admin"),
    );
    sb.on("GET", "/rest/v1/tasks", () => []);
    sb.on("POST", "/rest/v1/rpc/api_revoke_public_links_for_subject", () => 2);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tasks/${TASK_ID}/photos/share`,
      { method: "DELETE", companyId: COMPANY_ID },
    );

    // 404, not `{revoked: 0}`. A 200 saying nothing happened is indistinguishable
    // from a link that had already expired, and it would confirm the id exists.
    expect(res.status).toBe(404);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_revoke_public_links_for_subject"),
    ).toHaveLength(0);
  });

  it("passes the workspace to the revoke, so the scope is enforced in the RPC too", async () => {
    // Belt and braces, deliberately. The handler check above makes the ANSWER
    // honest; the company id on the RPC call is what makes the scope
    // unbypassable by a future caller who forgets the lookup.
    // No second `sb.on` for the revoke RPC: this stub is FIRST-match-wins and
    // `crew()` already answers it with 0, so a re-registration here would simply
    // never run. The count is not what this test is about — the argument is.
    const sb = crew();
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/tasks/${TASK_ID}/photos/share`,
      { method: "DELETE", companyId: COMPANY_ID },
    );

    expect(res.status).toBe(200);
    const [call] = sb.find("POST", "/rest/v1/rpc/api_revoke_public_links_for_subject");
    expect(call.body).toMatchObject({
      p_company_id: COMPANY_ID,
      p_subject_type: "task_photos",
      p_subject_id: TASK_ID,
    });
  });
});

describe("what the customer's page contains (#294)", () => {
  it("serves the photos under the business's name", async () => {
    // The page appears under the BUSINESS's name, not ours. For many homeowners it
    // is the only thing they will ever see of this product.
    const sb = visitor();
    stubFetch(sb.route);

    const res = await publicApp.request(`/photos/${TOKEN}`, {}, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      business_name: string;
      photos: { work_phase: string | null; url: string }[];
    };
    expect(body.business_name).toBe("Acme Plumbing");
    expect(body.photos).toHaveLength(1);
    expect(body.photos[0].work_phase).toBe("after");
    expect(body.photos[0].url).toContain("token=");
  });

  it("carries the no-index headers on the way out", async () => {
    // A snippet is where the customer's name would appear, so noarchive and
    // nosnippet matter as much as noindex.
    const sb = visitor();
    stubFetch(sb.route);

    const res = await publicApp.request(`/photos/${TOKEN}`, {}, env);

    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(res.headers.get("X-Robots-Tag")).toContain("noarchive");
    expect(res.headers.get("X-Robots-Tag")).toContain("nosnippet");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("shows nothing but images — not the quote, not the invoice", async () => {
    // THE EXCLUSION THAT MATTERS MOST. A supplier invoice filed against the same
    // job reaching the customer is a leak, and nothing about "here are the photos"
    // suggests it would happen.
    const sb = visitor({
      files: [
        {
          id: "att-pdf",
          owner_id: NOTE_ID,
          content_type: "application/pdf",
          storage_path: "c/note/quote.pdf",
          created_at: "2026-08-08T15:00:00Z",
        },
        {
          id: "att-img",
          owner_id: NOTE_ID,
          content_type: "image/png",
          storage_path: "c/note/site.png",
          created_at: "2026-08-08T15:00:01Z",
        },
      ],
    });
    stubFetch(sb.route);

    const res = await publicApp.request(`/photos/${TOKEN}`, {}, env);

    const body = (await res.json()) as { photos: { id: string }[] };
    expect(body.photos.map((photo) => photo.id)).toEqual(["att-img"]);
  });

  it("never sends the note's words, the customer, or the crew member", async () => {
    // A note is where a tech writes something internal by construction. The photos
    // are the record being shared; the commentary around them is not. And the
    // customer already knows their own address — putting it on a URL that lives in
    // an SMS log adds risk and nothing else.
    const sb = visitor({
      notes: [
        {
          id: NOTE_ID,
          work_phase: "before",
          created_at: "2026-08-08T09:00:00Z",
          body: "customer seems confused about what she already paid for",
          sent_by_user_id: "u-priya",
        },
      ],
    });
    stubFetch(sb.route);

    const res = await publicApp.request(`/photos/${TOKEN}`, {}, env);

    const text = await res.text();
    expect(text).not.toContain("already paid for");
    expect(text).not.toContain("u-priya");
    // And the select never asked for the body in the first place.
    const asked = sb.find("GET", "/rest/v1/messages")[0].url.searchParams.get("select");
    expect(asked).not.toContain("body");
    expect(asked).not.toContain("sent_by_user_id");
  });

  it("puts them in the order the work happened", async () => {
    const sb = visitor({
      notes: [
        { id: "n-after", work_phase: "after", created_at: "2026-08-08T16:00:00Z" },
        { id: "n-before", work_phase: "before", created_at: "2026-08-08T09:00:00Z" },
      ],
      files: [
        {
          id: "att-after",
          owner_id: "n-after",
          content_type: "image/jpeg",
          storage_path: "c/a.jpg",
          created_at: "2026-08-08T16:00:00Z",
        },
        {
          id: "att-before",
          owner_id: "n-before",
          content_type: "image/jpeg",
          storage_path: "c/b.jpg",
          created_at: "2026-08-08T09:00:00Z",
        },
      ],
    });
    stubFetch(sb.route);

    const res = await publicApp.request(`/photos/${TOKEN}`, {}, env);

    const body = (await res.json()) as { photos: { id: string }[] };
    expect(body.photos.map((photo) => photo.id)).toEqual(["att-before", "att-after"]);
  });
});

describe("a link that does not work (#294)", () => {
  const failures = [
    ["expired", { ok: false, outcome: "expired" }],
    ["revoked", { ok: false, outcome: "revoked" }],
    ["spent", { ok: false, outcome: "used_up" }],
    ["the wrong purpose", { ok: false, outcome: "wrong_purpose" }],
    ["never existed", { ok: false, outcome: "not_found" }],
  ] as const;

  for (const [name, resolved] of failures) {
    it(`says the same thing for a link that ${name}`, async () => {
      // A holder who can tell these apart has been handed an oracle (D75).
      const sb = visitor({ resolved: resolved as Record<string, unknown> });
      stubFetch(sb.route);

      const res = await publicApp.request(`/photos/${TOKEN}`, {}, env);

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
      // And nothing was read about a workspace it could not verify access to.
      expect(sb.find("GET", "/rest/v1/companies")).toHaveLength(0);
      expect(sb.find("GET", "/rest/v1/attachments")).toHaveLength(0);
    });
  }

  it("never asks the database about a token of the wrong shape", async () => {
    // Hashing arbitrary input to run a query is free work an attacker controls
    // the volume of.
    const sb = visitor();
    stubFetch(sb.route);

    const res = await publicApp.request("/photos/short", {}, env);

    expect(res.status).toBe(404);
    expect(sb.find("POST", "/rest/v1/rpc/api_resolve_public_link")).toHaveLength(0);
  });
});
