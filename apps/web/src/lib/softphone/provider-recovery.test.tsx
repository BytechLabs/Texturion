/**
 * @vitest-environment happy-dom
 *
 * The softphone keeps this browser able to ring: it registers once the app has
 * finished loading, rebuilds after a dropped socket, follows a workspace
 * switch, never touches a live call, and never asks for a token the server
 * will refuse. A fake SDK client drives the real provider.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SoftphoneStatus } from "@/components/calls/softphone-status";
import { ApiError } from "@/lib/api/error";

import { hasLiveBrowserCall } from "./live-call";

type Handler = (payload?: unknown) => void;

interface FakeClient {
  handlers: Map<string, Handler>;
  disconnected: boolean;
}

const sdk = vi.hoisted(() => ({ clients: [] as FakeClient[] }));

vi.mock("@telnyx/webrtc", () => ({
  TelnyxRTC: class {
    handlers = new Map<string, Handler>();
    disconnected = false;
    constructor() {
      sdk.clients.push(this);
    }
    on(event: string, handler: Handler) {
      this.handlers.set(event, handler);
    }
    connect() {}
    disconnect() {
      this.disconnected = true;
    }
  },
}));

const company = vi.hoisted(() => ({
  id: "company-1",
  role: "owner",
  subscription: "active",
}));

const api = vi.hoisted(() => {
  const state = {
    mintError: null as Error | null,
    mints: [] as string[],
  };
  return {
    state,
    // TanStack hands back the same mutateAsync every render inside a new
    // result object, so the mock does the same.
    mint: vi.fn(async () => {
      state.mints.push(company.id);
      if (state.mintError) throw state.mintError;
      return { token: "jwt" };
    }),
    authorize: vi.fn(async () => ({
      from: "+16135550100",
      to: "+16135550199",
      client_state: "",
      call_session_id: "v3:placed-1",
    })),
    resolve: vi.fn(async () => ({ call_session_id: "v3:customer" })),
  };
});

vi.mock("@/lib/api/calls", () => ({
  useWebrtcToken: () => ({ mutateAsync: api.mint }),
  useAuthorizeBrowserCall: () => ({ mutateAsync: api.authorize }),
  useResolveLiveSession: () => ({ mutateAsync: api.resolve }),
}));

vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({
    companyId: company.id,
    role: company.role,
    membership: {
      company_id: company.id,
      role: company.role,
      subscription_status: company.subscription,
    },
  }),
  useCompanyId: () => company.id,
}));

vi.mock("./beacons", () => ({ emitRingBeacon: () => Promise.resolve() }));

const translate = vi.hoisted(() => (key: string) => key);
// A language change hands the provider a new `t`.
const i18n = vi.hoisted(() => ({ t: translate }));
vi.mock("@/i18n/provider", () => ({ useT: () => i18n.t }));

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
  remoteStream?: MediaStream;
  telnyxIDs: { telnyxCallControlId: string };
  options: {
    remoteCallerNumber: string;
    customHeaders: { name: string; value: string }[];
  };
}

let queryClient: QueryClient;
let phone: ReturnType<typeof useSoftphone> = null;

function Probe() {
  phone = useSoftphone();
  return null;
}

function tree() {
  return (
    <QueryClientProvider client={queryClient}>
      <SoftphoneProvider>
        <Probe />
        <SoftphoneStatus />
      </SoftphoneProvider>
    </QueryClientProvider>
  );
}

async function registered(count: number): Promise<FakeClient> {
  await vi.waitFor(() => expect(sdk.clients).toHaveLength(count));
  return sdk.clients[count - 1]!;
}

function emit(client: FakeClient, event: string, payload?: unknown) {
  act(() => client.handlers.get(event)!(payload));
}

function notify(client: FakeClient, call: FakeCall) {
  emit(client, "telnyx.notification", { type: "callUpdate", call });
}

/** An inbound INVITE as the SDK delivers it; `session` is X-Loonext-Session. */
function ring(client: FakeClient, id: string, session?: string): FakeCall {
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
  notify(client, call);
  return call;
}

async function answered(client: FakeClient, id: string): Promise<FakeCall> {
  const call = ring(client, id);
  await act(() => phone!.answer(id));
  notify(client, call);
  return call;
}

function hangUp(client: FakeClient, call: FakeCall) {
  act(() => phone!.hangup(call.id));
  notify(client, call);
}

/** Whether leaving the page right now would ask the member first. */
function unloadIsGuarded(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

function foreground() {
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  sdk.clients.length = 0;
  api.state.mints.length = 0;
  api.state.mintError = null;
  api.mint.mockReset();
  api.authorize.mockClear();
  company.id = "company-1";
  company.role = "owner";
  company.subscription = "active";
  i18n.t = translate;
  phone = null;
  queryClient = new QueryClient();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [] }) },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "mediaDevices");
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("softphone recovery", () => {
  it("rebuilds the phone after its socket drops, though every render hands it new hook results", async () => {
    render(tree());
    const first = await registered(1);
    emit(first, "telnyx.ready");
    emit(first, "telnyx.socket.close");

    await act(() => vi.advanceTimersByTimeAsync(4_000));

    await registered(2);
    expect(first.disconnected).toBe(true);
  });

  it("never rebuilds under a live call, and rebuilds once it ends", async () => {
    render(tree());
    const first = await registered(1);
    emit(first, "telnyx.ready");
    const call = await answered(first, "sdk-1");
    emit(first, "telnyx.socket.close");

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(sdk.clients).toHaveLength(1);
    expect(first.disconnected).toBe(false);

    hangUp(first, call);
    await act(() => vi.advanceTimersByTimeAsync(4_000));
    await registered(2);
  });

  it("keeps retrying after a temporary refusal, through the renders around it", async () => {
    api.state.mintError = new ApiError("service_unavailable", "paused", 503);
    const view = render(tree());
    await vi.waitFor(() => expect(phone!.error).toBe("shell.registrationFailed"));

    foreground();
    view.rerender(tree());
    await act(() => vi.advanceTimersByTimeAsync(4_000));
    expect(api.mint).toHaveBeenCalledTimes(2);
  });

  it("stops asking after a refusal that will not change, until the member's access does", async () => {
    api.state.mintError = new ApiError("forbidden", "no", 403);
    const view = render(tree());
    await vi.waitFor(() => expect(phone!.error).toBe("shell.registrationFailed"));
    expect(api.mint).toHaveBeenCalledTimes(1);

    foreground();
    await act(() => vi.advanceTimersByTimeAsync(4_000));
    expect(api.mint).toHaveBeenCalledTimes(1);

    company.role = "admin";
    view.rerender(tree());
    foreground();
    await act(() => vi.advanceTimersByTimeAsync(4_000));
    expect(api.mint).toHaveBeenCalledTimes(2);
  });
});

describe("softphone registration", () => {
  it("waits for the app's own requests to finish before registering", async () => {
    let finish: (value: string) => void = () => {};
    void queryClient
      .fetchQuery({
        queryKey: ["boot"],
        queryFn: () => new Promise<string>((resolve) => (finish = resolve)),
      })
      .catch(() => {});
    render(tree());

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(api.mint).not.toHaveBeenCalled();

    await act(async () => finish("done"));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(api.mint).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(api.mint).toHaveBeenCalledTimes(1);
  });

  it("registers by five seconds even when the app never goes quiet", async () => {
    void queryClient
      .fetchQuery({
        queryKey: ["endless"],
        queryFn: () => new Promise<string>(() => {}),
      })
      .catch(() => {});
    render(tree());

    await act(() => vi.advanceTimersByTimeAsync(4_900));
    expect(api.mint).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(api.mint).toHaveBeenCalledTimes(1);
  });

  it("registers at once when opened to answer a call", () => {
    window.history.replaceState(null, "", "/calls?call=v3:ring-1");
    render(tree());
    expect(api.mint).toHaveBeenCalledTimes(1);
  });
});

describe("softphone entitlement", () => {
  it.each([
    { role: "read_only", subscription: "active" },
    { role: "bookkeeper", subscription: "active" },
    { role: "owner", subscription: "past_due" },
  ])("never asks for a token for a $role on a $subscription workspace", async (access) => {
    company.role = access.role;
    company.subscription = access.subscription;
    const view = render(tree());

    await act(() => vi.advanceTimersByTimeAsync(6_000));
    foreground();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await act(() => vi.advanceTimersByTimeAsync(5_000));

    expect(api.mint).not.toHaveBeenCalled();
    expect(view.container.querySelector('[role="status"]')).toBeNull();
  });

  it("registers once the workspace's subscription becomes active", async () => {
    company.subscription = "past_due";
    const view = render(tree());
    await act(() => vi.advanceTimersByTimeAsync(6_000));
    expect(api.mint).not.toHaveBeenCalled();

    company.subscription = "active";
    view.rerender(tree());
    await registered(1);
    expect(view.container.querySelector('[role="status"]')).not.toBeNull();
  });
});

describe("softphone workspace switch", () => {
  it("re-registers for the new workspace at once when no call is up", async () => {
    const view = render(tree());
    const first = await registered(1);
    emit(first, "telnyx.ready");
    expect(phone!.ready).toBe(true);

    company.id = "company-2";
    view.rerender(tree());

    expect(phone!.ready).toBe(false);
    await registered(2);
    expect(first.disconnected).toBe(true);
    expect(api.state.mints).toEqual(["company-1", "company-2"]);
  });

  it("waits for a live call to end before re-registering for the new workspace", async () => {
    const view = render(tree());
    const first = await registered(1);
    emit(first, "telnyx.ready");
    const call = await answered(first, "sdk-1");

    company.id = "company-2";
    view.rerender(tree());
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(sdk.clients).toHaveLength(1);
    expect(first.disconnected).toBe(false);

    hangUp(first, call);
    await registered(2);
    expect(first.disconnected).toBe(true);
    expect(api.state.mints).toEqual(["company-1", "company-2"]);
  });

  it("tries the new workspace at once when the old one's registration failed", async () => {
    api.state.mintError = new ApiError("service_unavailable", "paused", 503);
    const view = render(tree());
    await vi.waitFor(() => expect(phone!.error).toBe("shell.registrationFailed"));

    api.state.mintError = null;
    company.id = "company-2";
    view.rerender(tree());

    await registered(1);
    expect(api.state.mints).toEqual(["company-1", "company-2"]);
  });

  it("keeps showing a failed registration through a language change", async () => {
    api.state.mintError = new ApiError("service_unavailable", "paused", 503);
    const view = render(tree());
    await vi.waitFor(() => expect(phone!.error).toBe("shell.registrationFailed"));

    i18n.t = (key: string) => key;
    view.rerender(tree());

    expect(phone!.error).toBe("shell.registrationFailed");
  });

  it("rebuilds a registration that was still starting for the old workspace", async () => {
    let release: () => void = () => {};
    api.mint.mockImplementationOnce(async () => {
      api.state.mints.push(company.id);
      await new Promise<void>((resolve) => (release = resolve));
      return { token: "jwt" };
    });
    window.history.replaceState(null, "", "/calls?call=v3:ring-1");
    const view = render(tree());
    expect(api.mint).toHaveBeenCalledTimes(1);

    company.id = "company-2";
    view.rerender(tree());
    await act(async () => release());

    const second = await registered(2);
    expect(sdk.clients[0]!.disconnected).toBe(true);
    expect(second.disconnected).toBe(false);
    expect(api.state.mints).toEqual(["company-1", "company-2"]);
  });
});

describe("placing a call", () => {
  it("waits for the phone to be registered before asking the server to dial", async () => {
    render(tree());
    const client = await registered(1);

    let placed: Promise<void> = Promise.resolve();
    act(() => {
      placed = phone!.placeCall({ to: "+16135550199", contactName: "Ari" });
    });
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(api.authorize).not.toHaveBeenCalled();

    emit(client, "telnyx.ready");
    await act(() => placed);
    expect(api.authorize).toHaveBeenCalledTimes(1);
  });

  it("gives up without dialing when the phone never registers", async () => {
    render(tree());
    await registered(1);

    let outcome: Promise<unknown> = Promise.resolve();
    act(() => {
      outcome = phone!
        .placeCall({ to: "+16135550199", contactName: "Ari" })
        .catch((cause: unknown) => cause);
    });
    await act(() => vi.advanceTimersByTimeAsync(10_000));

    expect(((await outcome) as Error).message).toBe("shell.callStartFailed");
    expect(api.authorize).not.toHaveBeenCalled();
  });
});

describe("a live call", () => {
  it("guards page unload and reports itself only while it is up", async () => {
    render(tree());
    const client = await registered(1);
    emit(client, "telnyx.ready");
    expect(unloadIsGuarded()).toBe(false);
    expect(hasLiveBrowserCall()).toBe(false);

    const call = await answered(client, "sdk-1");
    expect(unloadIsGuarded()).toBe(true);
    expect(hasLiveBrowserCall()).toBe(true);

    hangUp(client, call);
    expect(unloadIsGuarded()).toBe(false);
    expect(hasLiveBrowserCall()).toBe(false);
  });

  it("lets go of the remote audio when the call ends", async () => {
    const view = render(tree());
    const client = await registered(1);
    emit(client, "telnyx.ready");
    const call = ring(client, "sdk-1");
    call.remoteStream = new MediaStream();
    await act(() => phone!.answer("sdk-1"));
    notify(client, call);
    const audio = view.container.querySelector("audio")!;
    expect(audio.srcObject).toBe(call.remoteStream);

    hangUp(client, call);
    expect(audio.srcObject).toBeNull();
  });

  it("tags its ring notification with the server session, so every tab shows one", async () => {
    const tags: (string | undefined)[] = [];
    vi.stubGlobal(
      "Notification",
      class {
        static permission = "granted";
        onclick: (() => void) | null = null;
        constructor(_title: string, options?: NotificationOptions) {
          tags.push(options?.tag);
        }
        close() {}
      },
    );
    render(tree());
    const client = await registered(1);
    ring(client, "sdk-1", "v3:ring-1");

    expect(tags).toEqual(["call-v3:ring-1"]);
  });
});

describe("the softphone context", () => {
  it("hands consumers the same value across a render that changed nothing", async () => {
    const view = render(tree());
    const client = await registered(1);
    emit(client, "telnyx.ready");
    const before = phone;

    view.rerender(tree());
    expect(phone).toBe(before);
  });
});
