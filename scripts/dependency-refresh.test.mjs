// Unit tests for the pure parsing/formatting halves of dependency-refresh.mjs
// (#2229). The impure half (`main()`, which shells out to `npm` and `gh`) is
// exercised only via `workflow_dispatch` in CI, per the same split
// `verify-skills.mjs` uses. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildIssueBody,
  parseOutdated,
  ISSUE_MARKER,
} from "./dependency-refresh.mjs";

test("parseOutdated returns [] for empty npm-outdated output", () => {
  assert.deepEqual(parseOutdated(""), []);
  assert.deepEqual(parseOutdated("{}"), []);
});

test("parseOutdated normalizes and sorts entries by name", () => {
  const json = JSON.stringify({
    zod: { current: "3.0.0", wanted: "3.1.0", latest: "4.0.0" },
    ajv: { current: "8.0.0", wanted: "8.0.0", latest: "8.1.0" },
  });
  assert.deepEqual(parseOutdated(json), [
    { name: "ajv", current: "8.0.0", wanted: "8.0.0", latest: "8.1.0" },
    { name: "zod", current: "3.0.0", wanted: "3.1.0", latest: "4.0.0" },
  ]);
});

test("parseOutdated falls back when a field is missing", () => {
  const json = JSON.stringify({ pkg: { current: "1.0.0" } });
  assert.deepEqual(parseOutdated(json), [
    { name: "pkg", current: "1.0.0", wanted: "1.0.0", latest: "?" },
  ]);
});

test("buildIssueBody returns null when every install is up to date", () => {
  assert.equal(
    buildIssueBody([
      { label: "root", packages: [] },
      { label: "clients/web", packages: [] },
    ]),
    null,
  );
});

test("buildIssueBody starts with the idempotency marker and skips empty installs", () => {
  const body = buildIssueBody([
    { label: "root", packages: [] },
    {
      label: "clients/web",
      packages: [
        { name: "zod", current: "3.0.0", wanted: "3.1.0", latest: "4.0.0" },
      ],
    },
  ]);
  assert.ok(body.startsWith(ISSUE_MARKER));
  assert.ok(body.includes("### `clients/web`"));
  assert.ok(!body.includes("### `root`"));
  assert.ok(body.includes("| `zod` | 3.0.0 | 3.1.0 | 4.0.0 |"));
});
