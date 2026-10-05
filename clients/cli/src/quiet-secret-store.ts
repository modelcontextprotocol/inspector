/**
 * `--quiet` support for the secret-store notices core prints (#2435).
 *
 * `resolveSecretStore()` (core/auth/node/secret-store-selection.ts) picks the
 * store once per process and, when it falls back from the OS keychain or the
 * chosen store has a caveat (e.g. `memory`: "Secrets are not written anywhere
 * …"), announces that with `console.warn`. The web backend and the TUI want
 * that banner every session. A quiet CLI run does not: on a CI box with no
 * keychain it would land on stderr on every HTTP invocation, which is exactly
 * the noise `--quiet` exists to remove.
 *
 * Core caches the resolution, notice included, so resolving it **once, up
 * front, with `console.warn` muted** silences it for the rest of the process
 * with no change to core and no effect on the store that gets selected. The
 * mute lasts only for that one call, at startup, before anything else runs.
 *
 * A rejection is swallowed here on purpose: the cached promise keeps it, so
 * the first real consumer of the store still fails with the real error and
 * routes it through the CLI's error envelope as before.
 */
import { resolveSecretStore } from "@inspector/core/auth/node/secret-store-selection.js";

export async function resolveSecretStoreQuietly(): Promise<void> {
  const warn = console.warn;
  console.warn = () => {};
  try {
    await resolveSecretStore();
  } catch {
    // Re-surfaces from the cached promise at the first real use (see above).
  } finally {
    console.warn = warn;
  }
}
