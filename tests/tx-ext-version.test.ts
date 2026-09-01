/**
 * `txExtVersion` for the host `create_transaction` call.
 *
 * Polkadot App ≥ PR #1004 resolves the supplied extensions under this version
 * and rejects any version the runtime's `transactionExtensionsByVersion` map
 * doesn't list. Asset Hub Next / Individuality (metadata v16) offer extrinsic
 * formats [4, 5] but only map key 0 — so the value must be 0, not the
 * wrapper's `max(format)` = 5. Pinned against the real Asset Hub Next metadata
 * snapshot in .papi and via the signer's wire payload.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { enumValue } from "@novasamatech/host-api";
import type { PolkadotSigner } from "polkadot-api";

// The wrapper module boots a sandbox transport on import — not available in
// node. Only its `hostApi` default is touched, and the test injects its own.
vi.mock("@novasamatech/host-api-wrapper", () => ({ hostApi: {} }));

import {
  deriveTxExtVersion,
  selectTxExtVersion,
  V5_GENERAL_TX_EXT_VERSION,
} from "@/lib/host/tx-ext-version";
import { createProductAccountSigner } from "@/lib/host/product-signer";

const ASSET_HUB_NEXT_METADATA = readFileSync(".papi/metadata/paseo_asset_hub.scale");

describe("selectTxExtVersion", () => {
  it("prefers V4 (txExtVersion 0) while the runtime still offers format 4", () => {
    expect(selectTxExtVersion([4, 5])).toBe(0);
    expect(selectTxExtVersion([4])).toBe(0);
  });

  it("uses the general-transaction version only on a V5-only runtime", () => {
    expect(selectTxExtVersion([5])).toBe(V5_GENERAL_TX_EXT_VERSION);
  });

  it("refuses runtimes without a format the host protocol can express", () => {
    expect(() => selectTxExtVersion([])).toThrow(/No extrinsic version/);
    expect(() => selectTxExtVersion([3])).toThrow(/no extrinsic format 4 or 5/);
  });
});

describe("deriveTxExtVersion", () => {
  it("returns 0 for the real Asset Hub Next metadata (formats [4,5], map {0})", () => {
    // The wrapper's `max(formats) === 4 ? 0 : max` yields 5 here — the value
    // the phone rejects. Ours must be 0.
    expect(deriveTxExtVersion(ASSET_HUB_NEXT_METADATA)).toBe(0);
  });
});

describe("createProductAccountSigner", () => {
  const account = { dotNsIdentifier: "t3rminal.dot", derivationIndex: 0, publicKey: new Uint8Array(32).fill(7) };
  const base: PolkadotSigner = {
    publicKey: account.publicKey,
    signTx: async () => { throw new Error("wrapper signTx must not be used"); },
    signBytes: async () => new Uint8Array([9, 9]),
  };
  const genesis = new Uint8Array(32).fill(0xab);
  const signedExtensions = {
    CheckGenesis: { identifier: "CheckGenesis", value: new Uint8Array(0), additionalSigned: genesis },
    CheckNonce: { identifier: "CheckNonce", value: new Uint8Array([4]), additionalSigned: new Uint8Array(0) },
  };

  function fakeApi(result: { ok?: Uint8Array; err?: unknown }) {
    const calls: unknown[] = [];
    return {
      calls,
      createTransaction(request: unknown) {
        calls.push(request);
        return {
          match: <T,>(onOk: (v: unknown) => T, onErr: (e: unknown) => T) =>
            Promise.resolve(result.ok ? onOk(enumValue("v1", result.ok)) : onErr(enumValue("v1", result.err))),
        };
      },
    };
  }

  it("sends txExtVersion 0 for Asset Hub Next and mirrors the wrapper's payload shape", async () => {
    const api = fakeApi({ ok: new Uint8Array([1, 2, 3]) });
    const signer = createProductAccountSigner(account, base, api as never);

    const signed = await signer.signTx(new Uint8Array([0x0a, 0x00]), signedExtensions, ASSET_HUB_NEXT_METADATA, 0);

    expect(Array.from(signed)).toEqual([1, 2, 3]);
    expect(api.calls).toHaveLength(1);
    const request = api.calls[0] as { tag: string; value: Record<string, unknown> };
    expect(request.tag).toBe("v1");
    expect(request.value.txExtVersion).toBe(0);
    expect(request.value.signer).toEqual(["t3rminal.dot", { tag: "Index", value: 0 }]);
    expect(request.value.genesisHash).toBe("0x" + "ab".repeat(32));
    expect(request.value.extensions).toEqual([
      { id: "CheckGenesis", extra: new Uint8Array(0), additionalSigned: genesis },
      { id: "CheckNonce", extra: new Uint8Array([4]), additionalSigned: new Uint8Array(0) },
    ]);
    // publicKey / signBytes still come from the wrapper's signer
    expect(signer.publicKey).toBe(account.publicKey);
    expect(Array.from(await signer.signBytes(new Uint8Array(1)))).toEqual([9, 9]);
  });

  it("surfaces the host's typed error and requires CheckGenesis", async () => {
    const hostErr = { tag: "CreateTransactionErr::Rejected", value: undefined };
    const signer = createProductAccountSigner(account, base, fakeApi({ err: hostErr }) as never);
    await expect(
      signer.signTx(new Uint8Array(2), signedExtensions, ASSET_HUB_NEXT_METADATA, 0),
    ).rejects.toBe(hostErr);

    const noGenesis = createProductAccountSigner(account, base, fakeApi({ ok: new Uint8Array(1) }) as never);
    await expect(
      noGenesis.signTx(new Uint8Array(2), { CheckNonce: signedExtensions.CheckNonce }, ASSET_HUB_NEXT_METADATA, 0),
    ).rejects.toThrow(/genesis hash/);
  });
});
