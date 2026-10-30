/**
 * @vitest-environment happy-dom
 *
 * Ring beacons from the provider (D142): a fake SDK client drives the real
 * provider to prove it sends a beacon at each moment it should and no other
 * (a ring the server named, its answer, its decline), so a deleted or
 * misplaced call site fails here. What a beacon carries is beacons.test.ts.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as [string | null | undefined, string, string | null | undefined][]);

vi.mock("./beacons", () => ({
  emitRingBeacon: (
    companyId: string | null | undefined,
    stage: string,
    sessionId: string | null | undefined,
  ) => {
    sent.push([companyId, stage, sessionId]);
    return Promise.resolve();
  },
}));

type Handler = (payload?: unknown) => void;

const sdk = vi.hoisted(() => ({
  clients: [] as { handlers: Map<string, (payload?: unknown) => void> }[],
}));

vi.mock("@telnyx/webrtc", () => ({
  TelnyxRTC: class {
    handlers = new Map<string, Handler>();
    constructor() {
      sdk.clients.push(this);
    }
    on(event: string, handler: Handler) {
      this.handlers.set(event, handler);
    }
    connect() {}
    disconnect() {}
  },
}));

const api = vi.hoisted(() => ({
  authorize: {
    mutateAsync: async () => ({
      from: "+16135550100",
      to: "+16135550199",
      client_state: "",
      call_session_id: "v3:placed-1",
    }),
  },
  token: { mutateAsync: async () => ({ token: "jwt" }) },
  resolve: { mutateAsync: async () => ({ call_session_id: "v3:customer" }) },
}));

vi.mock("@/lib/api/calls", () => ({
  useAuthorizeBrowserCall: () => api.authorize,
  useWebrtcToken: () => api.token,
  useResolveLiveSession: () => api.resolve,
}));

const translate = vi.hoisted(() => (key: string) => key);
vi.mock("@/i18n/provider", () => ({ useT: () => translate }));
vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "company-1" }));

const { SoftphoneProvider, useSoftphone } = await import("./provider");

interface FakeCall {
  id: string;
  state: string;
  direction: string;
  answer: () => void;
  hangup: () => void;
  hold: () => Promise<unknown>;
  unhold: () => Promise<unknown>;
  muteAudio: () => void;
  unmuteAudio: () => void;
  dtmf: () => void;
  telnyxIDs: { telnyxCallControlId: string };
  options: {
    remoteCallerNumber: string;
    customHeaders: { name: string; value: string }[];
  };
}

let phone: ReturnType<typeof useSoftphone> = null;

function Probe() {
  phone = useSoftphone();
  return null;
}

function notify(call: FakeCall) {
  const handler = sdk.clients[0]!.handlers.get("telnyx.notification")!;
  act(() => handler({ type: "callUpdate", call }));
}

/** An INVITE as the SDK delivers it; `session` is X-Loonext-Session. */
function invite(id: string, session?: string): FakeCall {
  const call: FakeCall = {
    id,
    state: "ringing",
    direction: "inbound",
    answer: () => {
      call.state = "active";
    },
    hangup: () => {
      call.state = "hangup";
    },
    hold: async () => undefined,
    unhold: async () => undefined,
    muteAudio: () => {},
    unmuteAudio: () => {},
    dtmf: () => {},
    telnyxIDs: { telnyxCallControlId: `ccid-${id}` },
    options: {
      remoteCallerNumber: "+16135550100",
      customHeaders: session ? [{ name: "X-Loonext-Session", value: session }] : [],
    },
  };
  notify(call);
  return call;
}

beforeEach(async () => {
  sent.length = 0;
  sdk.clients.length = 0;
  phone = null;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [] }) },
  });
  render(
    <SoftphoneProvider>
      <Probe />
    </SoftphoneProvider>,
  );
  // Registration waits for an idle moment, as it does in the app.
  await waitFor(() => expect(sdk.clients).toHaveLength(1), { timeout: 4000 });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("the softphone's ring beacons", () => {
  it("reports a ring the server named as shown, then its answer, and nothing for the hang-up after", async () => {
    const call = invite("sdk-1", "v3:ring-1");
    expect(sent).toEqual([["company-1", "ringing_shown", "v3:ring-1"]]);

    await act(() => phone!.answer("sdk-1"));
    notify(call);
    act(() => phone!.hangup("sdk-1"));

    expect(sent).toEqual([
      ["company-1", "ringing_shown", "v3:ring-1"],
      ["company-1", "answered", "v3:ring-1"],
    ]);
  });

  it("reports hanging up a ring that is still ringing as declined", () => {
    invite("sdk-2", "v3:ring-2");
    act(() => phone!.hangup("sdk-2"));

    expect(sent).toEqual([
      ["company-1", "ringing_shown", "v3:ring-2"],
      ["company-1", "declined", "v3:ring-2"],
    ]);
  });

  it("sends nothing for a ring whose INVITE named no session", async () => {
    const call = invite("sdk-3");
    await act(() => phone!.answer("sdk-3"));
    notify(call);
    act(() => phone!.hangup("sdk-3"));

    expect(sent).toEqual([]);
  });

  it("never reports the member's own placer leg as a ring", async () => {
    await act(() => phone!.placeCall({ to: "+16135550199", contactName: "Ari" }));
    const op = invite("sdk-op", "v3:placed-1");
    notify(op);
    act(() => phone!.hangup("sdk-op"));

    expect(sent).toEqual([]);
  });
});
