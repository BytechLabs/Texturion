declare namespace Cloudflare {
  interface Env {
    UPLINK: DurableObjectNamespace<import("../uplink").RigUplink>;
    MAILBOX: DurableObjectNamespace<import("../mailbox").RobotMailbox>;
  }
}
