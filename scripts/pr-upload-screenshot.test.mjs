// Tests for scripts/pr-upload-screenshot.mjs (#2558) — the content-type map,
// the query-string parameter placement (a JSON body fails upstream), the raw
// bytes body, and the header-only token. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, parseUploadArgs } from "./pr-upload-screenshot.mjs";

test("parseUploadArgs maps extensions and honors --name", () => {
  assert.deepEqual(parseUploadArgs(["--file", "shots/connect.png"]), {
    file: "shots/connect.png",
    name: "connect.png",
    contentType: "image/png",
  });
  assert.equal(
    parseUploadArgs(["--file", "a.png", "--name", "demo.mp4"]).contentType,
    "video/mp4",
  );
  assert.throws(() => parseUploadArgs(["--file", "notes.txt"]), /unsupported/);
  assert.throws(() => parseUploadArgs([]), /--file/);
});

function spawnScript() {
  return (cmd, args) => {
    const joined = args.join(" ");
    if (joined === "auth token") {
      return { status: 0, stdout: "gho_secret\n", stderr: "" };
    }
    if (joined.includes("repos/")) {
      return { status: 0, stdout: JSON.stringify({ id: 4242 }), stderr: "" };
    }
    assert.fail(`unexpected gh call: ${joined}`);
  };
}

test("main uploads raw bytes with query-string params and prints the URL", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pr-upload-test-"));
  const file = join(dir, "proof.png");
  writeFileSync(file, Buffer.from([1, 2, 3]));

  let request;
  const fetchFn = async (url, init) => {
    request = { url: new URL(url), init };
    return {
      ok: true,
      status: 201,
      json: async () => ({ url: "https://x/a.png" }),
    };
  };
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  await main(["--file", file], spawnScript(), fetchFn);

  assert.deepEqual(lines, ["https://x/a.png"]);
  assert.equal(request.url.searchParams.get("repository_id"), "4242");
  assert.equal(request.url.searchParams.get("name"), "proof.png");
  assert.equal(request.url.searchParams.get("content_type"), "image/png");
  assert.equal(request.init.headers.Authorization, "token gho_secret");
  assert.deepEqual([...request.init.body], [1, 2, 3]);
});

test("main throws on an upload rejection with the response body", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pr-upload-test-"));
  const file = join(dir, "proof.png");
  writeFileSync(file, Buffer.from([1]));
  await assert.rejects(
    main(["--file", file], spawnScript(), async () => ({
      ok: false,
      status: 422,
      json: async () => ({ message: "Invalid name for request" }),
    })),
    /upload failed \(422\).*Invalid name/,
  );
});

test("main throws when gh has no token", async () => {
  await assert.rejects(
    main(["--file", "x.png"], (cmd, args) =>
      args.join(" ") === "auth token"
        ? { status: 1, stdout: "", stderr: "not logged in" }
        : assert.fail("nothing else should run"),
    ),
    /no token/,
  );
});
