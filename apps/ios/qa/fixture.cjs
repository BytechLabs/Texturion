const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { writeFile } = require("node:fs/promises");
const { createServer } = require("node:http");
const { join } = require("node:path");
const { promisify } = require("node:util");
const { WebSocketServer } = require("ws");

const run = promisify(execFile);
const origin = "http://127.0.0.1:8765";
const companyID = "20000000-0000-4000-8000-000000000001";
const billingCompanyID = "20000000-0000-4000-8000-000000000003";
const userID = "20000000-0000-4000-8000-000000000002";
const threadIDs = ["20000000-0000-4000-8000-000000000010", "20000000-0000-4000-8000-000000000011"];
const contactID = "20000000-0000-4000-8000-000000000020";
const lineID = "20000000-0000-4000-8000-000000000030";
const sessionID = "20000000-0000-4000-8000-000000000040";
const quoteID = "20000000-0000-4000-8000-000000000050";
const paymentRequestsPath = "/v1/conversations/" + threadIDs[0] + "/payment-requests";
const now = () => new Date().toISOString();
const page = (data = []) => ({ data, next_cursor: null });
const line = { id: lineID, label: "Test line", status: "active", country: "CA", number_e164: "+14165550100", created_at: now(), voice_enabled: true };
const task = { id: "test-task", company_id: companyID, title: "Test boiler", created_by_user_id: userID,
  created_at: now(), updated_at: now(), done: false, status: "open", allowed_actions: ["complete", "trash"] };
const call = { id: "test-call", call_session_id: sessionID, contact_id: contactID, contact_name: "Ada Fixture",
  caller_e164: "+14165550101", direction: "inbound", outcome: "voicemail", has_voicemail: true, voicemail_seconds: 5, started_at: now() };
const mediaByID = new Map();
let quote;
const state = { mode: "online", role: "owner", locale: "en", stage: "active", fieldwork: false, multiWorkspace: false, writes: [], scheduled: [],
  invites: [], messages: [[], []], includeVoicemail: false, paymentsEnabled: false, paymentRequests: [],
  company: { id: companyID, name: "Simulator Fixtures",
  country: "CA", timezone: "America/Toronto", subscription_status: "active", created_at: now(), updated_at: now(),
  us_texting_enabled: false, requested_area_code: "416", quiet_hours_confirm_enabled: false,
  numbers: [line], mctb_enabled: true, mctb_message: "Test message" }, contacts: [
  { id: contactID, name: "Ada Fixture", phone_e164: "+14165550101", notes: "Test notes", created_at: now(), updated_at: now() },
  { id: "other-contact", name: "Ben Fixture", phone_e164: "+14165550102", created_at: now(), updated_at: now() },
] };
const voicemailTitle = "Repair the boiler";
const voicemailTranscript = "The boiler stopped again. Could you come Wednesday morning?";
const voicemailEvent = {
  id: "fixture-voicemail-event",
  conversation_id: threadIDs[0],
  type: "call_completed",
  payload: { kind: "voicemail", voicemail_seconds: 5, transcript: voicemailTranscript, caller: "+14165550101" },
  created_at: now(),
  voicemail_task: { call_id: call.id, title: voicemailTitle, description: voicemailTranscript },
};

function message(index, body, direction = "inbound") {
  return { id: randomUUID(), conversation_id: threadIDs[index], body, direction,
    status: direction === "inbound" ? "received" : "sent", created_at: now() };
}

state.messages[0].push(message(0, "Test thread history"));
state.messages[1].push(message(1, "Second thread history"));

function thread(index) {
  const latest = state.messages[index][0];
  const contact = state.contacts[index];
  return { id: threadIDs[index], contact_id: contact.id, company_id: companyID, phone_number_id: lineID,
    status: "open", is_spam: false, created_at: latest.created_at, updated_at: latest.created_at,
    last_message_at: latest.created_at, contact, last_message: { ...latest, has_attachments: false },
    contact_phone_e164: contact.phone_e164, messages: page(state.messages[index]), viewer_level: "text",
    destination_clock: { timezone: "America/Toronto", source: "area_code", quiet: false } };
}

function broadcast(event, payload, numberID) {
  const topic = `realtime:company:${companyID}${numberID ? `:number:${numberID}` : ""}`;
  for (const socket of realtime.clients) {
    if (socket.readyState === 1 && socket.topics.has(topic)) {
      socket.send(JSON.stringify({ topic, event: "broadcast", payload: { event, payload } }));
    }
  }
}

async function sendPush(payload) {
  const path = join(process.env.QA_EVIDENCE, `push-${randomUUID()}.apns`);
  await writeFile(path, JSON.stringify(payload, null, 2));
  await run("xcrun", ["simctl", "push", process.env.QA_SIMULATOR, "com.loonext.ios.qa", path]);
}

async function push(index, title, missedCall = false) {
  await sendPush({
    aps: { alert: { title, body: "Simulator QA alert" }, sound: "default", badge: 1,
      "thread-id": `conversation:${threadIDs[index]}`, category: missedCall ? "MISSED_CALL" : "MESSAGE" },
    url: `/inbox/${threadIDs[index]}`, tag: `conversation:${threadIDs[index]}`,
    thread_action: missedCall ? "missed_call" : "message", can_reply: "true",
    action_company_id: companyID, action_user_id: userID, action_conversation_id: threadIDs[index],
    action_message_id: state.messages[index][0].id, action_callback_number: state.contacts[index].phone_e164,
  });
}

function sampleAudio() {
  const samples = 8000 * 5;
  const data = Buffer.alloc(44 + samples * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24);
  data.writeUInt32LE(16000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let sample = 0; sample < samples; sample++) {
    data.writeInt16LE(Math.round(2000 * Math.sin(2 * Math.PI * 440 * sample / 8000)), 44 + sample * 2);
  }
  return data;
}

const audio = sampleAudio();

function billingCompany() {
  return { ...state.company, id: billingCompanyID, name: "Fixture Books", subscription_status: "active", numbers: [] };
}

const emptyLists = new Set(["/v1/tags", "/v1/saved-views", "/v1/members", "/v1/port-requests", "/v1/text-enablements",
  "/v1/notifications", "/v1/company/setting-choices", "/v1/templates"]);
const createPaths = new Set(["/v1/tasks", "/v1/scheduled-messages", "/v1/numbers/provision", "/v1/invites", "/v1/quotes", paymentRequestsPath]);
const handoffPages = new Set(["/onboarding", "/onboarding/plan", "/fixture-billing"]);

const server = createServer(async (req, res) => {
  const { pathname: path, searchParams } = new URL(req.url, origin);
  const inBillingWorkspace = state.multiWorkspace && req.headers["x-company-id"] === billingCompanyID;
  const json = (value, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(value));
  };
  try {
    if (path === "/__qa/health") return json({ ready: true });
    if (path === "/__qa/writes") return json(state.writes);
    if (req.method === "GET" && handoffPages.has(path)) {
      state.writes.push({ path, body: {} });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end("<!doctype html><title>Loonext QA</title><h1>Simulator handoff</h1>");
    }
    if (path === "/__qa/french" && req.method === "POST") {
      state.locale = "fr-CA";
      state.paymentsEnabled = searchParams.has("payments");
      state.paymentRequests = [];
      return json({ ok: true });
    }
    if (path === "/__qa/profile" && req.method === "POST") {
      state.role = searchParams.get("role") ?? state.role;
      state.locale = searchParams.get("locale") ?? state.locale;
      state.stage = searchParams.get("stage") ?? state.stage;
      state.fieldwork = searchParams.has("fieldwork");
      state.multiWorkspace = searchParams.has("multi_workspace");
      state.company.plan = "pro";
      if (state.fieldwork) state.contacts[0].notes = "Test notes";
      if (state.stage === "new") {
        state.company.numbers = [line];
        state.invites = [];
      }
      return json({ ok: true });
    }
    if (path === "/__qa/open-url" && req.method === "POST") {
      let url = "";
      for await (const chunk of req) url += chunk;
      state.writes.push({ path, body: { url } });
      return json({ ok: true });
    }
    if (path === "/__qa/mode" && req.method === "POST") {
      state.mode = searchParams.get("value");
      if (state.mode !== "online") for (const socket of realtime.clients) socket.terminate();
      return json({ mode: state.mode });
    }
    if (path === "/__qa/read" && req.method === "POST") {
      broadcast("read.conversation", { conversation_id: threadIDs[1], user_id: userID, is_read: true });
      return json({ ok: true });
    }
    if (path === "/__qa/quote" && req.method === "POST") {
      quote = { id: quoteID, conversation_id: threadIDs[0], contact_id: contactID,
        amount_cents: 12300, currency: "cad", description: "Repair the drain", status: "viewed",
        created_at: now(), sent_at: now(), viewed_at: now(), expires_at: new Date(Date.now() + 3600000).toISOString() };
      return json({ ok: true });
    }
    if (path === "/__qa/quote-accepted" && req.method === "POST") {
      if (quote?.status === "viewed") {
        quote.status = "accepted";
        quote.decided_at = now();
        broadcast("quote.updated", { conversation_id: threadIDs[0], quote_id: quoteID }, lineID);
        const tag = `quote:accepted:${quoteID}`;
        await sendPush({
          aps: { alert: { title: "Ada Fixture accepted the quote", body: "The quote was accepted." },
            sound: "default", "thread-id": tag },
          kind: "payment", tag, url: `/inbox/${threadIDs[0]}`,
        });
      }
      return json({ ok: true });
    }
    if (path === "/__qa/push" && req.method === "POST") {
      const index = Number(searchParams.get("thread"));
      const title = searchParams.get("title");
      if (searchParams.has("inbound")) {
        const inbound = message(index, "Live test inbound");
        state.messages[index].unshift(inbound);
        broadcast("message.created", { conversation_id: threadIDs[index], message_id: inbound.id, direction: "inbound" });
      }
      await push(index, title, searchParams.has("missed"));
      return json({ ok: true });
    }
    if (path === "/__qa/long-thread" && req.method === "POST") {
      const first = "Can u confirm Friday? 🔧 " + "The side door is open, but please call me before you go into the workshop. ".repeat(5);
      const bodies = [first, "Friday at ten works for me.", "I still need the boiler checked 🙏", "The side door is open."];
      state.messages[0] = Array.from({ length: 40 }, (_, index) => ({
        ...message(0, bodies[index] ?? `Boiler update ${index}`, index % 2 === 0 ? "inbound" : "outbound"),
        created_at: new Date(Date.now() - index * 60_000).toISOString(),
      }));
      return json({ count: state.messages[0].length });
    }
    if (path === "/__qa/voicemail-event" && req.method === "POST") {
      state.includeVoicemail = true;
      return json({ ok: true });
    }

    if (state.mode === "offline") return req.socket.destroy();
    if (state.mode === "revoked") {
      return json({ error: { code: "unauthorized", message: "Test session revoked" } }, 401);
    }
    if (path === "/auth/v1/token" || path === "/auth/v1/signup") {
      if (path.endsWith("/signup")) {
        let input = "";
        for await (const chunk of req) input += chunk;
        const { email, data } = JSON.parse(input);
        state.writes.push({ path, body: { email, locale: data?.locale } });
        return json({ id: userID, email });
      }
      req.resume();
      return json({ access_token: "simulator-session", refresh_token: "simulator-refresh",
        expires_in: 3600, user: { id: userID, email: "qa@example.invalid" } });
    }
    if (path === "/auth/v1/logout") return json({});
    const [, attachmentID] = path.match(/^\/v1\/attachments\/([^/]+)\/url$/) ?? [];
    if (mediaByID.has(attachmentID)) {
      return json({ url: origin + "/fixture-media/" + attachmentID,
        expires_at: new Date(Date.now() + 3600_000).toISOString() });
    }
    const media = mediaByID.get(path.startsWith("/fixture-media/") ? path.slice("/fixture-media/".length) : "");
    if (media) {
      res.writeHead(200, { "Content-Type": media.contentType, "Content-Length": media.bytes.length });
      return res.end(media.bytes);
    }
    if (path === "/fixture.wav") {
      const [, first, last] = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/) ?? [];
      const start = Number(first ?? 0);
      const end = last ? Math.min(Number(last), audio.length - 1) : audio.length - 1;
      if (start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${audio.length}` });
        return res.end();
      }
      const headers = { "Content-Type": "audio/wav", "Content-Length": end - start + 1, "Accept-Ranges": "bytes" };
      if (first) headers["Content-Range"] = `bytes ${start}-${end}/${audio.length}`;
      res.writeHead(first ? 206 : 200, headers);
      return res.end(audio.subarray(start, end + 1));
    }
    if (path === "/v1/me") {
      const company = { ...state.company, subscription_status: state.stage };
      const memberships = state.stage === "new" ? [] : [{ company_id: companyID, name: company.name,
        role: state.role, subscription_status: company.subscription_status }];
      if (state.multiWorkspace) {
        memberships.push({ company_id: billingCompanyID, name: "Fixture Books", role: "bookkeeper", subscription_status: "active" });
      }
      return json({ user_id: userID, display_name: state.role === "owner" ? "Test Owner" : "Test Crew", locale: state.locale,
        company: state.stage === "new" ? null : inBillingWorkspace ? billingCompany() : company, memberships });
    }
    if (path === "/v1/me/firsts") return json({ replied: true, noted: true, marked_done: true, oriented: true });
    if (path === "/v1/for-you") return json({});
    if (path === "/v1/mfa") return json({ enrolled: false, factors: [], aal: "aal1" });
    if (path === "/v1/numbers") return json(page(inBillingWorkspace ? [] : state.company.numbers));
    if (path === "/v1/registration") return json({});
    if (path === "/v1/available-numbers") return json({ data: [], masked: true });
    if (path === "/v1/notifications/unread-count") return json({ count: 0, unread_conversations: 0 });
    if (path === "/v1/billing/portal" && req.method === "POST") {
      return json({ url: origin + "/fixture-billing" });
    }

    if (path === "/v1/payments/account") {
      if (state.paymentsEnabled) {
        return json({ connected: true, readiness: "ready", currency: "cad", charges_enabled: true });
      }
      return json({ connected: false, readiness: "not_connected" });
    }
    if (path === paymentRequestsPath && req.method === "GET") {
      return json({ payment_requests: state.paymentRequests });
    }

    const noteIndex = threadIDs.findIndex((id) => path === `/v1/conversations/${id}/notes`);
    const suggestionPath = threadIDs.some((id) => path === `/v1/conversations/${id}/reply-suggestions`);
    if (req.method === "PATCH" || path === "/v1/messages/send" ||
      (req.method === "POST" && (noteIndex !== -1 || suggestionPath || createPaths.has(path)))) {
      let input = "";
      for await (const chunk of req) input += chunk;
      const body = JSON.parse(input);
      if (path === "/v1/messages/send" && body.media) {
        body.media = body.media.map((attachment) => {
          const id = randomUUID();
          const bytes = Buffer.from(attachment.base64, "base64");
          mediaByID.set(id, { contentType: attachment.content_type, bytes });
          return { id, content_type: attachment.content_type, size_bytes: bytes.length };
        });
      }
      state.writes.push({ path, body, idempotencyKey: req.headers["idempotency-key"] });
      if (suggestionPath) {
        const ending = state.locale === "fr-CA" ? "vendredi." : "on Friday.";
        return json({ suggestions: body.draft ? [`${body.draft} ${ending}`] : [] });
      }
      if (path === `/v1/contacts/${contactID}`) return json(Object.assign(state.contacts[0], body));
      if (path === "/v1/company") return json(Object.assign(state.company, body));
      if (path === "/v1/tasks") return json({ ...task, title: body.title, conversation_id: threadIDs[0] }, 201);
      if (path === "/v1/quotes") {
        quote = { ...body, id: quoteID, contact_id: contactID, currency: "cad", status: "draft", created_at: now() };
        return json(quote, 201);
      }
      if (path === paymentRequestsPath) {
        const request = { ...body, id: randomUUID(), conversation_id: threadIDs[0], contact_id: contactID,
          currency: "cad", status: "requested", created_at: now(),
          expires_at: new Date(Date.now() + 86400_000).toISOString() };
        state.paymentRequests.push(request);
        return json(request, 201);
      }
      if (path === "/v1/numbers/provision") {
        const number = { ...line, id: randomUUID(), label: "Second test line", number_e164: "+14165550103" };
        state.company.numbers.push(number);
        return json(number, 201);
      }
      if (path === "/v1/invites") {
        const invite = { ...body, id: randomUUID(), company_id: companyID, invited_by: userID,
          created_at: now(), expires_at: new Date(Date.now() + 86400_000).toISOString(), email_sent: true };
        state.invites.push(invite);
        return json(invite, 201);
      }
      if (path === "/v1/scheduled-messages") {
        const scheduled = { ...body, id: randomUUID(), clock_timezone: "America/Toronto", status: "pending" };
        state.scheduled.push(scheduled);
        return json({ scheduled_message: scheduled }, 201);
      }
      if (noteIndex !== -1) {
        const note = { ...message(noteIndex, body.body, "note"), author_name: "Test Crew" };
        state.messages[noteIndex].unshift(note);
        return json(note, 201);
      }
      if (path === "/v1/messages/send") {
        const index = threadIDs.indexOf(body.conversation_id);
        const sent = { ...message(index, body.body, "outbound"), attachments: body.media };
        state.messages[index].unshift(sent);
        return json(sent, 201);
      }
    }

    if (path === "/v1/scheduled-messages") {
      const conversation = searchParams.get("conversation_id");
      const rows = state.scheduled.filter((row) => !conversation || row.conversation_id === conversation);
      return json({ scheduled_messages: rows });
    }
    if (path === "/v1/company") return json(inBillingWorkspace ? billingCompany() : state.company);
    if (path === "/v1/company/ownership") {
      return json({ owner_member_id: userID, i_am_owner: state.role === "owner" });
    }
    if (path === "/v1/invites") return json(page(state.invites));
    if (path === "/v1/company/ai-settings") return json({ enrich_task_address: false, enrich_task_due: false });
    if (path === "/v1/contact-fields") return json({ data: [], cap: 10 });
    if (path === "/v1/contacts") return json(page(state.contacts));
    if (path === "/v1/quotes") {
      if (quote && searchParams.get("conversation_id") === quote.conversation_id) {
        console.log(`Quote strip read: ${quote.status}`);
        return json(page([quote]));
      }
      return json(page());
    }
    if (path === `/v1/contacts/${contactID}`) return json(state.contacts[0]);
    if (path === "/v1/tasks") {
      if (!state.fieldwork) return json(page([task]));
      const due = new Intl.DateTimeFormat("en-CA", { timeZone: state.company.timezone,
        year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      return json(page([{ ...task, due_on: due, lat: 43.6426, lng: -79.3871 }]));
    }
    if (path === "/v1/dispatch" && state.fieldwork) {
      return json({ plan: { revision: 0, timezone: state.company.timezone,
        members: [{ id: userID, name: "Test Crew" }], days: [], blocks: [],
        tasks: [{ ...task, scheduled_count: 0, windows: [] }] }, workload: [] });
    }
    if (path === "/v1/calls") return json(page([call]));
    if (path === `/v1/calls/${sessionID}`) return json(call);
    if (path === `/v1/calls/${sessionID}/voicemail`) return json({ url: `${origin}/fixture.wav`, seconds: 5 });
    if (path === `/v1/conversations/${threadIDs[0]}/tasks/source` &&
      searchParams.get("call_id") === call.id) return json(page());
    if (path === "/v1/conversations") {
      if (inBillingWorkspace) return json(page());
      if (searchParams.get("textable") === "true") return json(page([thread(0)]));
      return json(page(searchParams.get("pinned") === "only" ? [] : threadIDs.map((_, index) => thread(index))));
    }

    const [, conversationID, tail] = path.match(/^\/v1\/conversations\/([^/]+)(?:\/([^/]+))?$/) ?? [];
    const index = threadIDs.indexOf(conversationID);
    if (index !== -1) {
      if (!tail) return json(thread(index));
      if (tail === "messages") return json(page(state.messages[index]));
      if (tail === "summary" && index === 0 && req.method === "POST") {
        return json({ lines: state.messages[0].slice(0, 4).map((source, position) => ({
          section: ["asked", "we_said", "open", "open"][position],
          text: source.body, message_id: source.id, at: source.created_at,
        })) });
      }
      if (tail === "read") return json({ conversation_id: conversationID, user_id: userID, last_read_at: now() });
      if (tail === "events") return json(page(index === 0 && state.includeVoicemail ? [voicemailEvent] : []));
      if (["pinned", "tasks", "mentionable-members"].includes(tail)) return json(page());
    }
    if (emptyLists.has(path) || path.endsWith("/activity") || path.endsWith("/linked-tasks")) return json(page());
    console.log(`Unseeded route: ${req.method} ${path}`);
    return json({ error: { code: "not_found", message: "Unseeded test route" } }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: "Fixture request failed" }, 500);
  }
});

const realtime = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (state.mode !== "online" || !req.url.startsWith("/realtime/v1/websocket?")) return socket.destroy();
  realtime.handleUpgrade(req, socket, head, (client) => {
    client.topics = new Set();
    client.on("message", (data) => {
      const { topic, event, ref } = JSON.parse(data);
      if (event === "phx_join") client.topics.add(topic);
      if (event === "phx_leave") client.topics.delete(topic);
      client.send(JSON.stringify({ topic, ref, event: "phx_reply", payload: { status: "ok", response: {} } }));
    });
  });
});
server.listen(8765, "127.0.0.1");
