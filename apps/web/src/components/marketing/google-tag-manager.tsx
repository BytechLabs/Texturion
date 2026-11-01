import Script from "next/script";

import { publicEnv } from "@/env";

import {
  CONSENT_COOKIE,
  consentSignals,
} from "@/components/marketing/consent/consent";

import { GtmBoot } from "./gtm-boot";
import { GTM_RELEASE } from "./gtm-release";

/**
 * Google Tag Manager for the MARKETING site only (#124). Mounted by the
 * (marketing) layout, so it never loads on the authenticated app — the
 * product surface must not stream signed-in telemetry into a marketing tag
 * manager.
 *
 * Gated on NEXT_PUBLIC_GTM_ID: unset (dev, CI, previews) → nothing renders, so
 * only production pollutes the real container. Set it to the container id in
 * production (the founder's is `GTM-MTL658DD`; deploy.yml carries it).
 *
 * CONSENT (#124 follow-up): the loader runs under Consent Mode v2. The same
 * inline script — same <Script> tag, so the order is guaranteed — first seeds
 * the dataLayer with a consent default read from the visitor's stored choice
 * (the `loonext.consent` cookie the ConsentBanner writes): granted only when
 * they said yes, denied otherwise, security_storage always granted. Only THEN
 * does gtm.js load, so every tag with a consent check sees the right state
 * from its first evaluation. The classic <noscript> iframe is deliberately
 * ABSENT: it cannot read consent state, so shipping it would fire the
 * container for no-JS visitors unconditionally — with JS off, GTM simply
 * never loads (and the banner never shows, because there is nothing to ask).
 *
 * next/script `afterInteractive` is the documented Next equivalent of GTM's
 * "as high in <head> as possible" vanilla snippet. The script seeds the
 * consent default and pushes the `gtm.js` event at once, so the dataLayer
 * holds them, in that order, before anything else can push. Only the gtm.js
 * DOWNLOAD waits for the page to settle (#640): <GtmBoot> releases it after
 * the LCP paint, load and an idle moment, or the visitor's first input.
 * Fetched at hydration, it could land before the LCP frame and join the LCP
 * Lighthouse simulates. The script defines the download and the boot releases
 * it, whichever runs first, so gtm.js can only ever load after the consent
 * default. The download runs once per document: the marketing shell mounts
 * again on every EN/FR switch and on a return from the app.
 *
 * A visitor can follow a link before gtm.js runs, and tags then read the new
 * page's URL. The `gtm.js` event carries the URL and referrer the visitor
 * landed with, as `landing_page_location` and `landing_page_referrer`, for a
 * tag that needs the landing page or its click ids.
 */
export function GoogleTagManager() {
  const id = publicEnv.NEXT_PUBLIC_GTM_ID;
  if (!id) return null;

  // Both signal maps are embedded and the cookie picks one at runtime, so the
  // inline script and the ConsentBanner can never disagree about what a
  // choice means — consentSignals() is the single source of truth.
  const granted = JSON.stringify(consentSignals("granted"));
  const denied = JSON.stringify(consentSignals("denied"));

  return (
    <>
      <Script id="gtm-loader" strategy="afterInteractive">
        {`(function(w,d){w.dataLayer=w.dataLayer||[];function g(){w.dataLayer.push(arguments);}
var granted=('; '+d.cookie).indexOf('; ${CONSENT_COOKIE}=granted')!==-1;
g('consent','default',granted?${granted}:${denied});
})(window,document);
(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js',landing_page_location:w.location.href,
landing_page_referrer:d.referrer});var load=function(){if(w.${GTM_RELEASE}==='done')return;
w.${GTM_RELEASE}='done';var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);};
if(w.${GTM_RELEASE}==='go')load();else w.${GTM_RELEASE}=load;
})(window,document,'script','dataLayer','${id}');`}
      </Script>
      <GtmBoot />
    </>
  );
}
