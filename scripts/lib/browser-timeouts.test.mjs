/**
 * Pins the invariants of `browser-timeouts.mjs` — a constants module, so what
 * is testable about it is the shape of the values rather than any logic.
 *
 * Worth pinning anyway, because the values are the module's whole contract and
 * a smoke cannot report a bad one. A budget that arrived as `undefined` or a
 * string reaches Playwright as "no timeout" or NaN and a smoke then hangs
 * against the job's own ceiling rather than failing with a cause. And the
 * ordering below IS the semantics documented on each key: the names say what
 * each budget has to absorb, so a `nested` wait outliving its enclosing
 * `roundTrip` one would mean the names had stopped describing the values.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { BROWSER_TIMEOUTS } from "./browser-timeouts.mjs";

test("every budget is a positive finite number of milliseconds", () => {
  const entries = Object.entries(BROWSER_TIMEOUTS);
  assert.ok(entries.length > 0);
  for (const [name, ms] of entries) {
    assert.equal(typeof ms, "number", `${name} is not a number`);
    assert.ok(Number.isFinite(ms) && ms > 0, `${name} is not a usable budget`);
  }
});

test("the object is frozen, so a smoke cannot mutate a shared budget", () => {
  assert.ok(Object.isFrozen(BROWSER_TIMEOUTS));
});

test("the budgets are ordered by what each one has to absorb", () => {
  // Not decoration: the ordering IS the semantics documented on each key. A
  // `nested` wait that outlived its enclosing `roundTrip` one, or a
  // `bestEffort` wait long enough to be felt on every passing run, would mean
  // the names had stopped describing the values.
  assert.ok(BROWSER_TIMEOUTS.bestEffort < BROWSER_TIMEOUTS.nested);
  assert.ok(BROWSER_TIMEOUTS.nested < BROWSER_TIMEOUTS.ui);
  assert.ok(BROWSER_TIMEOUTS.ui < BROWSER_TIMEOUTS.roundTrip);
});
