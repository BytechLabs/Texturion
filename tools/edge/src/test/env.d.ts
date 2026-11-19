import type { RobotMailbox } from "../mailbox";
import type { RigUplink } from "../uplink";

declare global {
  namespace Cloudflare {
    interface Env {
      UPLINK: DurableObjectNamespace<RigUplink>;
      MAILBOX: DurableObjectNamespace<RobotMailbox>;
    }
  }
}
