/**
 * The Worker entrypoint the workerd load harness runs against.
 *
 * Exports the RAW `CallSessionDO` rather than reusing `src/index.ts`, for two
 * reasons. The app entrypoint pulls in every route, every binding and env
 * validation, none of which this measures and any of which could fail to boot
 * in a test isolate. And the production export is wrapped by
 * `Sentry.instrumentDurableObjectWithSentry`, which adds a layer this is not
 * trying to measure — said here rather than left as a difference somebody
 * discovers later when the numbers do not reproduce.
 *
 * The fetch handler exists because a Worker needs one. Nothing calls it.
 */
export { CallSessionDO } from "../src/calls/session-do";

export default {
  fetch(): Response {
    return new Response("load harness", { status: 200 });
  },
};
