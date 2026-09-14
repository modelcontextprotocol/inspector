/**
 * A dependency-free SHA-256, used when `crypto.subtle` is unavailable.
 *
 * ⚠️ **This is not an optimization — it is what makes digest verification work
 * at all in a documented deployment.** `SubtleCrypto` is exposed only in a
 * [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts),
 * and `clients/web/README.md#hosting-on-a-network` documents serving the
 * Inspector over plain HTTP on a LAN IP (`HOST=192.168.1.50`). A browser there
 * has `globalThis.crypto` but **no** `crypto.subtle`, so every skill-file
 * verification would throw and the UI would report a read failure for files
 * that were fetched perfectly well (#2234).
 *
 * `crypto.subtle` is still preferred wherever it exists — see `sha256Digest` in
 * `skills.ts`. This is the fallback, and it is exercised directly by its own
 * tests against the published FIPS 180-4 vectors plus a differential check
 * against WebCrypto, so "it agrees with the real thing" is asserted rather than
 * assumed.
 *
 * The implementation is the standard FIPS 180-4 construction; it is short
 * enough that adding a dependency for it would cost more than it saves, and
 * per [Dependency placement] a new runtime dependency here would have to be
 * declared at the repo root and threaded through three bundler `external`
 * lists.
 */

/** SHA-256 round constants: the first 32 bits of the fractional parts of the
 *  cube roots of the first 64 primes (FIPS 180-4 §4.2.2). */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Initial hash value: fractional parts of the square roots of the first eight
 *  primes (FIPS 180-4 §5.3.3). */
const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/**
 * The raw 32-byte SHA-256 digest of `bytes`.
 *
 * Operates on a copy of the view's own range, so a `Uint8Array` that is a
 * window into a larger buffer hashes only what it spans — the same guarantee
 * the WebCrypto path makes.
 */
export function sha256Bytes(bytes: Uint8Array): Uint8Array {
  const message = new Uint8Array(bytes);
  const bitLength = message.length * 8;
  // Padded length: message + the mandatory 0x80 byte + zeros + a 64-bit length,
  // rounded up to a whole number of 64-byte blocks.
  const withLength = message.length + 9;
  const padded = new Uint8Array(Math.ceil(withLength / 64) * 64);
  padded.set(message);
  padded[message.length] = 0x80;

  const view = new DataView(padded.buffer);
  // The length field is 64 bits. A message long enough to overflow the low 32
  // would be 512 MiB, well past the extension's 16 MiB per-skill limit, but the
  // high word is written correctly rather than assumed zero.
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const h = new Uint32Array(H0);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const digest = new Uint8Array(32);
  const out = new DataView(digest.buffer);
  for (let i = 0; i < 8; i += 1) out.setUint32(i * 4, h[i]);
  return digest;
}
