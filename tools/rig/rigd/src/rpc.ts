/**
 * Named commands reachable through `/ctl/rpc`. Each method names the control
 * classes that may call it. The edge admits only the `triage` class there
 * (tools/edge/src/ctl.ts), and the rpc frame does not say who called, so a
 * frame with no `caller` is triage's; a `caller` field, if the protocol gains
 * one, is enforced the same way. Every method keeps its own limits as well.
 */
import { CONTROL_CLASSES, type ControlClass } from "@loonext/rig-protocol";
import type { RpcFrame } from "./uplink.ts";

export type RpcHandler = (params: unknown) => unknown;

interface Method {
  handler: RpcHandler;
  callers: readonly ControlClass[];
}

export class RpcRouter {
  readonly #methods = new Map<string, Method>();

  register(name: string, handler: RpcHandler, callers: readonly ControlClass[] = ["rig"]): this {
    if (this.#methods.has(name)) throw new Error(`rpc: ${name} is registered twice`);
    this.#methods.set(name, { handler, callers });
    return this;
  }

  methods(): string[] {
    return [...this.#methods.keys()].sort();
  }

  async dispatch(frame: RpcFrame): Promise<unknown> {
    const method = this.#methods.get(frame.method);
    if (!method) throw new Error(`unknown method ${frame.method}`);
    const caller = (frame as RpcFrame & { caller?: unknown }).caller ?? "triage";
    if (!(CONTROL_CLASSES as readonly unknown[]).includes(caller)) throw new Error("unknown caller class");
    if (!method.callers.includes(caller as ControlClass)) throw new Error(`${frame.method} is not open to ${String(caller)}`);
    return await method.handler(frame.params);
  }
}

/** Reads an object of params, refusing anything else. */
export function objectParams(params: unknown): Record<string, unknown> {
  if (params === undefined || params === null) return {};
  if (typeof params !== "object" || Array.isArray(params)) throw new Error("params must be an object");
  return params as Record<string, unknown>;
}
