/**
 * `txExtVersion` for the host's `create_transaction` call.
 *
 * The field is the **transaction-extension** version the host must decode the
 * supplied extension values under — not the extrinsic *format* version (4/5).
 * For a V4 extrinsic it is a fixed `0`; a V5 general transaction carries a
 * version that must exist in the runtime's `transactionExtensionsByVersion`
 * map (metadata v16), which hosts and runtimes agree is `5`.
 *
 * `@novasamatech/host-api-wrapper` (≤ 0.10.0) derives it as
 * `max(formatVersions) === 4 ? 0 : max(formatVersions)` — on Asset Hub Next /
 * Individuality (formats `[4, 5]`, map `{0}`) that sends `5`, which the
 * Polkadot App rejects since PR #1004 ("Transaction extension version 5 is not
 * supported by runtime"). This mirrors the corrected `@parity/product-sdk-host`
 * 0.18.0 logic (host-rust-core#528): prefer V4 while offered.
 */

import { decAnyMetadata, unifyMetadata } from "@polkadot-api/substrate-bindings";

/** Transaction-extension version hosts/runtimes use for V5 general transactions. */
export const V5_GENERAL_TX_EXT_VERSION = 5;

export function selectTxExtVersion(formatVersions: readonly number[]): number {
  if (formatVersions.length === 0) {
    throw new Error("No extrinsic version found in metadata");
  }
  if (formatVersions.includes(4)) return 0;
  if (formatVersions.includes(5)) return V5_GENERAL_TX_EXT_VERSION;
  throw new Error(
    `Runtime offers no extrinsic format 4 or 5 (offers: ${formatVersions.join(", ")}); ` +
      "the host protocol has no txExtVersion for it.",
  );
}

/** Derive from the SCALE metadata PAPI hands to `PolkadotSigner.signTx`. */
export function deriveTxExtVersion(metadata: Uint8Array): number {
  const { version } = unifyMetadata(decAnyMetadata(metadata)).extrinsic;
  return selectTxExtVersion(Array.isArray(version) ? version : [version]);
}
