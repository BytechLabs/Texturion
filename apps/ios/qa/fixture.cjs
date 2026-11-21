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
const userID = "20000000-0000-4000-8000-000000000002";
const threadIDs = ["20000000-0000-4000-8000-000000000010", "20000000-0000-4000-8000-000000000011"];
const contactID = "20000000-0000-4000-8000-000000000020";
const lineID = "20000000-0000-4000-8000-000000000030";
const sessionID = "20000000-0000-4000-8000-000000000040";
const now = () => new Date().toISOString();
const page = (data = []) => ({ data, next_cursor: null });
const line = { id: lineID, label: "Test line", status: "active", country: "CA", number_e164: "+14165550100", created_at: now(), voice_enabled: true };
const task = { id: "test-task", company_id: companyID, title: "Test boiler", created_by_user_id: userID,
  created_at: now(), updated_at: now(), done: false, status: "open", allowed_actions: ["complete", "trash"] };
const call = { id: "test-call", call_session_id: sessionID, contact_id: contactID, contact_name: "Ada Fixture",
  caller_e164: "+14165550101", direction: "inbound", outcome: "voicemail", has_voicemail: true, voicemail_seconds: 5, started_at: now() };
const state = { mode: "online", writes: [], messages: [[], []], company: { id: companyID, name: "Simulator Fixtures",
  country: "CA", timezone: "America/Toronto", subscription_status: "active", created_at: now(), updated_at: now(),
  us_texting_enabled: false, requested_area_code: "416", quiet_hours_confirm_enabled: false,
  numbers: [line], mctb_enabled: true, mctb_message: "Test message" }, contacts: [
  { id: contactID, name: "Ada Fixture", phone_e164: "+14165550101", notes: "Test notes", created_at: now(), updated_at: now() },
  { id: "other-contact", name: "Ben Fixture", phone_e164: "+14165550102", created_at: now(), updated_at: now() },
] };

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
    contact_phone_e164: contact.phone_e164, messages: page(state.messages[index]), viewer_level: "text" };
}

function broadcast(event, payload) {
  const topic = `realtime:company:${companyID}`;
  for (const socket of realtime.clients) {
    if (socket.readyState === 1 && socket.topics.has(topic)) {
      socket.send(JSON.stringify({ topic, event: "broadcast", payload: { event, payload } }));
    }
  }
}

async function push(index, title, missedCall = false) {
  const path = join(process.env.QA_EVIDENCE, `push-${index}-${randomUUID()}.apns`);
  const payload = {
    aps: { alert: { title, body: "Simulator QA alert" }, sound: "default", badge: 1,
      "thread-id": `conversation:${threadIDs[index]}`, category: missedCall ? "MISSED_CALL" : "MESSAGE" },
    url: `/inbox/${threadIDs[index]}`, tag: `conversation:${threadIDs[index]}`,
    thread_action: missedCall ? "missed_call" : "message", can_reply: "true",
    action_company_id: companyID, action_user_id: userID, action_conversation_id: threadIDs[index],
    action_message_id: state.messages[index][0].id, action_callback_number: state.contacts[index].phone_e164,
  };
  await writeFile(path, JSON.stringify(payload, null, 2));
  await run("xcrun", ["simctl", "push", process.env.QA_SIMULATOR, "com.loonext.ios.qa", path]);
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
const emptyLists = new Set(["/v1/tags", "/v1/saved-views", "/v1/members", "/v1/scheduled-messages",
  "/v1/notifications", "/v1/company/setting-choices", "/v1/templates"]);

const server = createServer(async (req, res) => {
  const { pathname: path, searchParams } = new URL(req.url, origin);
  const json = (value, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(value));
  };
  try {
    if (path === "/__qa/health") return json({ ready: true });
    if (path === "/__qa/writes") return json(state.writes);
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

    if (state.mode === "offline") return req.socket.destroy();
    if (state.mode === "revoked") {
      return json({ error: { code: "unauthorized", message: "Test session revoked" } }, 401);
    }
    if (path === "/auth/v1/token") {
      req.resume();
      return json({ access_token: "simulator-session", refresh_token: "simulator-refresh",
        expires_in: 3600, user: { id: userID, email: "qa@example.invalid" } });
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
    if (path === "/v1/me") return json({ user_id: userID, display_name: "Test Owner", locale: "en",
      company: state.company, memberships: [{ company_id: companyID, name: state.company.name, role: "owner", subscription_status: "active" }] });
    if (path === "/v1/me/firsts") return json({ replied: true, noted: true, marked_done: true, oriented: true });
    if (path === "/v1/for-you") return json({});
    if (path === "/v1/mfa") return json({ enrolled: false, factors: [], aal: "aal1" });
    if (path === "/v1/numbers") return json(page([line]));
    if (path === "/v1/notifications/unread-count") return json({ count: 0, unread_conversations: 0 });

    if (req.method === "PATCH" || path === "/v1/messages/send") {
      let input = "";
      for await (const chunk of req) input += chunk;
      const body = JSON.parse(input);
      state.writes.push({ path, body, idempotencyKey: req.headers["idempotency-key"] });
      if (path === `/v1/contacts/${contactID}`) return json(Object.assign(state.contacts[0], body));
      if (path === "/v1/company") return json(Object.assign(state.company, body));
      if (path === "/v1/messages/send") {
        const index = threadIDs.indexOf(body.conversation_id);
        const sent = message(index, body.body, "outbound");
        state.messages[index].unshift(sent);
        return json(sent, 201);
      }
    }

    if (path === "/v1/company") return json(state.company);
    if (path === "/v1/contact-fields") return json({ data: [], cap: 10 });
    if (path === "/v1/contacts") return json(page(state.contacts));
    if (path === `/v1/contacts/${contactID}`) return json(state.contacts[0]);
    if (path === "/v1/tasks") return json(page([task]));
    if (path === "/v1/calls") return json(page([call]));
    if (path === `/v1/calls/${sessionID}`) return json(call);
    if (path === `/v1/calls/${sessionID}/voicemail`) return json({ url: `${origin}/fixture.wav`, seconds: 5 });
    if (path === "/v1/conversations") {
      return json(page(searchParams.get("pinned") === "only" ? [] : threadIDs.map((_, index) => thread(index))));
    }

    const [, conversationID, tail] = path.match(/^\/v1\/conversations\/([^/]+)(?:\/([^/]+))?$/) ?? [];
    const index = threadIDs.indexOf(conversationID);
    if (index !== -1) {
      if (!tail) return json(thread(index));
      if (tail === "messages") return json(page(state.messages[index]));
      if (tail === "read") return json({ conversation_id: conversationID, user_id: userID, last_read_at: now() });
      if (["events", "pinned", "tasks", "mentionable-members"].includes(tail)) return json(page());
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
