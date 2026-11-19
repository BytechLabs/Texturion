const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const PAGE_STYLE = "html,body{margin:0;height:100%}body{display:grid;place-items:center}";

export function GET(request: Request) {
  const locale = new URL(request.url).searchParams.get("lang") === "fr-CA" ? "fr-CA" : "en";
  const title = locale === "fr-CA" ? "Protection antipourriel" : "Spam protection";
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const key = /^[A-Za-z0-9_-]+$/.test(siteKey) ? siteKey : "";
  const vendor = key ? `<script src="${TURNSTILE_SCRIPT}" defer></script>` : "";

  return new Response(`<!doctype html><html lang="${locale}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title}</title><style>${PAGE_STYLE}</style>
${vendor}<script src="/widget-challenge.js" defer></script>
</head><body><div id="challenge" data-sitekey="${key}"></div></body></html>`, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": [
        "default-src 'none'",
        "script-src 'self' https://challenges.cloudflare.com",
        "frame-src https://challenges.cloudflare.com",
        "connect-src https://challenges.cloudflare.com",
        "style-src 'unsafe-inline'",
        "frame-ancestors https: http:",
        "base-uri 'none'",
      ].join("; "),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
