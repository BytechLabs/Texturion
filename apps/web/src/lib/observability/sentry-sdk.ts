/**
 * The only parts of @sentry/browser this app calls, and the only door to it.
 *
 * `import("@sentry/browser")` keeps every export of the package, Replay,
 * rrweb, feedback and tracing included: a 142 KB brotli chunk for an app that
 * calls two functions (#640). Importing this module instead lets the bundler
 * drop the rest.
 */
export { captureException, init } from "@sentry/browser";
