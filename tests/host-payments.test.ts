import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/host/payments.ts bridges the two host clients onto one payments
 * contract. The codec-1 half is today's behaviour; these tests pin the codec-2
 * half, which is new and has two properties worth guarding:
 *
 *  - the claim cannot be claimed twice — codec 2's `topUp` has no idempotency
 *    id, and claim.ts re-registers after a dropped status subscription;
 *  - its outcome is reported through the same status stream claim.ts reads,
 *    and marked untrackable so no sale is left "confirming" forever.
 */

const truapi = vi.hoisted(() => ({ on: true }));
const manager = vi.hoisted(() => ({
  topUp: vi.fn(),
  subscribeBalance: vi.fn(),
}));
const store = vi.hoisted(() => ({ subscribe: vi.fn() }));
const sdk = vi.hoisted(() => ({
  getPaymentManager: vi.fn(async () => manager),
  getStatementStore: vi.fn(async () => store),
  deriveEntropy: vi.fn(),
}));

vi.mock("@/lib/host/detect", () => ({ isTruApiRuntime: () => truapi.on }));
vi.mock("@/lib/host/sdk", () => ({ loadHostSdk: async () => sdk }));
vi.mock("@/lib/telemetry", () => ({ captureWarning: vi.fn() }));

const {
  createClaimHost,
  deferredSubscription,
  deriveHostEntropy,
  subscribeHostBalance,
  subscribeHostStatements,
} = await import("@/lib/host/payments");
const { claimCoins, deriveTopUpId, NotClaimedError } = await import("@/lib/payments/coinage/claim");

const passthrough = <T,>(call: () => Promise<T>) => call();
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  truapi.on = true;
  manager.topUp.mockReset();
  manager.subscribeBalance.mockReset();
  store.subscribe.mockReset();
  sdk.deriveEntropy.mockReset();
});

describe("the codec-2 claim host", () => {
  it("is untrackable, and claims coins as hex sr25519 keys", async () => {
    manager.topUp.mockResolvedValue(undefined);
    const host = await createClaimHost(passthrough);
    expect(host.trackable).toBe(false);

    await host.topUp(5_000_000n, [new Uint8Array([1, 2]), new Uint8Array([0xab])], new Uint8Array(32));
    expect(manager.topUp).toHaveBeenCalledWith(5_000_000n, {
      tag: "Coins",
      value: { sr25519SecretKeys: ["0x0102", "0xab"] },
    });
  });

  it("never claims the same coins twice for one id", async () => {
    manager.topUp.mockResolvedValue(undefined);
    const host = await createClaimHost(passthrough);
    const id = deriveTopUpId("pay-1", 1);
    await host.topUp(1n, [new Uint8Array([1])], id);
    await host.topUp(1n, [new Uint8Array([1])], id);
    expect(manager.topUp).toHaveBeenCalledTimes(1);
  });

  it("reports claiming, then claimed-not-final once the host resolves", async () => {
    manager.topUp.mockResolvedValue(undefined);
    const host = await createClaimHost(passthrough);
    const id = deriveTopUpId("pay-2", 1);
    await host.topUp(1n, [new Uint8Array([1])], id);

    const seen: string[] = [];
    host.subscribeTopUpStatus(id, (s) =>
      seen.push(s.type === "claimed" ? `claimed:${s.finalized}` : s.type),
    );
    await tick();
    await tick();
    expect(seen).toEqual(["claiming", "claimed:false"]);
  });

  it("turns a refusal into notClaimed rather than an endless re-subscribe", async () => {
    manager.topUp.mockRejectedValue(new Error("coins already spent"));
    const host = await createClaimHost(passthrough);
    await expect(
      claimCoins({
        host,
        amountPlanck: 1n,
        keys: [new Uint8Array([1])],
        topUpId: (n) => deriveTopUpId("pay-3", n),
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(NotClaimedError);
    expect(manager.topUp).toHaveBeenCalledTimes(1);
  });

  it("settles a whole claim through claim.ts unchanged", async () => {
    manager.topUp.mockResolvedValue(undefined);
    const host = await createClaimHost(passthrough);
    const outcome = await claimCoins({
      host,
      amountPlanck: 12_500_000n,
      keys: [new Uint8Array([1])],
      topUpId: (n) => deriveTopUpId("pay-4", n),
      sleep: async () => {},
    });
    expect(outcome).toMatchObject({ kind: "claimed", finalized: false, creditedPlanck: 12_500_000n });
  });
});

describe("balance, statements and entropy on codec 2", () => {
  it("forwards the balance as a bigint", async () => {
    manager.subscribeBalance.mockImplementation((cb: (i: { available: bigint }) => void) => {
      cb({ available: 42n });
      return { unsubscribe: vi.fn(), onInterrupt: vi.fn() };
    });
    const seen: bigint[] = [];
    subscribeHostBalance((p) => seen.push(p));
    await tick();
    expect(seen).toEqual([42n]);
  });

  it("asks for the topic as hex and hands payloads back as bytes", async () => {
    store.subscribe.mockImplementation((_filter: unknown, cb: (p: unknown) => void) => {
      cb({ isComplete: true, statements: [{ data: "0x0a0b" }, {}] });
      return { unsubscribe: vi.fn(), onInterrupt: vi.fn() };
    });
    const pages: Array<{ statements: Array<{ data?: Uint8Array }>; isComplete: boolean }> = [];
    subscribeHostStatements(new Uint8Array([0xde, 0xad]), (p) => pages.push(p));
    await tick();
    expect(store.subscribe.mock.calls[0][0]).toEqual({ matchAny: ["0xdead"] });
    expect(pages[0].isComplete).toBe(true);
    expect(Array.from(pages[0].statements[0].data!)).toEqual([0x0a, 0x0b]);
    expect(pages[0].statements[1].data).toBeUndefined();
  });

  it("returns host entropy, and null instead of throwing when the host refuses", async () => {
    sdk.deriveEntropy.mockResolvedValue({ ok: true, value: new Uint8Array([7, 7]) });
    expect(Array.from((await deriveHostEntropy(new Uint8Array(32)))!)).toEqual([7, 7]);
    sdk.deriveEntropy.mockResolvedValue({ ok: false, error: {} });
    expect(await deriveHostEntropy(new Uint8Array(32))).toBeNull();
    sdk.deriveEntropy.mockRejectedValue(new Error("down"));
    expect(await deriveHostEntropy(new Uint8Array(32))).toBeNull();
  });
});

describe("deferredSubscription", () => {
  it("honours an unsubscribe that races ahead of the real subscription", async () => {
    const real = { unsubscribe: vi.fn(), onInterrupt: vi.fn() };
    let resolve!: (s: typeof real) => void;
    const sub = deferredSubscription(() => new Promise((r) => (resolve = r)));
    sub.unsubscribe();
    resolve(real);
    await tick();
    expect(real.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("forwards early interrupt listeners, and reports a failed start through them", async () => {
    const real = { unsubscribe: vi.fn(), onInterrupt: vi.fn() };
    const cb = vi.fn();
    const ok = deferredSubscription(async () => real);
    ok.onInterrupt!(cb);
    await tick();
    expect(real.onInterrupt).toHaveBeenCalledWith(cb);

    const failed = vi.fn();
    const bad = deferredSubscription(async () => {
      throw new Error("no store");
    });
    bad.onInterrupt!(failed);
    await tick();
    expect(failed).toHaveBeenCalledTimes(1);
  });
});
