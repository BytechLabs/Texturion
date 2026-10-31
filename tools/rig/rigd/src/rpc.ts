/**
 * Named commands reachable through `/ctl/rpc`. Each method names the control
 * classes that may call it, and the frame names the class the edge admitted
 * its caller as (only `triage` today, tools/edge/src/ctl.ts). A frame whose
 * caller is missing or unknown is refused. Every method keeps its own limits
 * as well.
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
    // Off the wire: the type says ControlClass, the socket promises nothing.
    const caller: unknown = frame.caller;
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
