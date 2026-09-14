/**
 * Wrap a persist callback so it refreshes derived state after it succeeds.
 *
 * Written for one case (#1950): saving a secret can change what the secrets
 * file *is* — the first save under a newly-set passphrase re-encrypts a
 * pre-existing plaintext file — so the `secretStorage` descriptor behind the
 * settings-modal footer has to be re-fetched afterwards, or the footer keeps
 * reporting the state it had at page load.
 *
 * Lives in `lib/` rather than `utils/`: the combinator itself computes
 * nothing, but what it exists to do is *sequence side effects* — a persist
 * that writes to disk and a refetch that hits the network — which is the
 * `lib` half of the repo's split. Judged the other way at first on the
 * grounds that the function is a pure higher-order one; the rule is about
 * what a module is for, not about whether its own body touches I/O.
 *
 * It exists as a named unit rather than two inline `await …; refresh()` pairs
 * in `App.tsx` because of where the coverage gate can reach. `App.tsx` is
 * deliberately outside the coverage `include` (a ~4.5k-line composition root),
 * so wiring written there is not exercised by anything: the hook's own tests
 * and the modal's own tests can both pass while the callback that connects
 * them is broken, leaving the security footer stale after exactly the write
 * that changed it. Review round 17 of #1950 caught that, after three earlier
 * rounds had each found a defect in this same path.
 *
 * `refresh` runs in a `finally`, **not only on success**, and the first
 * version of this got that wrong on plausible-sounding reasoning: "a persist
 * that threw did not write, so there is nothing new to describe". That is
 * false for this write order. Both persistence paths write the secret store
 * *before* the file — so a rejected disk write can follow a `set` that has
 * already upgraded `secrets.json` from plaintext to encrypted. Skipping the
 * refresh there leaves the footer describing a file that no longer exists in
 * that form, which is the stale-descriptor bug this wrapper exists to
 * prevent, reached through its own error path.
 *
 * The asymmetry is what settles it: refreshing after a failure that changed
 * nothing costs one idempotent GET, while not refreshing after a failure that
 * changed something leaves a security statement wrong until reload.
 */
export function refreshingPersist<Args extends unknown[]>(
  persist: (...args: Args) => Promise<void>,
  refresh: () => void,
): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    try {
      await persist(...args);
    } finally {
      refresh();
    }
  };
}
