/**
 * Which bin `npx <package>` / `npm exec <package>` runs, by npm's own rule
 * (#2651).
 *
 * A mirror of `getBinFromManifest` in npm's bundled `libnpmexec`
 * (`lib/get-bin-from-manifest.js`): run the sole bin when every entry points at
 * the same file; otherwise run the bin named after the package's **unscoped**
 * name; otherwise npm fails with "could not determine executable to run".
 *
 * 2.10.0 shipped exactly that failure. Adding `mcpdo` gave the package a second
 * distinct bin, and nothing named `inspector` existed, so the documented
 * `npx @modelcontextprotocol/inspector` stopped working for everyone — while
 * `pack:verify` and every smoke stayed green, because they all invoke the
 * installed bin by name and never ask npm to choose one. This is the offline
 * half of the guard (its test asserts the root manifest); `pack:verify` runs
 * the installed tarball through `npm exec` for the online half.
 *
 * Mirrored rather than imported: `libnpmexec` is npm's internal dependency, not
 * one of ours, and its location depends on how Node was installed.
 */

/**
 * @param {{ name: string, bin?: string | Record<string, string> }} manifest
 * @returns {string | null} the bin name npm would run, or null where npm fails
 */
export function npxDefaultBin(manifest) {
  // npm normalizes a string `bin` to `{ <unscoped name>: <path> }` on publish.
  const name = manifest.name.replace(/^@[^/]+\//, "");
  const bin =
    typeof manifest.bin === "string"
      ? { [name]: manifest.bin }
      : (manifest.bin ?? {});
  const entries = Object.keys(bin);
  if (new Set(Object.values(bin)).size === 1) return entries[0];
  if (bin[name]) return name;
  return null;
}
