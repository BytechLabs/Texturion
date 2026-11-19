const INCOMING_CALL_EVENT = "loonext:audit-incoming-call";

type Listener = (payload?: unknown) => void;

export class TelnyxRTC {
  private readonly listeners = new Map<string, Listener>();

  on(event: string, callback: Listener) {
    this.listeners.set(event, callback);
  }

  connect() {
    window.addEventListener(INCOMING_CALL_EVENT, this.ring);
    this.listeners.get("telnyx.ready")?.();
    document.documentElement.dataset.auditPhoneReady = "true";
  }

  disconnect() {
    window.removeEventListener(INCOMING_CALL_EVENT, this.ring);
    delete document.documentElement.dataset.auditPhoneReady;
  }

  private readonly ring = () => {
    const notify = () => this.listeners.get("telnyx.notification")?.({ call });
    const call = {
      id: crypto.randomUUID(),
      state: "ringing",
      direction: "inbound",
      options: {
        remoteCallerName: "Casey Morgan",
        remoteCallerNumber: "+16135550134",
      },
      answer: () => { call.state = "active"; notify(); },
      hangup: () => { call.state = "hangup"; notify(); },
    };
    notify();
  };
}
