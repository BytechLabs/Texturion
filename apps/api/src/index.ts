import { INTERNAL_ERROR_CODE, INTERNAL_ERROR_STATUS } from "@jobtext/shared";
import { Hono } from "hono";

import { getEnv, type Bindings } from "./env";
import { errorResponse } from "./errors";

export const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => {
  // A misconfigured Worker must fail loudly, not serve a healthy-looking 200.
  getEnv(c.env);
  return c.json({ ok: true });
});

app.notFound((c) => errorResponse(c, "not_found", "No such route."));

app.onError((error, c) => {
  // Log the real error server-side (IDs only, never message bodies — SPEC §10);
  // clients get the stable envelope shape without internals. SPEC §7 defines
  // no 500 code, so the shared INTERNAL_ERROR_CODE fallback is used here.
  console.error("unhandled error:", error);
  return c.json(
    { error: { code: INTERNAL_ERROR_CODE, message: "Something went wrong." } },
    INTERNAL_ERROR_STATUS,
  );
});

export default {
  fetch: app.fetch,

  /**
   * Cron entry point (SPEC §11). The scheduled jobs land in later build steps;
   * until then this handler's real job is to validate the environment on every
   * trigger — so a misconfigured Worker fails loudly on its first cron — and to
   * record which schedule fired.
   */
  async scheduled(controller, env) {
    getEnv(env);
    console.log(
      `cron fired: "${controller.cron}" at ${new Date(controller.scheduledTime).toISOString()}`,
    );
  },
} satisfies ExportedHandler<Bindings>;
