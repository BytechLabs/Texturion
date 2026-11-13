/**
 * @vitest-environment happy-dom
 *
 * #523 — what the port section has to hand each stepper.
 *
 * A transferred-in number is de-duplicated out of the `NumberCard` list on
 * purpose, so its stepper is the only card it has. Everything that card can say
 * or offer about the LINE — as opposed to the transfer — arrives as a prop from
 * here, and every one of them fails silently when it does not:
 *
 *   number               missing → no release control, which IS the C2 defect
 *                        ("web cannot release a held ported number") coming back
 *   hold                 missing → "Live on Loonext" over a line that cannot send
 *   subscriptionActive   missing → defaults false, and the release disappears
 *                        from a perfectly ordinary held line
 *
 * None of those render an error. The card just goes quiet in the one place a
 * customer needed it to speak, which is why the wiring is pinned here rather
 * than trusted — the card's own copy has its own suite.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CompanyView,
  PhoneNumberSummary,
  PortRequest,
} from "@/lib/api/types";

/**
 * realtime-js's channel registry: `channel(topic)` hands back the channel the
 * client already holds for that topic, which here is the RealtimeProvider's.
 */
const realtime = vi.hoisted(() => {
  const live = new Map<string, unknown>();
  const channel = (topic: string) => {
    const existing = live.get(topic);
    if (existing) return existing;
    const created = {
      topic,
      on: () => created,
      subscribe: () => created,
    };
    live.set(topic, created);
    return created;
  };
  return {
    live,
    client: {
      channel,
      removeChannel: (target: { topic: string }) => {
        live.delete(target.topic);
        return Promise.resolve("ok");
      },
      getChannels: () => [...live.values()],
      realtime: { setAuth: () => Promise.resolve() },
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        getSession: () => Promise.resolve({ data: { session: { access_token: "token" } } }),
      },
    },
  };
});

vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowser: () => realtime.client,
  getAccessToken: () => Promise.resolve("token"),
}));

const ports = vi.hoisted(() => ({ rows: [] as unknown[] }));
const card = vi.hoisted(() => ({
  props: null as {
    number?: PhoneNumberSummary | null;
    hold?: unknown;
    subscriptionActive?: boolean;
  } | null,
}));

vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ companyId: "co_1", role: "owner" }),
}));
vi.mock("@/lib/api/porting", () => ({
  usePortRequests: () => ({
    isPending: false,
    isError: false,
    data: { data: ports.rows },
  }),
}));
vi.mock("@/components/settings/start-port-dialog", () => ({
  StartPortDialog: () => null,
}));
vi.mock("@/components/settings/port-card", () => ({
  PortCard: (props: Record<string, unknown>) => {
    card.props = props;
    return null;
  },
}));

import { PortSection } from "./port-section";

/** A completed transfer: the number moved, so a `phone_numbers` row carries it. */
function port(): PortRequest {
  return {
    id: "port_1",
    phone_e164: "+14165550142",
    country: "CA",
    status: "ported",
    messaging_port_status: "ported",
  } as unknown as PortRequest;
}

/** The line that transfer delivered, on hold after a downgrade. */
function heldRow(): PhoneNumberSummary {
  return {
    id: "n_ported",
    status: "suspended",
    country: "CA",
    number_e164: "+14165550142",
    requested_area_code: null,
    created_at: "2026-07-01T00:00:00Z",
    source: "ported",
  } as unknown as PhoneNumberSummary;
}

function company(overrides: Partial<CompanyView> = {}): CompanyView {
  return {
    country: "CA",
    subscription_status: "active",
    ...overrides,
  } as unknown as CompanyView;
}

function show(args: {
  numbers?: PhoneNumberSummary[];
  held?: unknown;
  company?: CompanyView;
}) {
  renderToStaticMarkup(
    <PortSection
      company={args.company ?? company()}
      numbers={args.numbers}
      held={args.held as never}
    />,
  );
}

beforeEach(() => {
  ports.rows = [port()];
  card.props = null;
});
afterEach(cleanup);

describe("PortSection and the realtime socket", () => {
  it("leaves the app-wide company channel alone when it mounts and unmounts", async () => {
    // realtime-js answers channel("company:{id}") with the provider's own channel, so removing it silences the app.
    realtime.live.clear();
    realtime.client.channel("company:co_1");
    const before = realtime.client.getChannels();
    const queryClient = new QueryClient();

    const view = render(
      <QueryClientProvider client={queryClient}>
        <PortSection company={company()} numbers={[heldRow()]} />
      </QueryClientProvider>,
    );
    await act(async () => {});
    view.unmount();
    await act(async () => {});

    expect(realtime.client.getChannels()).toEqual(before);
  });
});

describe("PortSection hands the stepper the line, not just the transfer", () => {
  it("resolves the delivered row so the card can offer to release it", () => {
    // Without this the held ported line has no release control anywhere in a
    // browser — the number card never draws it, and the port card's own
    // destructive control is a cancel that no longer applies.
    show({ numbers: [heldRow()] });
    expect(card.props?.number?.id).toBe("n_ported");
  });

  it("tells the card whether the plan is live", () => {
    // Half the release rule. It defaults FALSE in the card, so forgetting it
    // does not crash — it quietly withholds the control from every held line.
    show({ numbers: [heldRow()] });
    expect(card.props?.subscriptionActive).toBe(true);

    show({
      numbers: [heldRow()],
      company: company({ subscription_status: "canceled" }),
    });
    expect(card.props?.subscriptionActive).toBe(false);
  });

  it("resolves no row while the number is still with the old carrier", () => {
    // A `phone_numbers` row carries no E.164 until cutover, which is what makes
    // "has it arrived" answerable at all — and what keeps the release control
    // and the cancel control from ever appearing together.
    const inFlight = {
      ...heldRow(),
      number_e164: null,
      status: "provisioning",
    } as PhoneNumberSummary;
    show({ numbers: [inFlight] });
    expect(card.props?.number).toBeNull();
  });

  it("resolves nothing at all when the numbers list never arrived", () => {
    // The prop is optional so a caller without the list gets today's behaviour
    // rather than a crash. What it must not do is invent a row.
    show({});
    expect(card.props?.number).toBeNull();
    expect(card.props?.hold).toBeNull();
  });
});
