// Shared `gh` invocation helpers for the maintainer-workflow scripts (#2558):
// `pr-review-request.mjs`, `pr-review-wait.mjs`, `pr-review-fetch.mjs` and
// `board-card-status.mjs`. Those scripts replace command blocks that the
// pr-flow and board-ops skills previously transcribed inline, so the failure
// modes the skills could only warn about in prose are handled here once,
// under test.
//
// Every function takes its spawn function as a parameter (callers default it
// to `spawnSync`), the same injectability pattern `dependabot-alerts.mjs` and
// `dependency-refresh.mjs` set, so orchestration is testable without starting
// a `gh` process. Auth is `gh`'s own — nothing here sees a token.

export const OWNER = "modelcontextprotocol";
export const REPO = "inspector";
export const REPO_SLUG = `${OWNER}/${REPO}`;

/**
 * Run `gh` with the given args. Throws only on spawn failure (gh not
 * installed); a non-zero exit is the caller's to interpret via the result.
 */
export function gh(spawn, args) {
  const result = spawn("gh", args, { encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  return result;
}

/**
 * Run `gh` and parse its stdout as JSON, throwing on a non-zero exit with the
 * stderr in the message. An API/auth failure must throw rather than read as an
 * empty result — the pr-flow skill's wait loop documents why: an error
 * swallowed into a zero makes a background wait retry blind forever.
 */
export function ghJson(spawn, args) {
  const result = gh(spawn, args);
  if (result.status !== 0) {
    throw new Error(
      `gh ${args.join(" ")} failed (${result.status}): ${(result.stderr ?? "").trim()}`,
    );
  }
  return JSON.parse(result.stdout);
}

/**
 * Fetch a paginated REST list endpoint completely.
 *
 * ⚠️ `--slurp` is load-bearing (same note as `dependabot-alerts.mjs`): without
 * it `gh api --paginate` concatenates one JSON array per page into invalid
 * JSON. With it the output is an array of pages, flattened here.
 */
export function ghPaginatedList(spawn, path) {
  const pages = ghJson(spawn, ["api", "--paginate", "--slurp", path]);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error(`unexpected non-list response from ${path}`);
  }
  return pages.flat();
}

/**
 * Run a GraphQL query/mutation. `fields` values are passed with `-F` for
 * numbers (typed as Int) and `-f` for strings, matching how the skills' inline
 * blocks passed them.
 */
export function ghGraphql(spawn, query, fields = {}) {
  const args = ["api", "graphql"];
  for (const [name, value] of Object.entries(fields)) {
    args.push(
      typeof value === "number" ? "-F" : "-f",
      `${name}=${String(value)}`,
    );
  }
  args.push("-f", `query=${query}`);
  return ghJson(spawn, args);
}

/**
 * Parse a `--flag`-style value as a positive integer, throwing a usage-shaped
 * error naming the flag — shared by every script's argv validation.
 */
export function requirePositiveInt(value, flag) {
  if (value === undefined || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(
      `${flag} must be a positive integer (got ${value ?? "nothing"})`,
    );
  }
  return Number(value);
}
