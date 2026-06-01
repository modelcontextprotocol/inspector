/**
 * Drops the benign "UNRESOLVED_IMPORT" warnings Vite's config bundler (Rolldown)
 * prints at `vite dev` startup for node-only backend deps that the Hono plugin
 * pulls in (`chokidar`, `atomically`, `@napi-rs/keyring`).
 *
 * Why a stream filter and not a Vite hook: the dev backend
 * (`core/mcp/remote/node/server.ts`) is statically imported by the Hono plugin,
 * so loading vite.config.ts bundles it and Rolldown walks its node-only deps.
 * Those deps are correctly externalized (the browser never loads them; Node
 * resolves them at runtime), but Rolldown still warns. The warnings are printed
 * directly to the process streams during config loading — before any Vite
 * logger exists — so `customLogger`, `logLevel`, and `rollupOptions.onwarn` all
 * miss them. Each warning (header + code frame) is emitted as a single write,
 * so we drop any write whose text carries the unresolved-import signature for
 * one of these known-benign (package, source-file) pairs. Installed via
 * `node --import` ahead of the Vite CLI; only affects the dev script.
 *
 * This matcher is tied to Rolldown's current warning format (the `'pkg'` quote
 * style and the repo-relative source path it prints). If these warnings ever
 * reappear, check whether Rolldown changed its message format. The failure mode
 * is safe: a format change just makes the filter a no-op (the warnings return),
 * it never drops anything else.
 */

// (package, source-file) pairs. The file is a repo-relative path fragment — not
// just a basename — so an unrelated future warning that happens to mention the
// same dep and a same-named file isn't silently dropped.
export const BENIGN_PAIRS = [
  ["'chokidar'", "core/mcp/remote/node/server.ts"],
  ["'atomically'", "core/storage/store-io.ts"],
  ["'@napi-rs/keyring'", "core/auth/node/secret-store.ts"],
];

export function isBenignWarning(text) {
  if (!text.includes("UNRESOLVED_IMPORT")) return false;
  return BENIGN_PAIRS.some(
    ([dep, file]) => text.includes(dep) && text.includes(file),
  );
}

function patch(stream) {
  const original = stream.write.bind(stream);
  stream.write = (chunk, encoding, callback) => {
    const text =
      typeof chunk === "string"
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString("utf8")
          : "";
    if (text && isBenignWarning(text)) {
      // Pretend the write succeeded so callers/promises don't stall.
      if (typeof encoding === "function") encoding();
      else if (typeof callback === "function") callback();
      return true;
    }
    return original(chunk, encoding, callback);
  };
}

// Guard so importing this module (e.g. from a unit test for isBenignWarning)
// doesn't monkey-patch the test runner's streams. Under `npm run dev` VITEST is
// unset, so the patch installs as intended.
if (!process.env.VITEST) {
  patch(process.stdout);
  patch(process.stderr);
}
