#!/usr/bin/env node
// Monthly dependency sweep (#2229), replacing Dependabot's VERSION-UPDATE PRs.
//
// A Dependabot version-update PR carries no issue and no board card — the same
// carve-out from "every PR references an issue" that the security-update flow
// had (that half is `dependabot-alerts.mjs`, #2233, which turned those PRs off
// as well and files an issue per bump from the alerts they leave behind — so
// between them Dependabot opens no PRs against this repo at all, though its
// security ALERTS stay on, since that sweep is what consumes them).
// #2235 removed `.github/dependabot.yml` outright, so Dependabot opens
// no version-update PRs against this repo at all and this script is what
// replaced them.
//
// Once a month it runs `npm outdated` across the root install and every client
// under `clients/*` (each has its own package.json + lockfile — v2 is not a
// workspace), checks every `uses:` ref under `.github/workflows` against that
// action's highest released version, and files or updates ONE tracking issue
// listing everything behind. A maintainer picks what to bump and opens a
// normal PR against `v2/main`; there is no auto-generated PR here at all.
//
// The actions half is here rather than left on Dependabot because the
// `github-actions` entry had exactly the property #2229 exists to remove: it
// opened a grouped monthly PR carrying no `Closes #N` and no board card.
// Deleting that entry without replacing it would have left action versions
// unwatched, and `npm outdated` says nothing about actions — hence the
// separate release lookup below.
//
// The third half is the Dockerfile's base image (#2885). #2833 pinned it by
// its multi-arch index digest through `ARG NODE_IMAGE=<tag>@sha256:…`, which
// makes a rebuild reproducible and also makes the image stop receiving the
// Node patch releases and Debian security fixes that land under that tag. The
// sweep resolves the tag's CURRENT index digest from the Docker Hub registry
// and lists the pin when the two differ. No Docker daemon and no credential is
// involved: an anonymous pull token from `auth.docker.io`, then a `HEAD` on the
// manifest. Nothing else watches it — the daily alerts sweep skips non-npm
// ecosystems on purpose, and Dependabot's version updates are off (#2235).
//
// Idempotent by design: the issue body starts with a fixed HTML marker
// (ISSUE_MARKER below), which is how a second run in the same month finds and
// updates the existing open issue instead of filing a duplicate.
//
// `parseOutdated`, `parseActionRefs`, `parseVersionRef`, `isActionStale`,
// `staleActions`, `highestVersionTag`, `parseDockerBaseImage`,
// `parseDigestHeader`, `buildIssueBody` and `buildClearedBody` are pure.
// `main()` shells out to `npm outdated`, `gh` and `curl`, so it takes its
// spawn function as a parameter (defaulting to the real one) and
// `dependency-refresh.test.mjs` drives it with a fake — covering npm failure,
// create vs. edit, the milestone lookup, the registry lookup's failures and
// both no-op paths. `workflow_dispatch` is a production trigger,
// not a substitute for that (Copilot): the helper-only tests it replaced let a
// non-zero `npm outdated` exit report a clean sweep.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ISSUE_MARKER = "<!-- dependency-refresh:monthly-sweep -->";

/** Installs to check, relative to the repo root, and their npm-outdated label. */
export const INSTALLS = [
  { dir: ".", label: "root" },
  { dir: "clients/web", label: "clients/web" },
  { dir: "clients/cli", label: "clients/cli" },
  { dir: "clients/tui", label: "clients/tui" },
  { dir: "clients/launcher", label: "clients/launcher" },
  { dir: "clients/mcpdo", label: "clients/mcpdo" },
];

/** Where the `uses:` refs this sweep checks live, relative to the repo root. */
export const WORKFLOW_DIR = ".github/workflows";

/** The Dockerfile whose digest-pinned base image this sweep checks (#2885). */
export const DOCKERFILE = "Dockerfile";

/** The build arg that carries the digest-pinned base image (#2833). */
export const BASE_IMAGE_ARG = "NODE_IMAGE";

/**
 * The media types a multi-arch INDEX is served as. The pin is the index
 * digest, so the lookup has to ask for an index: a request that accepts only
 * a single-platform manifest is answered with one platform's digest, which
 * never equals the pin and would report the image stale every month.
 */
export const INDEX_MEDIA_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
];

/**
 * Normalize one install's `npm outdated --json` output.
 *
 * @param {string} json raw stdout from `npm outdated --json` (may be `""` or `"{}"`)
 * @returns {Array<{name: string, current: string, wanted: string, latest: string}>}
 */
export function parseOutdated(json) {
  const trimmed = json.trim();
  if (trimmed === "") return [];
  const parsed = JSON.parse(trimmed);
  return Object.entries(parsed)
    .map(([name, info]) => ({
      name,
      current: info.current ?? "(missing)",
      wanted: info.wanted ?? info.current ?? "?",
      latest: info.latest ?? "?",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A full-length commit SHA, the only immutable form a `uses:` ref can take. */
export const SHA_REF = /^[0-9a-f]{40}$/;

/**
 * Pull every action reference out of one workflow file.
 *
 * Deliberately a line regex rather than a YAML parse: `uses:` is always a
 * scalar on its own line in this repo's workflows, and a real parser would be
 * this script's only dependency. Local (`./…`) and container (`docker://…`)
 * steps are skipped — neither has a releases feed to compare against — as is
 * an unpinned `uses:` with no `@ref` at all.
 *
 * A SHA-pinned ref (#2484) carries the release it was resolved from as a
 * trailing comment — `uses: actions/checkout@<sha> # v7.0.1` — and that comment
 * is returned as `version`. It is the only thing that makes a SHA pin
 * comparable at all: without it `isActionStale` cannot rank the ref, and a
 * pinned action would silently drop out of the sweep that is meant to watch it.
 * The comment is read on a SHA ref only; on a tag ref the tag already says it.
 *
 * @param {string} yaml raw contents of a workflow file
 * @returns {Array<{action: string, ref: string, version?: string}>} in file order, duplicates kept
 */
export function parseActionRefs(yaml) {
  const refs = [];
  for (const line of yaml.split("\n")) {
    const match = /^\s*(?:-\s+)?uses:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/.exec(
      line,
    );
    if (!match) continue;
    const uses = match[1] ?? match[2] ?? match[3];
    if (uses.startsWith("./") || uses.startsWith("docker://")) continue;
    const at = uses.lastIndexOf("@");
    if (at === -1) continue;
    const entry = { action: uses.slice(0, at), ref: uses.slice(at + 1) };
    const comment = /#\s*(v?\d+(?:\.\d+){0,2})\s*$/.exec(line);
    if (SHA_REF.test(entry.ref) && comment) entry.version = comment[1];
    refs.push(entry);
  }
  return refs;
}

/**
 * Split a `v`-prefixed numeric ref into its components, or `null` when it is
 * not one — a SHA pin or a branch name, which a tag comparison cannot rank.
 *
 * @param {string} ref e.g. `v7`, `v7.0`, `7.0.1`
 * @returns {number[] | null}
 */
export function parseVersionRef(ref) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(ref);
  if (!match) return null;
  return match
    .slice(1)
    .filter((part) => part !== undefined)
    .map(Number);
}

/**
 * Is `current` behind `latest`?
 *
 * Compared only to the precision `current` actually specifies, because that is
 * what pinning to it means: `v7` is a moving major tag that GitHub repoints at
 * every `v7.x` release, so `v7` against a latest of `v7.0.1` is up to date and
 * only `v8` makes it stale. An exactly-pinned `v7.0.0` *is* behind `v7.0.1`.
 *
 * @param {string} current the `uses:` ref
 * @param {string} latest the action's latest release tag
 * @returns {boolean} `false` when either side is not a numeric ref
 */
export function isActionStale(current, latest) {
  const from = parseVersionRef(current);
  const to = parseVersionRef(latest);
  if (from === null || to === null) return false;
  for (let i = 0; i < from.length; i++) {
    const other = to[i] ?? 0;
    if (other !== from[i]) return other > from[i];
  }
  return false;
}

/**
 * A SHA pin is compared by the release its comment names, so it is reported as
 * soon as ANY newer release ships — pinning a SHA pins the patch, and a comment
 * of `v7.0.1` says exactly that. It is shown as that release plus the short
 * SHA, which is what a maintainer re-resolves when bumping it.
 *
 * @param {ReturnType<typeof parseActionRefs>} refs every ref found across the workflows
 * @param {Record<string, string | null>} latestByAction latest release tag per action, `null` when unknown
 * @returns {Array<{action: string, current: string, latest: string}>} the stale ones, deduped and sorted
 */
export function staleActions(refs, latestByAction) {
  const stale = new Map();
  for (const { action, ref, version } of refs) {
    const latest = latestByAction[action];
    if (!latest || !isActionStale(version ?? ref, latest)) continue;
    const current = version ? `${version} (\`${ref.slice(0, 7)}\`)` : ref;
    stale.set(`${action}@${ref}`, { action, current, latest });
  }
  return [...stale.values()].sort(
    (a, b) =>
      a.action.localeCompare(b.action) || a.current.localeCompare(b.current),
  );
}

/**
 * Find the digest-pinned base image in a Dockerfile.
 *
 * Throws rather than returning `null` when the line is missing or carries no
 * digest: either means the pin #2833 put there is gone or reshaped, and a
 * sweep that quietly stopped checking it would read as "base image current"
 * forever. Only an official Docker Hub image is understood (`node:22-slim`,
 * i.e. `library/node`), since that is the only registry this lookup talks to;
 * anything else fails loudly for the same reason.
 *
 * @param {string} dockerfile raw contents of the Dockerfile
 * @returns {{image: string, repository: string, tag: string, digest: string}}
 *   `image` is the human form (`node:22-slim`), `repository` the registry path
 *   (`library/node`)
 */
export function parseDockerBaseImage(dockerfile) {
  const line = new RegExp(
    `^\\s*ARG\\s+${BASE_IMAGE_ARG}=(\\S+)\\s*$`,
    "m",
  ).exec(dockerfile);
  if (!line) {
    throw new Error(
      `${DOCKERFILE}: no \`ARG ${BASE_IMAGE_ARG}=\` line — the base-image digest pin (#2833) cannot be checked`,
    );
  }
  const ref = line[1].replace(/^["']|["']$/g, "");
  const match =
    /^([a-z0-9][a-z0-9._-]*):([\w][\w.-]*)@(sha256:[0-9a-f]{64})$/.exec(ref);
  if (!match) {
    throw new Error(
      `${DOCKERFILE}: \`${BASE_IMAGE_ARG}=${ref}\` is not an official Docker Hub \`<image>:<tag>@sha256:<digest>\` reference`,
    );
  }
  const [, name, tag, digest] = match;
  return {
    image: `${name}:${tag}`,
    repository: `library/${name}`,
    tag,
    digest,
  };
}

/**
 * The `Docker-Content-Digest` header out of a raw HTTP header dump, or `null`.
 * Header names are case-insensitive, and `curl -I` follows redirects into a
 * dump holding several responses, so the LAST match is the one that counts.
 *
 * @param {string} headers raw header text from `curl -I`
 * @returns {string | null}
 */
export function parseDigestHeader(headers) {
  let digest = null;
  for (const line of headers.split(/\r?\n/)) {
    const match = /^docker-content-digest:\s*(sha256:[0-9a-f]{64})\s*$/i.exec(
      line,
    );
    if (match) digest = match[1];
  }
  return digest;
}

/** A digest shortened for a table cell: `sha256:` plus the first 12 hex digits. */
function shortDigest(digest) {
  return digest.slice(0, "sha256:".length + 12);
}

/**
 * @param {Array<{label: string, packages: ReturnType<typeof parseOutdated>}>} installs
 * @param {ReturnType<typeof staleActions>} actions
 * @param {{image: string, pinned: string, current: string} | null} baseImage
 *   the Dockerfile base image, only when its pinned digest is stale
 * @returns {string | null} the issue body, or `null` when nothing is behind anywhere
 */
export function buildIssueBody(installs, actions = [], baseImage = null) {
  const withPackages = installs.filter((i) => i.packages.length > 0);
  if (withPackages.length === 0 && actions.length === 0 && baseImage === null)
    return null;

  const sections = withPackages.map(({ label, packages }) => {
    const rows = packages
      .map(
        (p) => `| \`${p.name}\` | ${p.current} | ${p.wanted} | ${p.latest} |`,
      )
      .join("\n");
    return `### \`${label}\`\n\n| Package | Current | Wanted | Latest |\n| --- | --- | --- | --- |\n${rows}`;
  });

  if (actions.length > 0) {
    const rows = actions
      .map((a) => `| \`${a.action}\` | ${a.current} | ${a.latest} |`)
      .join("\n");
    sections.push(
      `### GitHub Actions\n\n| Action | Current | Latest |\n| --- | --- | --- |\n${rows}`,
    );
  }

  if (baseImage !== null) {
    sections.push(
      [
        "### Docker base image",
        "",
        "| Image | Pinned | Current |",
        "| --- | --- | --- |",
        `| \`${baseImage.image}\` | \`${shortDigest(baseImage.pinned)}\` | \`${shortDigest(baseImage.current)}\` |`,
        "",
        `The \`${DOCKERFILE}\`'s \`ARG ${BASE_IMAGE_ARG}\` pin is behind what \`${baseImage.image}\` points at now, so the image is missing whatever Node patch release or Debian security update moved the tag. Bump it to:`,
        "",
        "```",
        `ARG ${BASE_IMAGE_ARG}=${baseImage.image}@${baseImage.current}`,
        "```",
        "",
        "and keep the Node it carries inside the root `package.json` `engines` range.",
      ].join("\n"),
    );
  }

  return [
    ISSUE_MARKER,
    "Routine dependency refresh — `npm outdated`, a workflow `uses:` check and the Dockerfile's base-image digest, run against `v2/main` on a monthly schedule. This sweep replaces Dependabot's version-update PRs (#2229, #2235); its security-update PRs are off too (#2233), and the alerts they used to act on are swept into their own issues daily.",
    "",
    "This is a tracking issue, not a diff: pick what's worth bumping (`wanted` is the safe default; `latest` may cross a major and needs its own judgment call, especially for anything root-declared per [Dependency placement](https://github.com/modelcontextprotocol/inspector/blob/v2/main/AGENTS.md#dependency-placement)) and open a normal PR against `v2/main`.",
    "",
    ...sections,
    "",
    "A second run of this sweep before this issue closes updates this body in place rather than filing a duplicate.",
  ].join("\n");
}

/**
 * The body a still-open tracking issue is rewritten to once every install AND
 * every workflow action is current again. Without it the issue keeps its last
 * table forever and reads as live work that no longer exists (Copilot).
 *
 * It has to speak for both halves of the sweep: once actions are in scope
 * (#2235), npm-only wording here would assert a clean bill of health the sweep
 * never checked, which is the same silent-all-clear shape the rest of this
 * file guards against.
 *
 * The sweep rewrites rather than closes: it deliberately takes no board
 * actions (see the workflow header), and closing an issue whose card a
 * maintainer has already moved would make the board claim work shipped that
 * this script cannot verify shipped. A maintainer closes it.
 *
 * @param {string} isoDate the sweep date, as `YYYY-MM-DD`
 * @returns {string}
 */
export function buildClearedBody(isoDate) {
  return [
    ISSUE_MARKER,
    `Everything this sweep can check is current as of ${isoDate} — no npm package is outdated at the root or in any client, no version-pinned workflow \`uses:\` ref is behind its action's highest release, and the Dockerfile's base-image digest matches what its tag points at.`,
    "",
    "Refs pinned to a commit SHA or a branch are deliberately **not** covered by that statement: neither can be ranked against a release tag, so this sweep says nothing about them either way.",
    "",
    "This issue was filed by an earlier run of the monthly sweep (#2229, #2235) and its tables are gone because nothing they listed is behind any more. Either it was bumped or the ranges caught up; nothing here is outstanding.",
    "",
    "Safe to close. A later sweep that finds something behind will refile this body with fresh tables rather than open a duplicate.",
  ].join("\n");
}

function runOutdated(dir, spawn) {
  const result = spawn("npm", ["outdated", "--json"], {
    cwd: dir,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  // `npm outdated` exits 0 when everything is current and 1 when it finds
  // something outdated — both are successful runs. Every other status is a
  // real failure (a registry or config error exits 2), and it MUST throw
  // rather than fall through: a failed run also prints nothing to stdout, so
  // accepting it parses to an empty package list and reports a clean no-op.
  // With five installs swept in a loop, that turns a total outage into a
  // silent "nothing to do" (Copilot).
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `npm outdated failed in ${dir} (exit ${result.status}): ${(result.stderr ?? "").trim()}`,
    );
  }
  return result.stdout ?? "";
}

function collectActionRefs() {
  return readdirSync(WORKFLOW_DIR)
    .filter((file) => /\.ya?ml$/.test(file))
    .flatMap((file) =>
      parseActionRefs(readFileSync(join(WORKFLOW_DIR, file), "utf8")),
    );
}

/**
 * The highest parseable version among these tags, or `null` if none parse.
 *
 * Deliberately NOT `releases/latest`, which is GitHub's *designated* most
 * recent release rather than the greatest version: an action that ships a
 * maintenance release for an older major (a `v6.9.1` cut after `v8.0.0`) makes
 * `releases/latest` report `v6.9.1`, and a workflow pinned to `v7` would then
 * compare against v6 and read as current — silently missing a whole major
 * upgrade, which is the one thing this check exists to catch (Copilot).
 *
 * @param {string[]} tags release tag names, in any order
 * @returns {string | null}
 */
export function highestVersionTag(tags) {
  let best = null;
  let bestParts = null;
  for (const tag of tags) {
    const parts = parseVersionRef(tag);
    if (parts === null) continue;
    if (bestParts === null || comparePadded(parts, bestParts) > 0) {
      best = tag;
      bestParts = parts;
    }
  }
  return best;
}

/** Compare two version component arrays, padding the shorter with zeroes. */
function comparePadded(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The action's highest released version tag.
 *
 * Reads the release *list* rather than `releases/latest`, for the reason on
 * `highestVersionTag`. Drafts and prereleases are excluded — neither is
 * something a workflow should be told to move to.
 *
 * EVERY page is fetched, not just the newest 100. The list comes back
 * newest-first, which is ordering by release date and not by version: an
 * action that keeps cutting maintenance releases on lower majors pushes the
 * genuine maximum off page 1, and ranking what remains would report a lower
 * major as highest — recreating the exact false-current result that dropping
 * `releases/latest` was meant to prevent (Copilot). Paginating is the only
 * way the "highest released version" this function promises is actually that.
 *
 * @returns {string | null} `null` ONLY for a successful response carrying no
 *   usable release — an action that has never cut one, or whose tags are all
 *   unparseable. A failed lookup is never `null`; see below.
 * @throws on any non-zero status, 404 included
 */
function latestReleaseTag(action, spawn) {
  // `owner/repo/subpath@ref` is a valid `uses:`; releases live on `owner/repo`.
  const repo = action.split("/").slice(0, 2).join("/");
  const result = spawn(
    "gh",
    [
      "api",
      "--paginate",
      `repos/${repo}/releases?per_page=100`,
      "--jq",
      '[.[] | select(.draft == false and .prerelease == false) | .tag_name] | join("\\n")',
    ],
    { encoding: "utf8" },
  );
  if (result.error) throw result.error;
  // EVERY non-zero status is fatal, 404 included. This is the release *list*
  // endpoint, which answers "no releases" with a successful empty array — so a
  // 404 here does not mean "this action cuts no releases", it means the
  // repository is missing or inaccessible, i.e. a `uses:` ref this sweep
  // cannot check at all. Converting that to `null` would silently drop a
  // broken or renamed action from the sweep that replaced Dependabot
  // (Copilot). The empty-array case is already handled by the parse below.
  if (result.status !== 0) {
    throw new Error(
      `release lookup for ${repo} failed (exit ${result.status}): ${(result.stderr ?? "").trim()}`,
    );
  }
  const tags = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return highestVersionTag(tags);
}

/**
 * The index digest the base image's tag points at right now, from the Docker
 * Hub registry API — anonymous, so `GITHUB_TOKEN` is all the workflow needs.
 *
 * `curl` rather than `fetch` so the lookup goes through the same injected
 * spawn as every other external call here and `main()` stays synchronous.
 * The pull token is handed to the second `curl` as a config file on stdin
 * (`-K -`), never in argv: it is an anonymous, read-only token, but a process
 * table is still not where a bearer token belongs.
 *
 * Every failure throws — a non-zero exit, an unparseable token response, a
 * response with no digest header. Any of those read as "no digest" would make
 * a broken lookup indistinguishable from a current pin.
 *
 * @param {{repository: string, tag: string}} base from `parseDockerBaseImage`
 * @returns {string} `sha256:…`
 * @throws on any lookup failure
 */
function currentImageDigest({ repository, tag }, spawn) {
  const tokenUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`;
  const auth = spawn("curl", ["-fsS", "--max-time", "60", tokenUrl], {
    encoding: "utf8",
  });
  if (auth.error) throw auth.error;
  if (auth.status !== 0) {
    throw new Error(
      `Docker Hub token request for ${repository} failed (exit ${auth.status}): ${(auth.stderr ?? "").trim()}`,
    );
  }
  let token;
  try {
    token = JSON.parse(auth.stdout).token;
  } catch {
    token = undefined;
  }
  if (typeof token !== "string" || token === "") {
    throw new Error(
      `Docker Hub token request for ${repository} returned no token`,
    );
  }

  const manifestUrl = `https://registry-1.docker.io/v2/${repository}/manifests/${tag}`;
  const head = spawn(
    "curl",
    [
      "-fsSIL",
      "--max-time",
      "60",
      "-K",
      "-",
      "-H",
      `Accept: ${INDEX_MEDIA_TYPES.join(", ")}`,
      manifestUrl,
    ],
    { encoding: "utf8", input: `header = "Authorization: Bearer ${token}"\n` },
  );
  if (head.error) throw head.error;
  if (head.status !== 0) {
    throw new Error(
      `manifest lookup for ${repository}:${tag} failed (exit ${head.status}): ${(head.stderr ?? "").trim()}`,
    );
  }
  const digest = parseDigestHeader(head.stdout ?? "");
  if (digest === null) {
    throw new Error(
      `manifest lookup for ${repository}:${tag} returned no Docker-Content-Digest header`,
    );
  }
  return digest;
}

/**
 * The base image when its pinned digest is behind its tag, otherwise `null`.
 *
 * @returns {{image: string, pinned: string, current: string} | null}
 */
function staleBaseImage(spawn) {
  const base = parseDockerBaseImage(readFileSync(DOCKERFILE, "utf8"));
  const current = currentImageDigest(base, spawn);
  if (current === base.digest) return null;
  return { image: base.image, pinned: base.digest, current };
}

function findExistingIssue(repo, spawn) {
  const result = spawn(
    "gh",
    [
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--search",
      ISSUE_MARKER,
      "--json",
      "number,body",
      "--limit",
      "10",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`gh issue list failed: ${result.stderr}`);
  }
  const issues = JSON.parse(result.stdout || "[]");
  return issues.find((i) => i.body?.startsWith(ISSUE_MARKER)) ?? null;
}

function currentMilestone(repo, spawn) {
  const result = spawn(
    "gh",
    [
      "api",
      `repos/${repo}/milestones`,
      "--jq",
      'map(select(.state=="open")) | sort_by(.due_on) | .[0].title // empty',
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`milestone lookup failed: ${result.stderr}`);
  }
  return result.stdout.trim() || null;
}

function editIssue(repo, number, body, spawn) {
  const edit = spawn(
    "gh",
    ["issue", "edit", String(number), "--repo", repo, "--body", body],
    { encoding: "utf8" },
  );
  if (edit.status !== 0)
    throw new Error(`gh issue edit failed: ${edit.stderr}`);
}

export function main(repo = process.env.GITHUB_REPOSITORY, spawn = spawnSync) {
  if (!repo) throw new Error("repo not specified (GITHUB_REPOSITORY unset)");

  const installs = INSTALLS.map(({ dir, label }) => ({
    label,
    packages: parseOutdated(runOutdated(dir, spawn)),
  }));

  const refs = collectActionRefs();
  const latestByAction = Object.fromEntries(
    [...new Set(refs.map((r) => r.action))].map((action) => [
      action,
      latestReleaseTag(action, spawn),
    ]),
  );
  const actions = staleActions(refs, latestByAction);
  const baseImage = staleBaseImage(spawn);

  // Look the existing issue up BEFORE branching on `body`: the nothing-
  // behind case still has to reach an open issue to clear it.
  const existing = findExistingIssue(repo, spawn);
  const body = buildIssueBody(installs, actions, baseImage);

  if (body === null) {
    if (!existing) {
      console.log(
        "dependency-refresh: nothing outdated, no stale actions, base image current — no-op",
      );
      return;
    }
    editIssue(
      repo,
      existing.number,
      buildClearedBody(new Date().toISOString().slice(0, 10)),
      spawn,
    );
    console.log(
      `dependency-refresh: nothing behind — cleared stale list on #${existing.number}`,
    );
    return;
  }

  if (existing) {
    editIssue(repo, existing.number, body, spawn);
    console.log(`dependency-refresh: updated existing #${existing.number}`);
    return;
  }

  const milestone = currentMilestone(repo, spawn);
  const args = [
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    "chore(deps): monthly dependency refresh",
    "--label",
    "v2",
    "--label",
    "chore",
    "--label",
    "dependabot",
    "--body",
    body,
  ];
  if (milestone) args.push("--milestone", milestone);

  const create = spawn("gh", args, { encoding: "utf8" });
  if (create.status !== 0)
    throw new Error(`gh issue create failed: ${create.stderr}`);
  if (!milestone) {
    // Unmilestoned means unapproved, so triage sweeps it into `Incoming` — NOT
    // `Todo`, which asserts a maintainer signed off (Copilot).
    console.log(
      "dependency-refresh: no open milestone — issue filed unmilestoned, will be swept into Incoming at next triage",
    );
  }
  console.log(`dependency-refresh: filed ${create.stdout.trim()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
