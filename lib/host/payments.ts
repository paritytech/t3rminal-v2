"use client";

/**
 * The host's payments surface — balance, the statement store that carries a
 * payer's cheque, the coins claim, and host entropy — for whichever wire codec
 * this launch is on.
 *
 * Why this exists. Every payments module used to import
 * `@novasamatech/host-api-wrapper` directly. That client speaks codec 1; on the
 * TrUAPI runtime it is deliberately inert (lib/host/runtime-init.ts withholds
 * the webview mark so it cannot claim the port), which means every call it
 * makes there waits for an answer that never comes. On device that showed up
 * as "No connection — can't reach the network" before every sale: the
 * reachability probe subscribes to the balance, got nothing for six seconds,
 * and gave up (2026-09-30). The same silence would have followed at every
 * later step — entropy for the QR key, the cheque subscription, the claim.
 *
 * So each capability below picks its client once, lazily, and hands back the
 * same shape either way. The hooks keep their synchronous subscription API:
 * `deferredSubscription` returns a handle immediately and wires it up when the
 * client has loaded.
 *
 * The one real difference is the claim. Codec 1 registers a claim under a
 * 32-byte idempotency id and reports progress on `subscribeTopUpStatus(id)`;
 * that is what the retry and the background finality watcher are built on.
 * Codec 2's `payment.topUp` is a single call that resolves or rejects, with no
 * id and no status stream. `createClaimHost` bridges that onto the codec-1
 * contract claim.ts expects, and says so through `trackable: false`, so the
 * caller does not record a sale as "confirming" that nothing can ever
 * confirm.
 */

import type { ClaimHost, TopUpStatusEvent } from "@/lib/payments/coinage/claim";
import { captureWarning } from "@/lib/telemetry";
import { isTruApiRuntime } from "./detect";
import { loadHostSdk } from "./sdk";

/** A host subscription, in the shape both clients return. */
export interface HostSub {
  unsubscribe(): void;
  onInterrupt?(callback: (payload?: unknown) => void): unknown;
}

/** One page of statements, with payloads as bytes whichever codec sent them. */
export interface HostStatementsPage {
  statements: Array<{ data?: Uint8Array }>;
  isComplete: boolean;
}

function toHex(bytes: Uint8Array): `0x${string}` {
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out as `0x${string}`;
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * A subscription handle that exists before the subscription does. Interrupt
 * listeners registered early are forwarded once the real one is live; an
 * unsubscribe that races ahead of it is honoured the moment it resolves. A
 * start that throws reports through the interrupt listeners, which is what
 * every caller already does with a host that dropped them.
 */
export function deferredSubscription(start: () => Promise<HostSub>): HostSub {
  let real: HostSub | null = null;
  let stopped = false;
  const interruptListeners: Array<(payload?: unknown) => void> = [];

  void start().then(
    (sub) => {
      if (stopped) {
        sub.unsubscribe();
        return;
      }
      real = sub;
      for (const cb of interruptListeners) sub.onInterrupt?.(cb);
    },
    (error) => {
      if (stopped) return;
      for (const cb of interruptListeners) cb(error);
    },
  );

  return {
    unsubscribe() {
      stopped = true;
      real?.unsubscribe();
    },
    onInterrupt(callback) {
      interruptListeners.push(callback);
      if (real) real.onInterrupt?.(callback);
      return () => {};
    },
  };
}

// ── balance ─────────────────────────────────────────────────────────────

/** Follow the merchant's available coin balance (in planck). */
export function subscribeHostBalance(onAvailable: (planck: bigint) => void): HostSub {
  return deferredSubscription(async () => {
    if (isTruApiRuntime()) {
      const manager = await (await loadHostSdk()).getPaymentManager();
      if (!manager) throw new Error("payment manager unavailable on the TrUAPI runtime");
      return manager.subscribeBalance((item) => onAvailable(BigInt(item.available)));
    }
    const { createPaymentManager } = await import("@novasamatech/host-api-wrapper");
    return createPaymentManager().subscribeBalance((balance) => onAvailable(balance.available));
  });
}

// ── statement store (the payer's cheque arrives here) ─────────────────────

/** Follow statements on `topic`. Payloads come back as bytes on both codecs. */
export function subscribeHostStatements(
  topic: Uint8Array,
  onPage: (page: HostStatementsPage) => void,
): HostSub {
  return deferredSubscription(async () => {
    if (isTruApiRuntime()) {
      const store = await (await loadHostSdk()).getStatementStore();
      if (!store) throw new Error("statement store unavailable on the TrUAPI runtime");
      // Codec 2 carries topics and payloads as hex strings.
      return store.subscribe({ matchAny: [toHex(topic)] }, (page) =>
        onPage({
          isComplete: page.isComplete,
          statements: page.statements.map((s) => ({ data: s.data ? fromHex(s.data) : undefined })),
        }),
      );
    }
    const { createStatementStore } = await import("@novasamatech/host-api-wrapper");
    return createStatementStore().subscribe({ matchAny: [topic] }, (page) =>
      onPage({
        isComplete: page.isComplete,
        statements: page.statements.map((s) => ({ data: s.data })),
      }),
    );
  });
}

// ── entropy (the QR's ephemeral key) ────────────────────────────────────

/**
 * Host entropy for `label`, or `null` when the host cannot provide it — the
 * caller then keeps its own CSPRNG bytes. Never waits on a client that cannot
 * answer, which on the TrUAPI runtime would have held every QR for the
 * codec-1 handshake timeout.
 */
export async function deriveHostEntropy(label: Uint8Array): Promise<Uint8Array | null> {
  try {
    if (isTruApiRuntime()) {
      const result = await (await loadHostSdk()).deriveEntropy(label);
      return result.ok ? result.value : null;
    }
    const { deriveEntropy } = await import("@novasamatech/host-api-wrapper");
    const result = await deriveEntropy(label);
    return result.isOk() ? result.value : null;
  } catch {
    return null;
  }
}

// ── the coins claim ─────────────────────────────────────────────────────

export interface CodecClaimHost extends ClaimHost {
  /**
   * Whether the host can report on this claim after it returns — codec 1 can
   * (`subscribeTopUpStatus(id)`), codec 2 cannot. A sale recorded from an
   * untrackable claim must not be left "confirming": nothing would ever
   * confirm it.
   */
  readonly trackable: boolean;
}

/**
 * The claim host for this launch. `trace` wraps the host call so a claim
 * correlates across payer and terminal in one trace.
 */
export async function createClaimHost(
  trace: <T>(call: () => Promise<T>) => Promise<T>,
): Promise<CodecClaimHost> {
  if (!isTruApiRuntime()) {
    const { createPaymentManager } = await import("@novasamatech/host-api-wrapper");
    const manager = createPaymentManager();
    return {
      trackable: true,
      topUp: (planck, keys, topUpId) =>
        trace(() => manager.topUp(planck, { type: "coins", keys }, topUpId)),
      subscribeTopUpStatus: (topUpId, onStatus) => manager.subscribeTopUpStatus(topUpId, onStatus),
    };
  }

  const manager = await (await loadHostSdk()).getPaymentManager();
  if (!manager) throw new Error("payment manager unavailable on the TrUAPI runtime");

  // Codec 2 has no registration id, so the claim is keyed here instead: a
  // second `topUp` for the same id — claim.ts re-registers after a dropped
  // subscription — gets the call already in flight, never a second claim of
  // the same coins.
  const inFlight = new Map<string, Promise<void>>();

  return {
    trackable: false,
    topUp: (planck, keys, topUpId) => {
      const key = toHex(topUpId);
      if (!inFlight.has(key)) {
        inFlight.set(
          key,
          trace(() =>
            manager.topUp(planck, {
              tag: "Coins",
              value: { sr25519SecretKeys: keys.map((k) => toHex(k)) },
            }),
          ),
        );
      }
      // Registration is the call starting, not finishing; its outcome is
      // reported through the status stream below, the way codec 1 reports it.
      return Promise.resolve();
    },
    subscribeTopUpStatus: (topUpId, onStatus: (status: TopUpStatusEvent) => void) => {
      const call = inFlight.get(toHex(topUpId));
      let live = true;
      queueMicrotask(() => live && onStatus({ type: "claiming" }));
      call?.then(
        // The host moved the coins. It gives no finality signal on this
        // codec, so this is reported as claimed-not-final and the caller,
        // seeing `trackable: false`, records it as received without a watch.
        () => live && onStatus({ type: "claimed", finalized: false }),
        (error) => {
          if (!live) return;
          captureWarning("coins claim refused by the TrUAPI host", {
            reason: error instanceof Error ? error.message : String(error),
          });
          console.warn("[Coinage] TrUAPI topUp refused:", error);
          onStatus({ type: "notClaimed" });
        },
      );
      return {
        unsubscribe: () => {
          live = false;
        },
        onInterrupt: () => () => {},
      };
    },
  };
}
