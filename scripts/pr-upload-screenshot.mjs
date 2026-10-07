#!/usr/bin/env node
// Upload a screenshot to GitHub's user-attachments store (#2558) — `npm run
// pr:upload -- --file pr-screenshots/foo.png [--name shown-name.png]`. The
// upload block the pr-flow skill previously transcribed inline; the returned
// URL is what gets embedded in the PR body or comment.
//
// Two things the inline block learned the hard way, preserved here: the
// upload parameters go in the QUERY STRING — a JSON body fails with "Invalid
// name for request" — and the body is the file's raw bytes. The token comes
// from `gh auth token` and travels only in the Authorization header, never
// in an argv where other processes could read it.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { parseArgs } from "node:util";
import { REPO_SLUG, gh, ghJson } from "./lib/gh.mjs";

const CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

export function parseUploadArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { file: { type: "string" }, name: { type: "string" } },
  });
  if (!values.file) {
    throw new Error("--file <path> is required");
  }
  const name = values.name ?? basename(values.file);
  const contentType = CONTENT_TYPES[extname(name).toLowerCase()];
  if (!contentType) {
    throw new Error(
      `unsupported extension on "${name}" — known: ${Object.keys(CONTENT_TYPES).join(", ")}`,
    );
  }
  return { file: values.file, name, contentType };
}

export async function main(
  argv = process.argv.slice(2),
  spawn = spawnSync,
  fetchFn = globalThis.fetch,
) {
  const { file, name, contentType } = parseUploadArgs(argv);

  const token = gh(spawn, ["auth", "token"]);
  if (token.status !== 0 || !(token.stdout ?? "").trim()) {
    throw new Error("`gh auth token` returned no token — run `gh auth login`");
  }
  const repositoryId = ghJson(spawn, ["api", `repos/${REPO_SLUG}`]).id;
  if (!repositoryId) {
    throw new Error(`could not resolve repository id for ${REPO_SLUG}`);
  }

  const url = new URL("https://uploads.github.com/user-attachments/assets");
  url.searchParams.set("repository_id", String(repositoryId));
  url.searchParams.set("name", name);
  url.searchParams.set("content_type", contentType);

  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `token ${token.stdout.trim()}`,
      "Content-Type": contentType,
    },
    body: readFileSync(file),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(
      `upload failed (${response.status}): ${JSON.stringify(json)}`,
    );
  }
  // The attachment URL's field name has varied — but a success with neither
  // is unusable output, not a hosted URL; reject it rather than print it.
  const hosted = json.url ?? json.href;
  if (!hosted) {
    throw new Error(
      `upload succeeded but returned no url/href: ${JSON.stringify(json)}`,
    );
  }
  console.log(hosted);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
