import type { ReactNode } from "react";

import {
  API_KEY_REQUESTS_PER_MINUTE,
  API_KEY_SCOPES,
  PUBLIC_API_BASE,
  PUBLIC_API_VERSION,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_MAX_ATTEMPTS,
} from "@loonext/shared";

import type { MarketingLocale } from "@/i18n/marketing/footer";
import { developersCopy } from "@/i18n/marketing/developers";

import { FrCard, FrSection } from "./fr";

const AUTHORIZATION = "Authorization: Bearer lnx_…";
const SIGNED_PAYLOAD = "timestamp.body";
const SIGNATURE_HEADER = "Loonext-Signature: t=…,v1=…";
const NEXT_VERSION = "/public/v2";
const VERSION_HEADER = "Loonext-Api-Version";

function Mono({ children }: { children: ReactNode }) {
  return <span className="fr-mono-data">{children}</span>;
}

export function DevelopersPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = developersCopy(locale);
  const routes = [
    { method: "GET", path: "/me", scope: "—", what: copy.routeMe },
    {
      method: "GET",
      path: "/contacts",
      scope: "contacts:read",
      what: copy.routeContactsGet,
    },
    {
      method: "POST",
      path: "/contacts",
      scope: "contacts:write",
      what: copy.routeContactsPost,
    },
    {
      method: "GET",
      path: "/conversations",
      scope: "conversations:read",
      what: copy.routeConversations,
    },
    {
      method: "GET",
      path: "/conversations/:id/messages",
      scope: "messages:read",
      what: copy.routeMessagesGet,
    },
    {
      method: "POST",
      path: "/messages",
      scope: "messages:send",
      what: copy.routeMessagesPost,
    },
    {
      method: "GET",
      path: "/tasks",
      scope: "tasks:read",
      what: copy.routeTasksGet,
    },
    {
      method: "POST",
      path: "/tasks",
      scope: "tasks:write",
      what: copy.routeTasksPost,
    },
    {
      method: "POST",
      path: "/webhooks",
      scope: "webhooks:manage",
      what: copy.routeWebhooksPost,
    },
    {
      method: "DELETE",
      path: "/webhooks/:id",
      scope: "webhooks:manage",
      what: copy.routeWebhooksDelete,
    },
  ];
  const promises = [
    copy.promiseField,
    copy.promiseRoute,
    copy.promiseEvent,
    copy.promiseSignature,
    copy.promiseErrors,
  ];
  const notPromised = [
    copy.notPromisedOrder,
    `${copy.notPromisedRateBefore} ${API_KEY_REQUESTS_PER_MINUTE} ${copy.notPromisedRateAfter}`,
    copy.notPromisedTiming,
    copy.notPromisedPrivate,
  ];

  return (
    <>
      <FrSection ground="white">
        <div className="max-w-3xl">
          <h1 className="fr-h1 text-[color:var(--fr-ink)]">{copy.title}</h1>
          <p className="fr-lede mt-6 text-[color:var(--fr-ink-70)]">
            {copy.lead}
          </p>
          <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
            {copy.baseBefore} <Mono>{PUBLIC_API_BASE}</Mono>. {copy.baseAfter}
          </p>
        </div>
      </FrSection>

      <FrSection ground="frost">
        <div className="max-w-3xl">
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">
            {copy.authTitle}
          </h2>
          <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
            {copy.authBefore} <Mono>{AUTHORIZATION}</Mono>. {copy.authAfter}
          </p>
          <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
            {copy.authDetail}
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
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">
            {copy.surfaceTitle}
          </h2>
          <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
            {copy.surfaceLead}
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {routes.map((route) => (
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
            {copy.webhooksTitle}
          </h2>
          <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
            {copy.webhooksBefore} <Mono>{SIGNED_PAYLOAD}</Mono>,{" "}
            {copy.webhooksMiddle} <Mono>{SIGNATURE_HEADER}</Mono>,{" "}
            {copy.webhooksAfterBeforeRetries} {WEBHOOK_MAX_ATTEMPTS}{" "}
            {copy.webhooksAfterRetries}
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
            {copy.promisesTitleBefore} {PUBLIC_API_VERSION}{" "}
            {copy.promisesTitleAfter}
          </h2>
          <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
            {copy.promisesLead}
          </p>
        </div>

        <div className="mt-10 grid max-w-4xl gap-6 sm:grid-cols-2">
          <FrCard className="p-6">
            <h3 className="fr-h3 text-[color:var(--fr-ink)]">
              {copy.whileExistsBefore} {PUBLIC_API_VERSION}{" "}
              {copy.whileExistsAfter}
            </h3>
            <ul className="mt-3 space-y-3">
              {promises.map((promise) => (
                <li
                  key={promise}
                  className="text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink-70)]"
                >
                  {promise}
                </li>
              ))}
            </ul>
          </FrCard>

          <FrCard className="p-6">
            <h3 className="fr-h3 text-[color:var(--fr-ink)]">
              {copy.notPromisedTitle}
            </h3>
            <ul className="mt-3 space-y-3">
              {notPromised.map((item) => (
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
            {copy.breakingTitle}
          </h3>
          <p className="fr-body mt-3 text-[color:var(--fr-ink-70)]">
            {copy.breakingBefore} <Mono>{NEXT_VERSION}</Mono>{" "}
            {copy.breakingBeside} <strong>{copy.breakingStrong}</strong>{" "}
            {PUBLIC_API_VERSION}, {copy.breakingAfter}{" "}
            <Mono>{VERSION_HEADER}</Mono>, {copy.breakingEnd}
          </p>
          <p className="fr-body mt-3 text-[color:var(--fr-ink-70)]">
            {copy.retirementBefore} {PUBLIC_API_VERSION}{" "}
            {copy.retirementMiddle} <strong>{copy.retirementStrong}</strong>,{" "}
            {copy.retirementAfter}
          </p>
        </div>
      </FrSection>
    </>
  );
}
