/* Loonext Text us widget. Install with one script tag carrying data-key. */
(function mountWidget() {
  "use strict";

  const script = document.currentScript;
  if (!script) return;

  const {key} = script.dataset;
  if (!key) {
    // A missing key is the one error worth saying out loud: the snippet was
    // pasted without the half that identifies the business, and the widget
    // would otherwise fail silently on every page of their site.
    console.error("[loonext] widget.js needs a data-key attribute");
    return;
  }

  const COPY = {
    en: {
      launch: "Text us",
      close: "Close",
      name: "Your name",
      phone: "Mobile number",
      message: "How can we help?",
      honeypot: "Leave this empty",
      code: "The 6-digit code we just texted you",
      codeTitle: "Check your phone",
      codeSub: "Enter the code we texted so we know it is you.",
      startSub: "Send a text and we will reply here.",
      challenge: "Spam protection",
      sendCode: "Text me a code",
      sendMessage: "Send my message",
      sentCode: "We texted you a code.",
      sentMessage: "Sent. They will text you back on that number.",
      failed: "That did not work. Try again in a moment.",
      poweredBy: "Powered by Loonext"
    },
    "fr-CA": {
      launch: "Écrivez-nous",
      close: "Fermer",
      name: "Votre nom",
      phone: "Numéro de mobile",
      message: "Comment pouvons-nous vous aider ?",
      honeypot: "Laissez ce champ vide",
      code: "Le code à 6 chiffres que nous venons de vous envoyer",
      codeTitle: "Vérifiez votre téléphone",
      codeSub: "Entrez le code que nous vous avons envoyé, pour confirmer que c'est bien vous.",
      startSub: "Envoyez un message et nous vous répondrons ici.",
      challenge: "Protection antipourriel",
      sendCode: "Envoyez-moi un code",
      sendMessage: "Envoyer mon message",
      sentCode: "Nous vous avons envoyé un code.",
      sentMessage: "Envoyé. On vous répondra par texto à ce numéro.",
      failed: "Ça n'a pas fonctionné. Réessayez dans un moment.",
      poweredBy: "Propulsé par Loonext"
    }
  };
  const {lang} = script.dataset;
  const t = COPY[lang] || COPY.en;

  const {origin} = new URL(script.src, location.href);
  const accent = script.dataset.accent || "#1f2421";
  const label = script.dataset.label || t.launch;
  const side = script.dataset.side === "left" ? "left" : "right";

  const host = document.createElement("div");
  host.dataset.loonextWidget = "";
  const root = host.attachShadow({ mode: "open" });
  document.body.append(host);

  const style = document.createElement("style");
  style.textContent = [
    ":host{all:initial}",
    "*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,sans-serif}",
    `.wrap{position:fixed;bottom:20px;${  side  }:20px;z-index:2147483000}`,
    // 44px is the floor for a touch target, and the launcher is the one control
    // somebody hits with a thumb while holding a phone in the other hand.
    ".launch{display:flex;align-items:center;gap:8px;min-height:48px;padding:0 20px;",
    `border:0;border-radius:999px;background:${  accent  };color:#fff;`,
    "font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.18)}",
    ".launch:focus-visible,.panel :focus-visible{outline:3px solid #7c9a3f;outline-offset:2px}",
    ".panel{width:min(340px,calc(100vw - 40px));background:#fff;color:#1f2421;",
    "border-radius:16px;padding:18px;box-shadow:0 18px 50px rgba(0,0,0,.22)}",
    ".panel[hidden]{display:none}",
    "h2{margin:0 0 4px;font-size:16px}",
    "p{margin:0 0 14px;font-size:13px;color:#5b6157}",
    "label{display:block;font-size:12px;font-weight:600;margin:10px 0 4px}",
    // 16px on the inputs, deliberately: anything smaller makes iOS Safari zoom
    // the whole page on focus, which throws the visitor out of the form.
    "input,textarea{width:100%;min-height:44px;padding:10px;border:1px solid #cfd3ca;",
    "border-radius:10px;font-size:16px;background:#fff;color:#1f2421}",
    "textarea{min-height:76px;resize:vertical}",
    ".send{width:100%;min-height:48px;margin-top:14px;border:0;border-radius:12px;",
    `background:${  accent  };color:#fff;font-size:15px;font-weight:600;cursor:pointer}`,
    ".send[disabled]{opacity:.55;cursor:default}",
    `.close{position:absolute;top:10px;${  side  }:10px;min-width:44px;min-height:44px;`,
    "border:0;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:#5b6157}",
    ".panelwrap{position:relative}",
    ".note{margin:10px 0 0;font-size:12px;color:#5b6157}",
    ".err{margin:10px 0 0;font-size:13px;color:#a4342b}",
    // Quiet enough to be furniture and still legible: 11px at #6b7168 on the
    // panel's own white is 4.9:1, past AA for small text. A mark nobody can
    // read is not a channel, and one that fails contrast is a violation we
    // shipped onto somebody else's website.
    ".by{margin:12px 0 0;text-align:center;font-size:11px}",
    ".by a{color:#6b7168;text-decoration:none}",
    ".by a:hover,.by a:focus-visible{text-decoration:underline}",
    // The honeypot. Off-screen rather than display:none, because some bots
    // skip hidden fields and the point is that they fill it in.
    ".hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}",
    "@media (prefers-reduced-motion: no-preference){",
    ".panel{animation:pop .16s ease-out}",
    "@keyframes pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}}",
  ].join("");
  root.append(style);

  const wrap = document.createElement("div");
  wrap.className = "wrap";
  wrap.innerHTML =
    `<button class="launch" type="button" aria-haspopup="dialog" aria-expanded="false">` +
    `<span></span></button>` +
    // `aria-labelledby`, pointing at the heading this panel already had.
    // Without it a screen reader announces "dialog" and nothing else — axe's
    // `aria-dialog-name`, serious, and the one violation the audit found on the
    // expanded panel. The id is prefixed like every other in here because this
    // markup lands inside a shadow root on somebody else's page.
    `<div class="panelwrap"><div class="panel" role="dialog" aria-modal="true" ` +
    `aria-labelledby="lx-title" hidden>` +
    `<button class="close" type="button" aria-label="${  t.close  }">&times;</button>` +
    `<h2 id="lx-title"></h2><p class="sub"></p>` +
    `<form novalidate>` +
    `<div class="step-one">` +
    `<label for="lx-name">${  t.name  }</label>` +
    `<input id="lx-name" name="name" maxlength="120" autocomplete="name" required>` +
    `<label for="lx-phone">${  t.phone  }</label>` +
    `<input id="lx-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" required>` +
    `<label for="lx-msg">${  t.message  }</label>` +
    `<textarea id="lx-msg" name="message" required></textarea>` +
    `<div class="hp"><label for="lx-web">${  t.honeypot  }</label>` +
    `<input id="lx-web" name="website" tabindex="-1" autocomplete="off"></div>` +
    `</div>` +
    `<div class="step-two" hidden>` +
    `<label for="lx-code">${  t.code  }</label>` +
    `<input id="lx-code" name="code" inputmode="numeric" autocomplete="one-time-code" ` +
    `maxlength="6" pattern="\\d{6}">` +
    `</div>` +
    `<button class="send" type="submit"></button>` +
    `</form>` +
    `<p class="note" role="status" aria-live="polite"></p>` +
    `<p class="err" role="alert"></p>` +
    // #232's acquisition loop: a small mark on our customers' sites, in front
    // of their customers, who are often small business owners themselves.
    //
    // INSIDE the panel, never on the collapsed bubble. The bubble sits on
    // somebody else's homepage all day and has one job; a badge riding on it
    // is our advertising in their layout, and the first thing an owner would
    // ask us to remove. Here it is seen only by a visitor who has already
    // decided to text them — the moment the product has just worked, which is
    // the only moment a "powered by" earns anything.
    //
    // A plain link. No beacon, no pixel, no id: `?ref=widget` says which
    // surface sent them and carries nothing about the person who clicked.
    // `rel="noopener"` because it opens in a new tab, and `noreferrer` would
    // throw away the one thing we want to know.
    `<p class="by"><a href="https://loonext.com/?ref=widget" target="_blank" ` +
    `rel="noopener">${  t.poweredBy  }</a></p>` +
    `</div></div>`;
  root.append(wrap);

  const launcher = root.querySelector(".launch");
  const panel = root.querySelector(".panel");
  const form = root.querySelector("form");
  const stepOne = root.querySelector(".step-one");
  const stepTwo = root.querySelector(".step-two");
  const send = root.querySelector(".send");
  const note = root.querySelector(".note");
  const err = root.querySelector(".err");
  const title = root.querySelector("h2");
  const sub = root.querySelector(".sub");

  launcher.querySelector("span").textContent = label;
  let verificationId = null;

  function paint() {
    const coding = verificationId !== null;
    stepOne.hidden = coding;
    stepTwo.hidden = !coding;
    title.textContent = coding ? t.codeTitle : label;
    sub.textContent = coding ? t.codeSub : t.startSub;
    send.textContent = coding ? t.sendMessage : t.sendCode;
  }

  function open() {
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    paint();
    // The first thing a keyboard or screen-reader user needs is to BE in the
    // dialog they just opened.
    const first = panel.querySelector("input:not([tabindex='-1'])");
    if (first) first.focus();
  }

  function close() {
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    // Back where they were. A dialog that drops focus on the body leaves a
    // keyboard user at the top of the page with no idea what happened.
    launcher.focus();
  }

  launcher.addEventListener("click", () => {
    if (panel.hidden) open();
    else close();
  });
  root.querySelector(".close").addEventListener("click", close);

  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key !== "Tab") return;
    // The trap. Without it, Tab walks out of the dialog and into the host
    // page's own links behind it, which for a screen-reader user is silent.
    const focusable = panel.querySelectorAll(
      "button, input:not([tabindex='-1']), textarea, iframe",
    );
    if (focusable.length === 0) return;
    const { 0: first } = focusable;
    const last = focusable[focusable.length - 1];
    const active = root.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  });

  function unpackResponse(response) {
    return response
      .json()
      .catch(() => ({}))
      .then((payload) => ({ ok: response.ok, payload }));
  }

  function formText(data, field) {
    const value = data.get(field);
    return typeof value === "string" ? value : "";
  }

  function post(path, body) {
    return fetch(origin.replace("//app.", "//api.") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(unpackResponse);
  }

  function turnstileToken() {
    return new Promise((resolve) => {
      const frame = document.createElement("iframe");
      frame.title = t.challenge;
      frame.style.cssText = "width:100%;height:66px;border:0";
      const url = new URL("/widget-challenge", origin);
      url.searchParams.set("parent", location.origin);
      url.searchParams.set("lang", lang === "fr-CA" ? lang : "en");

      function finish(token) {
        clearTimeout(timer);
        window.removeEventListener("message", receive);
        frame.remove();
        resolve(token ?? undefined);
      }

      function receive(event) {
        if (event.origin === origin && event.source === frame.contentWindow &&
            event.data?.type === "loonext-widget-captcha") {
          finish(typeof event.data.token === "string" ? event.data.token : undefined);
        }
      }

      const timer = setTimeout(finish, 20_000);
      window.addEventListener("message", receive);
      frame.src = url.href;
      form.before(frame);
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    err.textContent = "";
    send.disabled = true;
    const data = new FormData(form);

    const request =
      verificationId === null
        ? turnstileToken().then((token) => post("/widget/start", {
            widgetKey: key,
            phone: formText(data, "phone"),
            website: formText(data, "website"),
            turnstileToken: token,
          }))
        : post("/widget/verify", {
            verificationId,
            code: formText(data, "code"),
            name: formText(data, "name"),
            message: formText(data, "message"),
          });

    request
      .then((result) => {
        send.disabled = false;
        if (!result.ok) {
          err.textContent =
            result.payload?.error?.message || t.failed;
          return;
        }
        if (verificationId === null) {
          ({ verificationId } = result.payload);
          paint();
          note.textContent = t.sentCode;
          const code = root.querySelector("#lx-code");
          if (code) code.focus();
          return;
        }
        form.hidden = true;
        note.textContent = t.sentMessage;
      })
      .catch(() => {
        send.disabled = false;
        err.textContent = t.failed;
      });
  });

  paint();
})();
