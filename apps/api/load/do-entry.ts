/**
 * The Worker entrypoint the workerd load harness runs against.
 *
 * Exports `CallSessionDO` directly rather than reusing `src/index.ts`: the app
 * entrypoint pulls in every route, every binding and env validation, none of
 * which this measures and any of which could fail to boot in a test isolate.
 *
 * The fetch handler exists because a Worker needs one. Nothing calls it.
 */
export { CallSessionDO } from "../src/calls/session-do";

export default {
  fetch(): Response {
    return new Response("load harness", { status: 200 });
  },
};
