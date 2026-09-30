/**
 * "Can the host settle a coins sale right now?" — the pre-flight for the
 * coins payment method.
 *
 * Coins never touch the chain from the product: the host claims the
 * customer's cheque (`paymentTopUp`) and reports progress
 * (`subscribeTopUpStatus`). So the right liveness signal is the host's
 * payments bridge, not a direct chain read — the Polkadot phone app does not
 * expose the Paseo People chain to products (`chainSupported` → false) and
 * iOS blocks product-side WebSockets, so `isChainReachable()` there is
 * always "offline" while payments work fine.
 *
 * The probe opens `paymentBalanceSubscribe` and resolves true on the first
 * balance update (hosts push the current balance on subscribe), false on an
 * interrupt or the timeout, and always unsubscribes.
 */

import { isInHost } from "@/lib/host/detect";
import { subscribeHostBalance } from "@/lib/host/payments";

export interface HostBalanceSubscription {
  unsubscribe: () => void;
  onInterrupt?: (callback: (payload: unknown) => void) => void;
}

export interface HostPaymentsProbeDeps {
  subscribeBalance: (onBalance: () => void) => HostBalanceSubscription;
  inHost?: () => boolean;
  online?: () => boolean;
}

const defaultDeps = (): HostPaymentsProbeDeps => ({
  // Through lib/host/payments so the probe asks the client that is actually
  // live. It used to call the codec-1 wrapper directly, which on the TrUAPI
  // runtime is inert by design — six seconds of silence, then "No
  // connection" before every sale (device, 2026-09-30).
  subscribeBalance: (onBalance) => subscribeHostBalance(() => onBalance()),
  inHost: isInHost,
  online: () => typeof navigator === "undefined" || navigator.onLine !== false,
});

/**
 * What the probe found. "unsupported" is its own answer because it asks for a
 * different fix than "offline": the host is up and answering, it simply has
 * no payments. The Polkadot Android app's TrUAPI runtime does exactly that
 * today — its bridge implements no payments, so every call falls through to
 * the Rust core's dot.li stub (`balance_subscribe` → `PermissionDenied`,
 * `top_up` → "Payments are not supported in dot.li"; read off the device
 * 2026-09-30). Telling that merchant to check WiFi sends them after a problem
 * that does not exist.
 */
export type HostPaymentsVerdict = "reachable" | "offline" | "unsupported";

/** True when the host's refusal means "no payments here", not "can't reach you". */
export function isPaymentsUnsupported(payload: unknown): boolean {
  let text: string;
  try {
    text =
      typeof payload === "string"
        ? payload
        : JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) ?? "";
    // The SDK hands the observable's error through as-is: a `SubscriptionError`
    // whose message is only "Subscription interrupted" — the host's actual
    // answer is the typed `reason` hanging off it.
    if (payload instanceof Error) {
      const reason = (payload as { reason?: unknown }).reason;
      text += ` ${payload.name} ${payload.message} ${
        reason === undefined ? "" : JSON.stringify(reason, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
      }`;
    }
  } catch {
    text = String(payload);
  }
  return /PermissionDenied|Unsupported|not supported/i.test(text);
}

export async function isHostPaymentsReachable(
  timeoutMs = 6000,
  deps: HostPaymentsProbeDeps = defaultDeps(),
): Promise<boolean> {
  return (await probeHostPayments(timeoutMs, deps)) === "reachable";
}

export async function probeHostPayments(
  timeoutMs = 6000,
  deps: HostPaymentsProbeDeps = defaultDeps(),
): Promise<HostPaymentsVerdict> {
  if (deps.online && !deps.online()) return "offline";
  if (deps.inHost && !deps.inHost()) return "offline";

  return new Promise<HostPaymentsVerdict>((resolve) => {
    let settled = false;
    let subscription: HostBalanceSubscription | null = null;
    const finish = (verdict: HostPaymentsVerdict) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        subscription?.unsubscribe();
      } catch {
        /* already gone */
      }
      resolve(verdict);
    };
    const timer = setTimeout(() => {
      console.warn("[host-reachability] no balance from the host payments bridge within", timeoutMs, "ms");
      finish("offline");
    }, timeoutMs);

    try {
      subscription = deps.subscribeBalance(() => finish("reachable"));
      subscription.onInterrupt?.((payload) => {
        const unsupported = isPaymentsUnsupported(payload);
        console.warn(
          `[host-reachability] host payments bridge interrupted${unsupported ? " — the host has no payments on this runtime" : ""}:`,
          payload,
        );
        finish(unsupported ? "unsupported" : "offline");
      });
      // The host may have answered synchronously, before `subscription` was
      // assigned — make sure a settled probe still releases it.
      if (settled) subscription.unsubscribe();
    } catch (error) {
      console.warn("[host-reachability] host payments bridge unavailable:", error);
      finish(isPaymentsUnsupported(error) ? "unsupported" : "offline");
    }
  });
}
