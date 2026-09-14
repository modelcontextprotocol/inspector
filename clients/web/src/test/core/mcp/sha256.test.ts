import { describe, it, expect } from "vitest";
import { sha256Bytes } from "@inspector/core/mcp/sha256";
import { sha256Digest, textToBytes } from "@inspector/core/mcp/skills";

const hex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/**
 * The fallback exists because `crypto.subtle` is absent in a non-secure
 * context, and the web client is documented as servable over plain HTTP on a
 * LAN IP. So it is checked two ways: against the published FIPS 180-4 vectors,
 * and differentially against WebCrypto — "it agrees with the real thing" is the
 * property that matters, and it is asserted rather than assumed.
 */
describe("sha256Bytes (the non-secure-context fallback)", () => {
  it("matches the FIPS 180-4 vector for the empty message", () => {
    expect(hex(sha256Bytes(new Uint8Array()))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the FIPS 180-4 vector for 'abc'", () => {
    expect(hex(sha256Bytes(textToBytes("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches the FIPS 180-4 two-block vector", () => {
    expect(
      hex(
        sha256Bytes(
          textToBytes(
            "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
          ),
        ),
      ),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("agrees with WebCrypto across the block boundaries", async () => {
    // 55/56/63/64/65 bracket the padding cases: the last block that still fits
    // its length field, the one that forces an extra block, and the exact
    // multiple of 64.
    for (const length of [0, 1, 55, 56, 63, 64, 65, 200, 1000]) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) bytes[i] = (i * 7 + 13) % 256;
      const reference = new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes),
      );
      expect(hex(sha256Bytes(bytes))).toBe(hex(reference));
    }
  });

  it("hashes only the view, not its whole backing buffer", () => {
    const backing = new Uint8Array([0xff, ...textToBytes("abc"), 0xff]);
    expect(hex(sha256Bytes(backing.subarray(1, 4)))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("sha256Digest without crypto.subtle", () => {
  it("falls back rather than throwing, and returns the same digest", async () => {
    // Exactly the shape a plain-HTTP LAN page presents: `crypto` exists,
    // `crypto.subtle` does not. Before the fallback this threw for every file
    // and the UI reported a read failure for a file it had fetched fine.
    const withSubtle = await sha256Digest(textToBytes("abc"));
    const real = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: { getRandomValues: real.getRandomValues.bind(real) },
      });
      expect(globalThis.crypto.subtle).toBeUndefined();
      await expect(sha256Digest(textToBytes("abc"))).resolves.toBe(withSubtle);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: real,
      });
    }
  });
});
