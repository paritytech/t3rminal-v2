/**
 * ECIES decryption for the W3S Coinage "cheque" (terminal side).
 *
 * Matches the customer app's one-time-use `CommunicationEncryption` (the SSO
 * ECIES scheme — Polkadot App `CommunicationEncryptionFactory.createOneTimeUse`
 * → `RealCommunicationEncryption` → `MessageEncryption.chaCha20Poly1305`; see
 * codec.ts for the shared wire contract):
 *
 *   shared_secret = X25519(merchantPriv, ephemeralPub)                // 32B, RFC 7748
 *   aead_key      = HKDF-SHA256(IKM=shared_secret, salt=∅, info=∅, L=32)
 *   plaintext     = ChaCha20-Poly1305-open(aead_key, nonce=blob[0..12], blob[12..])
 *
 * No AAD. A low-order ephemeral key (all-zero agreement output) is rejected
 * as RFC-0004 requires — BouncyCastle throws on the sender, noble throws here.
 */
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  decodeW3sEncryptedPayloadV1,
  decodeW3sPaymentDataV1,
  type W3sEncryptedPayloadV1,
  type W3sPaymentDataV1,
} from "./codec";
import { X25519_KEY_BYTES } from "./keys";

export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
/** HKDF output length — the ChaCha20-Poly1305 key. */
const AEAD_KEY_BYTES = 32;
const EMPTY = new Uint8Array(0);

export class EciesError extends Error {
  override readonly name = "EciesError";
}

/**
 * Derive the ChaCha20-Poly1305 key protecting an envelope, given one side's
 * X25519 private key and the counterparty's raw 32-byte public key. Symmetric:
 * works for both the merchant-decrypt and sender-encrypt directions.
 */
export function deriveAeadKey(privKey: Uint8Array, peerPub: Uint8Array): Uint8Array {
  if (privKey.length !== X25519_KEY_BYTES) {
    throw new EciesError(`privKey must be ${X25519_KEY_BYTES} bytes (got ${privKey.length})`);
  }
  if (peerPub.length !== X25519_KEY_BYTES) {
    throw new EciesError(`peer public key must be ${X25519_KEY_BYTES} bytes (got ${peerPub.length})`);
  }

  let sharedSecret: Uint8Array;
  try {
    // noble rejects low-order peer keys instead of returning the all-zero
    // secret — same outcome as the sender's BouncyCastle X25519Agreement.
    sharedSecret = x25519.getSharedSecret(privKey, peerPub);
  } catch (cause) {
    throw new EciesError("X25519 agreement failed (low-order or malformed peer key)", { cause });
  }
  if (sharedSecret.length !== X25519_KEY_BYTES) {
    throw new EciesError(`X25519 shared secret unexpected length: ${sharedSecret.length}`);
  }

  const aeadKey = hkdf(sha256, sharedSecret, EMPTY, EMPTY, AEAD_KEY_BYTES);
  if (aeadKey.length !== AEAD_KEY_BYTES) {
    throw new EciesError(`HKDF output unexpected length: ${aeadKey.length}`);
  }
  return aeadKey;
}

/** Open the nonce-prefixed ChaCha20-Poly1305 blob (`nonce(12) ‖ ciphertext ‖ tag(16)`). */
export function decryptAeadBlob(aeadKey: Uint8Array, blob: Uint8Array): Uint8Array {
  if (aeadKey.length !== AEAD_KEY_BYTES) {
    throw new EciesError(`aeadKey must be ${AEAD_KEY_BYTES} bytes (got ${aeadKey.length})`);
  }
  if (blob.length < NONCE_BYTES + TAG_BYTES) {
    throw new EciesError(
      `encryptedData too short (need ≥${NONCE_BYTES + TAG_BYTES}, got ${blob.length})`,
    );
  }
  const nonce = blob.subarray(0, NONCE_BYTES);
  const cipherAndTag = blob.subarray(NONCE_BYTES);
  try {
    return chacha20poly1305(aeadKey, nonce).decrypt(cipherAndTag);
  } catch (cause) {
    throw new EciesError("ChaCha20-Poly1305 decryption failed (bad key, nonce, or tag)", { cause });
  }
}

/**
 * End-to-end: SCALE-decode the envelope, X25519 against the terminal's private
 * key, ChaCha20-Poly1305 open, SCALE-decode the payload.
 */
export function decryptStatementData(
  merchantPrivKey: Uint8Array,
  envelopeBytes: Uint8Array,
): { envelope: W3sEncryptedPayloadV1; payload: W3sPaymentDataV1 } {
  const envelope = decodeW3sEncryptedPayloadV1(envelopeBytes);
  const aeadKey = deriveAeadKey(merchantPrivKey, envelope.ephemeralPublicKey);
  const plaintext = decryptAeadBlob(aeadKey, envelope.encryptedData);
  const payload = decodeW3sPaymentDataV1(plaintext);
  return { envelope, payload };
}
