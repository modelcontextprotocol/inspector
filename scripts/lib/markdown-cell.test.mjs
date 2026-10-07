import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeTableCell } from "./markdown-cell.mjs";

test("leaves plain text alone", () => {
  assert.equal(escapeTableCell("plain text"), "plain text");
});

test("escapes a pipe so it cannot end the cell", () => {
  assert.equal(escapeTableCell("a|b"), "a\\|b");
});

test("escapes a trailing backslash before a following pipe can pair with it", () => {
  // `abc\` + an escaped pipe must not read as `abc\\|` (a live pipe).
  assert.equal(escapeTableCell("abc\\"), "abc\\\\");
  assert.equal(escapeTableCell("abc\\|d"), "abc\\\\\\|d");
});

test("coerces non-strings", () => {
  assert.equal(escapeTableCell(42), "42");
  assert.equal(escapeTableCell(null), "null");
});

test("every pipe in the output is escaped by an odd run of backslashes", () => {
  for (const input of ["a|b", "a\\|b", "a\\\\|b", "\\", "|", "x\\"]) {
    const out = escapeTableCell(input);
    for (const m of out.matchAll(/(\\*)\|/g)) {
      assert.equal(m[1].length % 2, 1, `${JSON.stringify(input)} → ${out}`);
    }
  }
});
