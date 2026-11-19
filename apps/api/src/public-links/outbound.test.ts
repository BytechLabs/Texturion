import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { messageRow, rpcMatch, stubRoute } from "../test/messaging-support";
import { completeEnv, stubFetch } from "../test/support";
import { concealOutboundLinks, remintOutboundLinks } from "./outbound";
import { hashToken } from "./tokens";

const env = completeEnv();
const ORIGIN = env.APP_ORIGIN;
const TOKEN = "q".repeat(43);
const PHOTO_TOKEN = "p".repeat(43);
const QUOTE_URL = `${ORIGIN}/q/${TOKEN}`;
const PHOTO_URL = `${ORIGIN}/photos/${PHOTO_TOKEN}`;
const CONCEALED_QUOTE = `${ORIGIN}/q/[private link]`;
const CONCEALED_PHOTO = `${ORIGIN}/photos/[private link]`;
const ORIGINAL_QUOTE_ID = "11111111-1111-4111-8111-111111111111";
const ORIGINAL_PHOTO_ID = "22222222-2222-4222-8222-222222222222";

afterEach(() => vi.unstubAllGlobals());

describe(concealOutboundLinks, () => {
  it("redacts managed links and preserves normal URLs", async () => {
    const other = `https://contractor.test/q/${TOKEN}`;
    const result = await concealOutboundLinks(ORIGIN, `Quote: ${QUOTE_URL}\nPhotos: ${PHOTO_URL}\n${other}`);
    expect(result.body).toBe(`Quote: ${CONCEALED_QUOTE}\nPhotos: ${CONCEALED_PHOTO}\n${other}`);
    expect(result.links).toEqual([
      { purpose: "quote_view", token_hash: await hashToken(TOKEN) },
      { purpose: "photo_set", token_hash: await hashToken(PHOTO_TOKEN) },
    ]);
  });
});

describe(remintOutboundLinks, () => {
  it("mints fresh credentials with the original company and typed link references", async () => {
    const mint = stubRoute(rpcMatch(env, "api_remint_outbound_link"), () => true);
    stubFetch(mint.route);
    const row = messageRow({
      body: `${CONCEALED_QUOTE}\n${CONCEALED_PHOTO}`,
      public_link_ids: [ORIGINAL_QUOTE_ID, ORIGINAL_PHOTO_ID],
    });

    const body = await remintOutboundLinks(getDb(env), ORIGIN, row);
    const [quote, photos] = body.split("\n").map((url) => new URL(url).pathname.split("/").at(-1)!);
    expect(quote).toHaveLength(43);
    expect(photos).toHaveLength(43);
    expect(quote).not.toBe(TOKEN);
    expect(photos).not.toBe(PHOTO_TOKEN);
    expect(mint.calls.map(({ body: args }) => args)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        p_company_id: row.company_id, p_link_id: ORIGINAL_QUOTE_ID,
        p_purpose: "quote_view", p_token_hash: await hashToken(quote),
      }),
      expect.objectContaining({
        p_company_id: row.company_id, p_link_id: ORIGINAL_PHOTO_ID,
        p_purpose: "photo_set", p_token_hash: await hashToken(photos),
      }),
    ]));
  });

  it("fails closed when the original link can no longer be used", async () => {
    const mint = stubRoute(rpcMatch(env, "api_remint_outbound_link"), () => false);
    stubFetch(mint.route);
    const row = messageRow({ body: CONCEALED_QUOTE, public_link_ids: [ORIGINAL_QUOTE_ID] });

    await expect(remintOutboundLinks(getDb(env), ORIGIN, row)).rejects.toMatchObject({ code: "conflict" });
  });
});
