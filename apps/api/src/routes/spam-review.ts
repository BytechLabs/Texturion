/**
 * #342 — GET /v1/spam-review: the spam marks that do not look like spam.
 *
 * D7 rule 3 appends silently to a closed spam thread, #49 freezes its
 * `last_message_at` so it cannot jump a list, and the notification pipeline
 * skips it. For a robotexter that is the whole value of the feature and none
 * of it changes.
 *
 * The failure is the wrong mark — a mis-tap, a first message that looked like
 * spam, a recycled number, a difficult customer somebody did not want to deal
 * with. The customer keeps texting, nothing fires, no count moves, and the
 * thread is pinned at the moment it was marked, sinking in the one view anyone
 * might open. The business believes that person stopped texting. The person
 * believes they are being ignored by a business they are trying to pay.
 *
 * THIS IS A SIGNAL, NOT A NOTIFICATION. It never pushes, never rings, never
 * touches a badge. It is a strip you find when you look at your home screen,
 * and on the overwhelming majority of days it is empty — because the model
 * returns spam threads whose activity does NOT look like spam, rather than all
 * of them. A review list full of robotexters is the noise rule 3 removed,
 * put back.
 */
import { Hono } from "hono";

import { requireCapability } from "../auth/company";
import { resolveNumberAccess } from "../auth/number-access";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { unwrap } from "./core/http";

export const spamReviewRoutes = new Hono<AppEnv>();

/**
 * A bounded strip, like every other card list on the home screen (D23). A
 * workspace with more than this many mis-marked threads has a training problem
 * rather than a paging problem.
 */
const REVIEW_LIMIT = 20;

spamReviewRoutes.get("/spam-review", requireCapability("conversations.read"), async (c) => {
  const db = getDb(getEnv(c.env));

  // #106: a restricted member must not learn that a hidden number's
  // conversations exist — including by way of a review strip.
  const access = await resolveNumberAccess(db, {
    companyId: c.get("companyId"),
    userId: c.get("userId"),
    role: c.get("role"),
  });

  const rows = unwrap<unknown[]>(
    await db.rpc("api_spam_review", {
      p_company_id: c.get("companyId"),
      p_limit: REVIEW_LIMIT,
      p_hidden_number_ids: access.hiddenNumberIds,
    }),
    "spam review",
  );

  return c.json({ data: rows ?? [] });
});
