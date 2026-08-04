# Mobile power and data

**Status: CURRENT DIRECTION.** The background policy and the attachment
behaviour described here are shipped and guarded; the "Still open" section at
the end is the honest list of what is not.

**#289.** What the phone apps cost the person holding the phone, what we decided
to do about it, and how a future change is stopped from quietly undoing that.

Written 2026-08-04. Every figure here is derived from the code rather than
measured on a device — see [The baseline we can and cannot
have](#the-baseline-we-can-and-cannot-have) for why that distinction is part of
the answer rather than an apology for it.

---

## Why this is not a detail for this product

The apps run on a tradesperson's **personal** phone, frequently on a metered
plan, often on marginal rural or basement signal, and are expected to survive a
ten-hour shift.

**Battery blame is fatal and quiet.** When a tech's phone dies at 3pm, Android
and iOS both show them a list of what drained it. If we are on that list we are
uninstalled, and nobody files a bug — they just stop using it. That is the most
silent form of churn there is.

**Data is their money.** This is an attachment-heavy trade. Serving a full-size
original where a bounded preview would do is spending someone else's money.

---

## The baseline we can and cannot have

**The data baseline is arithmetic, and it is here.** Every byte the app sends on
its own initiative is a constant in the source; multiplying them out is a more
reliable number than a single afternoon on one device, and it does not go stale
when somebody changes a timer.

**The battery baseline needs hardware.** A charged phone, a working day, and
Battery Historian or Instruments. There is no honest way to produce it in CI and
no device lab here, so this document does not pretend to one. What it does
instead is name the **mechanism** — which is knowable — and guard the numbers
that drive it.

The mechanism is the radio, not the bytes:

> On LTE, a transmission is followed by a tail during which the modem stays in a
> high-power state waiting for more traffic, measured in seconds. Any repeating
> packet with a period shorter than that tail holds the radio awake
> continuously.

That is why a heartbeat costing a megabyte a day was the most expensive thing
the app did, and why the fix is *when the socket is up*, not *how big the frames
are*.

---

## What the app sends on its own initiative

| Source | Period | Bytes on the wire | Per 24h connected |
| --- | --- | --- | --- |
| Realtime heartbeat | 25 s | ~300 B round trip | 3,456 wake-ups, ~1.0 MB |
| Presence heartbeat (thread open only) | 15 s | ~400 B | only while a thread is on screen |
| Push (FCM/APNs) | event-driven | shared OS channel | no separate connection |
| Reconnect backoff | capped at 30 s | one connection setup | bounded |

A heartbeat frame is about 60 bytes of JSON; WebSocket framing (~6), a TLS
record (~29) and TCP/IP headers (~52) bring one direction to ~150 B, and the
server answers.

**One megabyte a day is not the problem.** 3,456 radio wake-ups is.

---

## Background behaviour, decided rather than emergent

Before #289 both apps connected on sign-in and disconnected on sign-out. A phone
in a pocket held a socket all day. Nobody had decided that.

| State | Realtime socket | Why |
| --- | --- | --- |
| Foreground | connected | A visible screen needs live data. |
| Backgrounded < 30 s | connected | An app-switch — the camera, Maps, a personal text. Rebuilding costs DNS + TCP + TLS + a channel join, which is more radio than one heartbeat. |
| Backgrounded ≥ 30 s | **dropped** | Nothing on screen. Push carries everything that must arrive. |
| Live call, any state | connected | Call state rides realtime, and a call is exactly when the phone is out and often plugged in. |

The call check is repeated **after** the grace window, not only at the start: a
call can begin inside those 30 seconds when a push wakes the app and the person
answers from the lock screen without it ever coming forward.

**Nothing is lost by dropping it.** Messages, tasks and — the unforgivable one —
incoming calls all arrive by push (#151); a call is woken through the push
handler and never by a socket frame. Reconnecting emits the signal every open
surface refetches its first page on, which is the same path a tunnel or a lift
exercises many times a day.

Policy: `packages/shared/src/realtime-lifecycle.ts`, hand-ported to
`RealtimeLifecycle.kt` and `RealtimeLifecycle.swift`.

---

## Attachments

**Derivatives by default (#240).** A thread and a gallery fetch a bounded
preview — a 1600px JPEG, 150–250 KB — and the original is fetched only on an
explicit full-size view or download. A note attachment can be 25 MB and ten per
note, so this is the largest single saving available on either axis.

**Full-size photos on Wi-Fi only**, off by default, per device. Deliberately
narrow: the preview always loads, so a thread reads normally on any connection,
and only the original waits for a tap. An all-or-nothing block would leave a
wall of grey rectangles on a job site and get reported as a broken app.

The escape is per photo, not per session. "Load this one" is the deliberate act
the setting exists to require; a blanket "load everything for now" would be the
setting turning itself off on the surface where it matters most.

Policy: `packages/shared/src/metered-media.ts` and its two ports.

---

## The regression check

`packages/shared/src/radio-budget.test.ts` reads both transports and pins the
three numbers that decide how much of a day the radio is held:

- the **heartbeat**, 25 s on both phones;
- the **reconnect backoff ceiling**, 30 s on both;
- the **background grace**, 30 s.

Moving one of these is allowed. Moving one *without noticing* is what the check
stops — and the shape it is guarding against is real: the transport is
reconnect-eager by design after the parked-reconnect bug, which was the right
correctness call with an unmeasured power cost, and "let's make reconnects
snappier" is exactly how a heartbeat gets shortened.

The expressiveness work (#194) — continuous animation, shimmer, motion — is the
other shape: power spent on a screen rather than on a radio. That one is not
guarded here, because a static check cannot see it. It needs the device
measurement above.

---

## Still open

- **The measured battery baseline.** Needs a physical device and a working day.
- **Low Power Mode and Battery Saver.** Both platforms expose the state; nothing
  reads it yet. The obvious first behaviour is to lengthen the background grace
  to zero and stop non-essential prefetching.
- **Adaptive backoff on repeated failure.** The cap is bounded but flat: a phone
  bouncing between two bad towers all day retries at the ceiling forever.
