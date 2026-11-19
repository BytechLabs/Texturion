(() => {
  const origin = new URLSearchParams(location.search).get("parent");
  if (window.parent === window || !origin) return;

  try {
    const url = new URL(origin);
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) return;
  } catch {
    return;
  }

  const container = document.getElementById("challenge");
  const key = container.dataset.sitekey;
  const finish = (token) => window.parent.postMessage({ type: "loonext-widget-captcha", token }, origin);
  const fail = () => finish(null);
  if (!key || !window.turnstile) {
    fail();
    return;
  }

  window.turnstile.render(container, {
    sitekey: key,
    language: document.documentElement.lang,
    callback: finish,
    "error-callback": fail,
    "expired-callback": fail,
    "timeout-callback": fail,
  });
})();
