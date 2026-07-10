import Script from "next/script";

import { publicEnv } from "@/env";

/**
 * Google Tag Manager for the MARKETING site only (#124). Mounted by the
 * (marketing) layout, so it never loads on the authenticated app — the
 * product surface must not stream signed-in telemetry into a marketing tag
 * manager.
 *
 * Gated on NEXT_PUBLIC_GTM_ID: unset (dev, CI, previews) → nothing renders, so
 * only production pollutes the real container. Set it to the container id in
 * production (the founder's is `GTM-MTL658DD`).
 *
 * next/script `afterInteractive` is the documented Next equivalent of GTM's
 * "as high in <head> as possible" vanilla snippet — the loader still runs
 * before user interaction, and the dataLayer is seeded synchronously first so
 * no early events are lost. The <noscript> iframe is the no-JS fallback.
 *
 * NOTE (compliance): an EMPTY GTM container sets no cookies. The moment a
 * cookie-setting tag (GA4, ads pixels) is added in the GTM UI, cross-site
 * tracking begins — which conflicts with /legal/cookies ("no advertising or
 * cross-site tracking cookies... no consent banner"). Configure GTM Consent
 * Mode, or add a consent banner, before enabling such tags. See #124.
 */
export function GoogleTagManager() {
  const id = publicEnv.NEXT_PUBLIC_GTM_ID;
  if (!id) return null;

  return (
    <>
      <Script id="gtm-loader" strategy="afterInteractive">
        {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${id}');`}
      </Script>
      <noscript>
        <iframe
          src={`https://www.googletagmanager.com/ns.html?id=${id}`}
          height="0"
          width="0"
          style={{ display: "none", visibility: "hidden" }}
          title="Google Tag Manager"
        />
      </noscript>
    </>
  );
}
