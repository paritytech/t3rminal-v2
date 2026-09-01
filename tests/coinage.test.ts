/**
 * W3S Coinage terminal-side unit tests.
 *
 * The on-host claim (statement-store subscribe + paymentTopUp) can't run
 * outside the Polkadot app container, but the pieces the terminal owns are
 * pure and pinned here:
 *
 *  1. Amount normalization to the 2dp shape the Android sender emits.
 *  2. Topic derivation == blake2b256("pay-w3s:" || id) (both ends compute
 *     this independently from the deeplink `id`).
 *  3. Deeplink format + Base64URL of the RAW 32-byte X25519 pubkey — the
 *     shape Android's `requireX25519PublicKey()` accepts (PR #973).
 *  4. ChaCha20-Poly1305 framing against the RFC 8439 vector the Android
 *     `ChaCha20Poly1305Test` pins (nonce ‖ ciphertext ‖ tag, no AAD).
 *  5. The headline interop: a fresh terminal keypair round-trips a full ECIES
 *     "cheque" produced the way the customer app produces it
 *     (X25519 → HKDF-SHA256 → ChaCha20-Poly1305) — proving our keygen +
 *     decrypt path agree with the sender on the wire.
 *
 * `deriveEntropy` is mocked so keygen falls back to the browser CSPRNG path
 * (no host bridge in the node test env).
 */

import { describe, expect, it, vi } from "vitest";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { blake2b256 } from "@polkadot-labs/hdkd-helpers";
import {
  decryptAeadBlob,
  decryptStatementData,
  deriveAeadKey,
  EciesError,
} from "@/lib/payments/coinage/ecies";
import {
  CodecError,
  encodeW3sEncryptedPayloadV1,
  encodeW3sPaymentDataV1,
} from "@/lib/payments/coinage/codec";

// No host in the node test env — force the CSPRNG fallback in keys.ts.
vi.mock("@novasamatech/host-api-wrapper", () => ({
  deriveEntropy: () => {
    throw new Error("no host bridge in test");
  },
}));

import { generateEphemeralKeypair, generatePaymentId } from "@/lib/payments/coinage/keys";
import { deriveTopic } from "@/lib/payments/coinage/topic";
import {
  buildPayW3sDeeplink,
  normalizeAmount,
  PAY_W3S_DEEPLINK_BASE,
} from "@/lib/payments/coinage/deeplink";

function base64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hex(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * The customer app's sender side, reproduced from the Android sources:
 * `createOneTimeUse` (fresh X25519 keypair, agreement with the merchant key),
 * `hkdfSha256` (empty salt/info, 32 bytes) and
 * `MessageEncryption.chaCha20Poly1305` (random 12-byte nonce prefixed).
 */
function senderEncrypt(merchantPub: Uint8Array, plaintext: Uint8Array) {
  const ephemeral = x25519.keygen();
  const shared = x25519.getSharedSecret(ephemeral.secretKey, merchantPub);
  const aeadKey = hkdf(sha256, shared, new Uint8Array(0), new Uint8Array(0), 32);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipherAndTag = chacha20poly1305(aeadKey, nonce).encrypt(plaintext);
  return {
    ephemeralPublicKey: ephemeral.publicKey,
    encryptedData: concatBytes(nonce, cipherAndTag),
  };
}

describe("normalizeAmount", () => {
  it("forces exactly two decimal places", () => {
    expect(normalizeAmount("12")).toBe("12.00");
    expect(normalizeAmount("12.5")).toBe("12.50");
    expect(normalizeAmount("12.50")).toBe("12.50");
    expect(normalizeAmount("0")).toBe("0.00");
  });

  it("rejects out-of-range / malformed amounts", () => {
    expect(() => normalizeAmount("10000.01")).toThrow();
    expect(() => normalizeAmount("-1")).toThrow();
    expect(() => normalizeAmount("abc")).toThrow();
  });
});

describe("deriveTopic", () => {
  it("is a deterministic 32-byte blake2b256 of the prefixed id", () => {
    const id = "deadbeef";
    const topic = deriveTopic(id);
    expect(topic.length).toBe(32);

    const expected = blake2b256(
      concatBytes(new TextEncoder().encode("pay-w3s:"), new TextEncoder().encode(id)),
    );
    expect(Array.from(topic)).toEqual(Array.from(expected));

    // Same id → same topic; different id → different topic.
    expect(Array.from(deriveTopic(id))).toEqual(Array.from(topic));
    expect(Array.from(deriveTopic("other"))).not.toEqual(Array.from(topic));
  });
});

describe("buildPayW3sDeeplink", () => {
  it("emits a well-formed deeplink with a Base64URL raw 32-byte X25519 key", async () => {
    const { publicKey } = await generateEphemeralKeypair();
    const url = buildPayW3sDeeplink({
      id: "abc123",
      amount: "3.5",
      publicKey,
    });

    expect(url.startsWith(`${PAY_W3S_DEEPLINK_BASE}?`)).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("id")).toBe("abc123");
    expect(params.get("amount")).toBe("3.50"); // normalized
    // key: unpadded Base64URL, decodes to exactly the 32 raw key bytes
    const key = params.get("key")!;
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = base64urlDecode(key);
    expect(decoded.length).toBe(32);
    expect(Array.from(decoded)).toEqual(Array.from(publicKey));
  });

  it("refuses the old 33-byte compressed secp256r1 key (Android rejects it too)", () => {
    const legacyCompressed = new Uint8Array(33);
    legacyCompressed[0] = 0x02;
    expect(() =>
      buildPayW3sDeeplink({ id: "abc123", amount: "1", publicKey: legacyCompressed }),
    ).toThrow(/32-byte X25519/);
  });
});

describe("generateEphemeralKeypair", () => {
  it("returns 32-byte X25519 keys, consistent and unique per call", async () => {
    const a = await generateEphemeralKeypair();
    const b = await generateEphemeralKeypair();

    expect(a.privateKey.length).toBe(32);
    expect(a.publicKey.length).toBe(32);
    // No SEC1 point prefix — the raw u-coordinate is the whole key.
    expect(Array.from(a.publicKey)).toEqual(Array.from(x25519.getPublicKey(a.privateKey)));
    expect(Array.from(a.privateKey)).not.toEqual(Array.from(b.privateKey));
    expect(Array.from(a.publicKey)).not.toEqual(Array.from(b.publicKey));
  });
});

describe("generatePaymentId", () => {
  it("is non-empty lowercase alphanumeric and unique", () => {
    const id = generatePaymentId();
    expect(id).toMatch(/^[a-z0-9]+$/);
    expect(id.length).toBeGreaterThan(0);
    expect(generatePaymentId()).not.toBe(id);
  });
});

describe("ChaCha20-Poly1305 framing (nonce ‖ ciphertext ‖ tag, no AAD)", () => {
  // RFC 8439 §2.8.2 key/nonce/ciphertext; the tag is the no-AAD tag the Android
  // `ChaCha20Poly1305Test` asserts, so passing here == decrypting what BouncyCastle
  // decrypts on the phone.
  const key = hex("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f");
  const nonce = hex("070000004041424344454647");
  const cipherText = hex(
    "d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d6" +
      "3dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b36" +
      "92ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc" +
      "3ff4def08e4b7a9de576d26586cec64b6116",
  );
  const tag = hex("6a23a4681fd59456aea1d29f82477216");
  const expectedPlaintext = hex(
    "4c616469657320616e642047656e746c656d656e206f662074686520636c6173" +
      "73206f66202739393a204966204920636f756c64206f6666657220796f75206f" +
      "6e6c79206f6e652074697020666f7220746865206675747572652c2073756e73" +
      "637265656e20776f756c642062652069742e",
  );

  it("matches the RFC 8439 vector the Android sender pins", () => {
    const plaintext = decryptAeadBlob(key, concatBytes(nonce, cipherText, tag));
    expect(Array.from(plaintext)).toEqual(Array.from(expectedPlaintext));
  });

  it("fails authentication on a flipped bit or a truncated tag", () => {
    const blob = concatBytes(nonce, cipherText, tag);
    const flipped = blob.slice();
    flipped[12] ^= 0x01;
    expect(() => decryptAeadBlob(key, flipped)).toThrow(EciesError);
    expect(() => decryptAeadBlob(key, blob.subarray(0, blob.length - 1))).toThrow(EciesError);
  });
});

describe("ECIES cheque round-trip (terminal keygen ↔ sender encrypt ↔ receiver decrypt)", () => {
  const original = {
    amount: "3.00",
    timestamp: 1_700_000_000_000n,
    // Coins are 64-byte sr25519 secrets (scalar ‖ nonce), per the Android sender.
    coins: [new Uint8Array(64).fill(7), new Uint8Array(64).fill(9)],
    id: "salexyz",
  };

  it("decrypts a sender-built envelope with the terminal's private key", async () => {
    // Terminal mints the per-sale keypair; the raw pubkey goes in the QR.
    const terminal = await generateEphemeralKeypair();

    // Customer app: fresh ephemeral X25519 key, agreement against the QR key.
    const { ephemeralPublicKey, encryptedData } = senderEncrypt(
      terminal.publicKey,
      encodeW3sPaymentDataV1(original),
    );
    const envelopeBytes = encodeW3sEncryptedPayloadV1({ encryptedData, ephemeralPublicKey });

    // Envelope trailer is the bare 32-byte key — `@FixedLength(32)`, no length prefix.
    expect(Array.from(envelopeBytes.subarray(envelopeBytes.length - 32))).toEqual(
      Array.from(ephemeralPublicKey),
    );

    const { payload } = decryptStatementData(terminal.privateKey, envelopeBytes);

    expect(payload.id).toBe(original.id);
    expect(payload.amount).toBe(original.amount);
    expect(payload.timestamp).toBe(original.timestamp);
    expect(payload.coins).toHaveLength(2);
    expect(payload.coins[0].length).toBe(64);
    expect(Array.from(payload.coins[0])).toEqual(Array.from(original.coins[0]));
  });

  it("derives the same AEAD key on both sides of the agreement", async () => {
    const terminal = await generateEphemeralKeypair();
    const sender = await generateEphemeralKeypair();
    expect(Array.from(deriveAeadKey(sender.privateKey, terminal.publicKey))).toEqual(
      Array.from(deriveAeadKey(terminal.privateKey, sender.publicKey)),
    );
  });

  it("does not open for a different terminal key", async () => {
    const terminal = await generateEphemeralKeypair();
    const other = await generateEphemeralKeypair();
    const { ephemeralPublicKey, encryptedData } = senderEncrypt(
      terminal.publicKey,
      encodeW3sPaymentDataV1(original),
    );
    const envelopeBytes = encodeW3sEncryptedPayloadV1({ encryptedData, ephemeralPublicKey });
    expect(() => decryptStatementData(other.privateKey, envelopeBytes)).toThrow(EciesError);
  });

  it("rejects a low-order ephemeral key instead of using the all-zero secret", async () => {
    const terminal = await generateEphemeralKeypair();
    expect(() => deriveAeadKey(terminal.privateKey, new Uint8Array(32))).toThrow(EciesError);
  });

  it("refuses the legacy 65-byte uncompressed secp256r1 ephemeral key in the envelope", () => {
    const legacy = new Uint8Array(65);
    legacy[0] = 0x04;
    expect(() =>
      encodeW3sEncryptedPayloadV1({ encryptedData: new Uint8Array(28), ephemeralPublicKey: legacy }),
    ).toThrow(CodecError);
  });
});
