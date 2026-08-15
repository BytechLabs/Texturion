import type { Metadata } from "next";

import {
  API_KEY_REQUESTS_PER_MINUTE,
  API_KEY_SCOPES,
  PUBLIC_API_BASE,
  PUBLIC_API_VERSION,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_MAX_ATTEMPTS,
} from "@loonext/shared";

import { FrCard, FrSection } from "@/components/marketing/fr";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/developers";

export const metadata: Metadata = buildMetadata({
  title: "Developers",
  description:
    "The Loonext public API: scoped keys, a small REST surface, and signed outbound webhooks — with a stated versioning and deprecation policy.",
  path: PATH,
});

/**
 * #243 — the published API reference.
 *
 * The issue's third acceptance line asks for "a published, versioned API
 * reference with a stated deprecation policy". A document in the repository is
 * not published: an integrator hired for an afternoon does not clone anything,
 * and the promise is worthless if the person relying on it cannot find it.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PAGE IS AND IS NOT
 *
 * It is the CONTRACT — the surface, the auth model, and what we guarantee about
 * both. It is not a tutorial and it is not generated docs. The whole point of
 * #243's "ten calls an integrator actually needs" is that the surface is small
 * enough to be read on one page, and a page that grows past that is a signal
 * the surface did.
 *
 * ---------------------------------------------------------------------------
 * WHY THE NUMBERS ARE IMPORTED
 *
 * The scope list, the event list, the retry count and the rate limit all come
 * from `@loonext/shared`, which is what the server enforces. A marketing page
 * with its own copy of an API's limits is a page that is wrong the first time
 * one changes — and being wrong here is worse than silence, because somebody
 * builds against it.
 *
 * *Applying: the Safety principle (a conventional reference layout, because a
 * developer scanning for a route is not here to be delighted), and Chunking —
 * auth, surface, events, promise, each answering one question.*
 */

/** The routes, exactly as `apps/api/src/routes/public-api.ts` mounts them. */
const ROUTES: { method: string; path: string; scope: string; what: string }[] = [
  {
    method: "GET",
    path: "/me",
    scope: "—",
    what: "Which workspace this key reaches, and what it may do. Start here.",
  },
  {
    method: "GET",
    path: "/contacts",
    scope: "contacts:read",
    what: "The customer list, newest first.",
  },
  {
    method: "POST",
    path: "/contacts",
    scope: "contacts:write",
    what: "Add a customer. Re-sending one you already sent updates it rather than duplicating.",
  },
  {
    method: "GET",
    path: "/conversations",
    scope: "conversations:read",
    what: "The thread list.",
  },
  {
    method: "GET",
    path: "/conversations/:id/messages",
    scope: "messages:read",
    what: "One thread's messages.",
  },
  {
    method: "POST",
    path: "/messages",
    scope: "messages:send",
    what: "Send a text into an existing thread. Requires an Idempotency-Key header.",
  },
  {
    method: "GET",
    path: "/tasks",
    scope: "tasks:read",
    what: "The job list.",
  },
  {
    method: "POST",
    path: "/tasks",
    scope: "tasks:write",
    what: "Turn a message into a job.",
  },
  {
    method: "POST",
    path: "/webhooks",
    scope: "webhooks:manage",
    what: "Subscribe to events. This is the REST-hook endpoint Zapier and Make use.",
  },
  {
    method: "DELETE",
    path: "/webhooks/:id",
    scope: "webhooks:manage",
    what: "Unsubscribe. A key can only remove a subscription it created.",
  },
];

/** What v1 guarantees, and what it deliberately does not. */
const PROMISES: string[] = [
  "A field we publish will not be removed or change meaning. New fields may be added, so parse permissively — an unknown field is not an error.",
  "A route will not be removed, and its method and path will not change.",
  "An event name will not be removed or repurposed. New ones may be added; ignore names you do not know.",
  "The webhook signature scheme will not change under v1=. A v2= may appear beside it, and a receiver checking v1= keeps working.",
  "Error codes and their HTTP statuses will not change.",
];

const NOT_PROMISED: string[] = [
  "Ordering beyond what a route documents. Lists are newest-first; nothing else about order is stable.",
  `Rate limits. Today a key is allowed ${API_KEY_REQUESTS_PER_MINUTE} requests a minute. Handle 429.`,
  "Timing. Webhook delivery is best-effort with retries; nothing is synchronous with the event that caused it.",
  "Our first-party API. The app's own endpoints are not this API and change whenever the product does.",
];

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="fr-mono-data">{children}</span>;
}

export default function DevelopersPage() {
  return (
    <>
      <FrSection ground="white">
        <div className="max-w-3xl">
          <h1 className="fr-h1 text-[color:var(--fr-ink)]">
            Connect Loonext to whatever else you run.
          </h1>
          <p className="fr-lede mt-6 text-[color:var(--fr-ink-70)]">
            A small REST API and signed outbound webhooks, so your scheduling
            tool, your books, or a Zap can work with the same conversations your
            crew does. Keys are scoped, revocable, and can never do more than
            the person who created them.
          </p>
          <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
            Base path <Mono>{PUBLIC_API_BASE}</Mono>. Create a key in Settings →
            API keys.
          </p>
        </div>
      </FrSection>

      <FrSection ground="frost">
        <div className="max-w-3xl">
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">
            Authentication, and what a key can reach.
          </h2>
          <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
            Send the key as <Mono>Authorization: Bearer lnx_…</Mono>. It is
            shown once, when it is created; we keep a hash and the first twelve
            characters, and there is no way to look it up afterwards.
          </p>
          <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
            A key acts as the person who created it, narrowed by the scopes they
            chose. That has two consequences worth designing around: a key never
            outlives its creator&apos;s access — if they leave the workspace, it stops
            working on the next request — and a key created by someone who cannot
            see a particular phone number cannot see its conversations either.
          </p>
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          {API_KEY_SCOPES.map((scope) => (
            <FrCard key={scope} className="p-4">
              <Mono>{scope}</Mono>
            </FrCard>
          ))}
        </div>
      </FrSection>

      <FrSection ground="white">
        <div className="max-w-3xl">
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">The whole surface.</h2>
          <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
            Deliberately short. This is the set an integration actually needs,
            not our internal API with a second door.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {ROUTES.map((route) => (
            <FrCard key={`${route.method} ${route.path}`} className="p-5">
              <p>
                <Mono>
                  {route.method} {route.path}
                </Mono>
              </p>
              <p className="mt-2 text-[0.8125rem] text-[color:var(--fr-ink-55)]">
                <Mono>{route.scope}</Mono>
              </p>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink-70)]">
                {route.what}
              </p>
            </FrCard>
          ))}
        </div>
      </FrSection>

      <FrSection ground="frost">
        <div className="max-w-3xl">
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">
            Webhooks, so you are not polling.
          </h2>
          <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
            Point an https address at us and we post the moment something
            happens. Every delivery is signed with HMAC-SHA256 over{" "}
            <Mono>timestamp.body</Mono>, sent as{" "}
            <Mono>Loonext-Signature: t=…,v1=…</Mono>, and carries the delivery id
            so a retry is recognisably the same event. A failing address is
            retried {WEBHOOK_MAX_ATTEMPTS} times with growing gaps, and one that
            keeps refusing is switched off so it stops costing you deliveries you
            are not receiving.
          </p>
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          {WEBHOOK_EVENT_TYPES.map((event) => (
            <FrCard key={event} className="p-4">
              <Mono>{event}</Mono>
            </FrCard>
          ))}
        </div>
      </FrSection>

      <FrSection ground="white">
        <div className="max-w-3xl">
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">
            What {PUBLIC_API_VERSION} promises.
          </h2>
          <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
            An API is a promise. Here is ours, so you can decide how much to
            build on it.
          </p>
        </div>

        <div className="mt-10 grid max-w-4xl gap-6 sm:grid-cols-2">
          <FrCard className="p-6">
            <h3 className="fr-h3 text-[color:var(--fr-ink)]">
              While {PUBLIC_API_VERSION} exists
            </h3>
            <ul className="mt-3 space-y-3">
              {PROMISES.map((promise) => (
                <li
                  key={promise}
                  className="text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink-70)]"
                >
                  {promise}
                </li>
              ))}
            </ul>
          </FrCard>

          {/* Stated as plainly as the promises. A limit somebody discovers
              after building on it is worse than one they were told. */}
          <FrCard className="p-6">
            <h3 className="fr-h3 text-[color:var(--fr-ink)]">
              What we do not promise
            </h3>
            <ul className="mt-3 space-y-3">
              {NOT_PROMISED.map((item) => (
                <li
                  key={item}
                  className="text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink-70)]"
                >
                  {item}
                </li>
              ))}
            </ul>
          </FrCard>
        </div>

        <div className="mt-10 max-w-3xl">
          <h3 className="fr-h3 text-[color:var(--fr-ink)]">
            If we ever have to break something
          </h3>
          <p className="fr-body mt-3 text-[color:var(--fr-ink-70)]">
            A breaking change means a new version path — <Mono>/public/v2</Mono>{" "}
            — served <strong>beside</strong> {PUBLIC_API_VERSION}, never
            replacing it under a running integration. Every response already
            carries <Mono>Loonext-Api-Version</Mono>, so a client that pins
            nothing is still told what answered.
          </p>
          <p className="fr-body mt-3 text-[color:var(--fr-ink-70)]">
            If {PUBLIC_API_VERSION} is ever retired, we announce it and then wait{" "}
            <strong>at least twelve months</strong>, emailing the workspaces
            whose keys are still calling it at six months and again at one. We
            know exactly who they are, because we record when each key was last
            used. Twelve months is chosen to be longer than the gap between an
            integrator finishing a job and being asked back — a policy measured
            in weeks is one that breaks somebody&apos;s business on a Tuesday.
          </p>
        </div>
      </FrSection>
    </>
  );
}
