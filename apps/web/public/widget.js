/**
 * #232 — the "Text us" widget, as one script tag.
 *
 *   <script src="https://app.loonext.com/widget.js" data-key="…" defer></script>
 *
 * The person pasting this is a plumber who owns a WordPress site, not a
 * developer, so: no build step, no npm package, no framework, no config file.
 * One tag, one attribute.
 *
 * ## Why a shadow root
 *
 * This runs inside somebody else's theme. Two things must be true and neither
 * is achievable with ordinary CSS: their stylesheet must not reach our button
 * (a theme that sets `button { width: 100% }` would smear it across the page),
 * and ours must not reach anything of theirs. A shadow root is the only
 * mechanism that gives both, and it is why the styles below can be plain and
 * short rather than defensive and long.
 *
 * ## Accessibility is not a pass at the end
 *
 * The panel is a real dialog: focus moves into it on open, is trapped while it
 * is open, ESC closes it, and focus returns to the launcher — which is where a
 * keyboard user was, and losing that is how a widget becomes a trap. Every
 * control is a real `<button>` or a labelled `<input>`. Step changes are
 * announced through a polite live region, because a sighted visitor sees the
 * form become a code field and a blind one is told nothing otherwise.
 *
 * ## What it never does
 *
 * No cookies, no localStorage, no analytics, no third-party requests, and it
 * does not read anything from the host page. It is on a customer's site in
 * front of their customers; the only data that leaves is what the visitor typed
 * into this form.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;

  var key = script.getAttribute("data-key");
  if (!key) {
    // A missing key is the one error worth saying out loud: the snippet was
    // pasted without the half that identifies the business, and the widget
    // would otherwise fail silently on every page of their site.
    console.error("[loonext] widget.js needs a data-key attribute");
    return;
  }

  var origin = new URL(script.src, location.href).origin;
  var accent = script.getAttribute("data-accent") || "#1f2421";
  var label = script.getAttribute("data-label") || "Text us";
  var side = script.getAttribute("data-side") === "left" ? "left" : "right";

  var host = document.createElement("div");
  host.setAttribute("data-loonext-widget", "");
  var root = host.attachShadow({ mode: "open" });
  document.body.appendChild(host);

  var style = document.createElement("style");
  style.textContent = [
    ":host{all:initial}",
    "*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,sans-serif}",
    ".wrap{position:fixed;bottom:20px;" + side + ":20px;z-index:2147483000}",
    // 44px is the floor for a touch target, and the launcher is the one control
    // somebody hits with a thumb while holding a phone in the other hand.
    ".launch{display:flex;align-items:center;gap:8px;min-height:48px;padding:0 20px;",
    "border:0;border-radius:999px;background:" + accent + ";color:#fff;",
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
    "background:" + accent + ";color:#fff;font-size:15px;font-weight:600;cursor:pointer}",
    ".send[disabled]{opacity:.55;cursor:default}",
    ".close{position:absolute;top:10px;" + side + ":10px;min-width:44px;min-height:44px;",
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
  root.appendChild(style);

  var wrap = document.createElement("div");
  wrap.className = "wrap";
  wrap.innerHTML =
    '<button class="launch" type="button" aria-haspopup="dialog" aria-expanded="false">' +
    "<span></span></button>" +
    // `aria-labelledby`, pointing at the heading this panel already had.
    // Without it a screen reader announces "dialog" and nothing else — axe's
    // `aria-dialog-name`, serious, and the one violation the audit found on the
    // expanded panel. The id is prefixed like every other in here because this
    // markup lands inside a shadow root on somebody else's page.
    '<div class="panelwrap"><div class="panel" role="dialog" aria-modal="true" ' +
    'aria-labelledby="lx-title" hidden>' +
    '<button class="close" type="button" aria-label="Close">&times;</button>' +
    "<h2 id=\"lx-title\"></h2><p class=\"sub\"></p>" +
    '<form novalidate>' +
    '<div class="step-one">' +
    '<label for="lx-name">Your name</label>' +
    '<input id="lx-name" name="name" autocomplete="name" required>' +
    '<label for="lx-phone">Mobile number</label>' +
    '<input id="lx-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" required>' +
    '<label for="lx-msg">How can we help?</label>' +
    '<textarea id="lx-msg" name="message" required></textarea>' +
    '<div class="hp"><label for="lx-web">Leave this empty</label>' +
    '<input id="lx-web" name="website" tabindex="-1" autocomplete="off"></div>' +
    "</div>" +
    '<div class="step-two" hidden>' +
    '<label for="lx-code">The 6-digit code we just texted you</label>' +
    '<input id="lx-code" name="code" inputmode="numeric" autocomplete="one-time-code" ' +
    'maxlength="6" pattern="\\d{6}">' +
    "</div>" +
    '<button class="send" type="submit"></button>' +
    "</form>" +
    '<p class="note" role="status" aria-live="polite"></p>' +
    '<p class="err" role="alert"></p>' +
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
    '<p class="by"><a href="https://loonext.com/?ref=widget" target="_blank" ' +
    'rel="noopener">Powered by Loonext</a></p>' +
    "</div></div>";
  root.appendChild(wrap);

  var launcher = root.querySelector(".launch");
  var panel = root.querySelector(".panel");
  var form = root.querySelector("form");
  var stepOne = root.querySelector(".step-one");
  var stepTwo = root.querySelector(".step-two");
  var send = root.querySelector(".send");
  var note = root.querySelector(".note");
  var err = root.querySelector(".err");
  var title = root.querySelector("h2");
  var sub = root.querySelector(".sub");

  launcher.querySelector("span").textContent = label;
  var verificationId = null;

  function paint() {
    var coding = verificationId !== null;
    stepOne.hidden = coding;
    stepTwo.hidden = !coding;
    title.textContent = coding ? "Check your phone" : label;
    sub.textContent = coding
      ? "Enter the code we texted so we know it is you."
      : "Send a text and we will reply here.";
    send.textContent = coding ? "Send my message" : "Text me a code";
  }

  function open() {
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    paint();
    // The first thing a keyboard or screen-reader user needs is to BE in the
    // dialog they just opened.
    var first = panel.querySelector("input:not([tabindex='-1'])");
    if (first) first.focus();
  }

  function close() {
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    // Back where they were. A dialog that drops focus on the body leaves a
    // keyboard user at the top of the page with no idea what happened.
    launcher.focus();
  }

  launcher.addEventListener("click", function () {
    if (panel.hidden) open();
    else close();
  });
  root.querySelector(".close").addEventListener("click", close);

  panel.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key !== "Tab") return;
    // The trap. Without it, Tab walks out of the dialog and into the host
    // page's own links behind it, which for a screen-reader user is silent.
    var focusable = panel.querySelectorAll(
      "button, input:not([tabindex='-1']), textarea",
    );
    if (focusable.length === 0) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    var active = root.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  });

  function post(path, body) {
    return fetch(origin.replace("//app.", "//api.") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (payload) {
          return { ok: response.ok, payload: payload };
        });
    });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    err.textContent = "";
    send.disabled = true;
    var data = new FormData(form);

    var request =
      verificationId === null
        ? post("/widget/start", {
            widgetKey: key,
            phone: String(data.get("phone") || ""),
            website: String(data.get("website") || ""),
          })
        : post("/widget/verify", {
            verificationId: verificationId,
            code: String(data.get("code") || ""),
            message:
              String(data.get("name") || "") +
              ": " +
              String(data.get("message") || ""),
          });

    request
      .then(function (result) {
        send.disabled = false;
        if (!result.ok) {
          err.textContent =
            (result.payload && result.payload.message) ||
            "That did not work. Try again in a moment.";
          return;
        }
        if (verificationId === null) {
          verificationId = result.payload.verificationId;
          paint();
          note.textContent = "We texted you a code.";
          var code = root.querySelector("#lx-code");
          if (code) code.focus();
          return;
        }
        form.hidden = true;
        note.textContent = "Sent. They will text you back on that number.";
      })
      .catch(function () {
        send.disabled = false;
        err.textContent = "That did not work. Try again in a moment.";
      });
  });

  paint();
})();
