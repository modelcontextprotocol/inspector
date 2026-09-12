/**
 * The one assertion every Vitest project in this repo runs before each test.
 *
 * **`retry` must stay unset** (#2323). A retry converts a load-induced red into
 * a silent green on the only pre-push gate this repo has, and would re-open
 * #1596 by hiding a real race behind a second attempt.
 *
 * ⚠️ This is a *runtime* check, and that is the whole point. An earlier
 * revision of #2334 enforced the same rule by scanning source text for
 * `it("…", { retry: 2 })`, and the review found a new valid JavaScript spelling
 * it missed in five consecutive rounds — a trailing comment, nested parens in
 * `it.each([makeCase()])`, a member-access prefix, the shorthand `{ retry }`, an
 * aliased import, a non-literal title. Each fix was correct and each made the
 * scanner more parser-shaped, until it had eight helpers doing quote tracking
 * and bracket balancing. That is a parser, badly, in a linter.
 *
 * `ctx.task.retry` is the value Vitest actually resolved for this test, so it
 * needs no spelling to be anticipated and cannot be outrun by a new one. It also
 * covers strictly more than the scan ever did: a per-test option, a `describe`
 * option inherited by its children, a project-level `retry`, and a `--retry`
 * flag on the command line all arrive here as the same number.
 *
 * The general lesson, worth keeping: when a rule is about what the code *does*,
 * ask the runtime; reading the source is a guess that has to be right about
 * every way the language can express the same thing.
 */

import { beforeEach } from "vitest";

beforeEach((ctx) => {
  const { retry } = ctx.task;
  if (typeof retry === "number" && retry > 0) {
    throw new Error(
      `"${ctx.task.name}" declares retry: ${retry}. Retries are not used in ` +
        `this repo (#2323): a retry turns a load-induced red into a silent ` +
        `green on the only pre-push gate there is, which is how a real race ` +
        `ships (#1596). Fix the test — fake timers, an awaited condition — or ` +
        `raise the shared budget in vitest.shared.mts if it is genuinely slow.`,
    );
  }
});
