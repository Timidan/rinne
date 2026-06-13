import test from "node:test";
import assert from "node:assert/strict";
import {
  createApiKey,
  hashApiKey,
  verifyApiKey,
} from "../src/core/api-keys.js";

test("a generated key verifies against its own hash", () => {
  const { plaintext, hash } = createApiKey();
  assert.equal(verifyApiKey(plaintext, hash), true);
});

test("a wrong key fails verification", () => {
  const { hash } = createApiKey();
  const other = createApiKey();
  assert.equal(verifyApiKey(other.plaintext, hash), false);
  assert.equal(verifyApiKey("rinne_live_definitely-not-the-key", hash), false);
});

test("the plaintext key is never equal to its hash", () => {
  // If these were ever equal, persisting the hash would amount to persisting
  // the credential itself.
  const { plaintext, hash } = createApiKey();
  assert.notEqual(plaintext, hash);
});

test("generated keys carry the rinne_live_ prefix with 40+ chars of randomness", () => {
  const { plaintext } = createApiKey();
  assert.ok(plaintext.startsWith("rinne_live_"));
  const randomPart = plaintext.slice("rinne_live_".length);
  assert.ok(
    randomPart.length >= 40,
    `expected at least 40 random characters, got ${randomPart.length}`,
  );
  assert.match(randomPart, /^[0-9a-f]+$/);
});

test("two generated keys differ", () => {
  const a = createApiKey();
  const b = createApiKey();
  assert.notEqual(a.plaintext, b.plaintext);
  assert.notEqual(a.hash, b.hash);
});

test("hashApiKey is deterministic and matches the hash from createApiKey", () => {
  const { plaintext, hash } = createApiKey();
  assert.equal(hashApiKey(plaintext), hash);
  assert.equal(hashApiKey(plaintext), hashApiKey(plaintext));
});

test("verifyApiKey rejects a stored hash of the wrong length instead of throwing", () => {
  const { plaintext } = createApiKey();
  assert.equal(verifyApiKey(plaintext, "deadbeef"), false);
  assert.equal(verifyApiKey(plaintext, ""), false);
});
