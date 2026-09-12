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
