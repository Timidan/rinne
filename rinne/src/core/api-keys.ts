import { randomBytes, timingSafeEqual } from "node:crypto";
import { sha256Hex } from "./ids.js";

// API key lifecycle for registered agents. The plaintext key is shown exactly
// once at registration; we persist only its SHA-256 hash, so a database leak
// never exposes usable credentials. Verification recomputes the hash from the
// presented key and compares in constant time.

// Recognizable prefix so leaked keys are easy to attribute and scan for
// (secret-scanning tools key off stable prefixes like this).
const API_KEY_PREFIX = "rinne_live_";

// 24 random bytes -> 48 hex characters of entropy (192 bits), comfortably
// past the 40-character minimum and far beyond brute-force reach.
const API_KEY_RANDOM_BYTES = 24;

export function createApiKey(): { plaintext: string; hash: string } {
  const plaintext = `${API_KEY_PREFIX}${randomBytes(API_KEY_RANDOM_BYTES).toString("hex")}`;
  return { plaintext, hash: hashApiKey(plaintext) };
}

export function hashApiKey(plaintext: string): string {
  return sha256Hex(plaintext);
}

// Constant-time verification: hash the presented key, then compare hex
// digests with timingSafeEqual so an attacker cannot learn digest prefixes
// through response timing. timingSafeEqual throws on unequal lengths, so we
// guard that case first — the stored digest's length is not a secret.
export function verifyApiKey(plaintext: string, hash: string): boolean {
  const presented = Buffer.from(hashApiKey(plaintext), "utf8");
  const stored = Buffer.from(hash, "utf8");
  if (presented.length !== stored.length) {
    return false;
  }
  return timingSafeEqual(presented, stored);
}
