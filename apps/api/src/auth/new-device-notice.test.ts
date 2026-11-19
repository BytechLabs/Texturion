import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";

import type { AppEnv } from "../context";
import { getDb } from "../db";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { announceNewDevice } from "./new-device-notice";

const userId = "10000000-aaaa-4000-8000-000000000001";
const sessionId = "10000000-aaaa-4000-8000-000000000002";
const env = completeEnv();

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  ["fr-CA", "en", "fr-CA", "Nouvelle connexion à votre compte"],
  ["en", "fr-CA", "en", "New sign-in to your account"],
  [null, "fr-CA", "fr-CA", "Nouvelle connexion à votre compte"],
])("chooses the account language for profile %s and signup language %s", async (
  profileLocale, signupLocale, language, subject,
) => {
  const sb = supabaseStub(env);
  sb.on("GET", `/auth/v1/admin/users/${userId}`, () => ({
    id: userId,
    email: "member@example.test",
    user_metadata: { locale: signupLocale },
  }));
  sb.on("GET", "/rest/v1/profiles", () => [{ locale: profileLocale }]);
  const emails: unknown[] = [];
  stubFetch(sb.route, async (url, request) => {
    if (url.href !== "https://api.resend.com/emails") return undefined;
    emails.push(await request.json());
    return Response.json({ id: "email_1" });
  });

  const app = new Hono<AppEnv>();
  app.get("/", (c) => {
    announceNewDevice(c, env, getDb(env), userId, sessionId);
    return c.text("ok");
  });
  const pending: Promise<unknown>[] = [];
  await app.request("/", { headers: { "X-Client": "android" } }, env, {
    props: {},
    waitUntil: (work) => { pending.push(work); },
    passThroughOnException: () => {},
  });
  await Promise.all(pending);

  expect(emails).toHaveLength(1);
  expect(emails[0]).toMatchObject({
    to: ["member@example.test"],
    subject,
    html: expect.stringContaining(`<html lang="${language}">`),
    text: expect.stringContaining(language === "fr-CA" ? "un téléphone Android" : "an Android phone"),
  });
});
