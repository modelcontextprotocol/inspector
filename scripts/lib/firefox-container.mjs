/**
 * Run the Firefox engine pass inside the Linux Playwright container on hosts
 * where Playwright's own Firefox cannot launch (#2625).
 *
 * On macOS 27 (Darwin 27) both Playwright Firefox builds tried — rev 1538
 * (Playwright 1.62.1) and rev 1543 (1.63.0) — fail to launch, headless and
 * headed, sandboxed or not. CI does not run the Firefox pass (#2086), so on
 * those hosts the repo had no Firefox signal at all and `local:gate` went red
 * at `smoke:web:firefox` every run, which also cut off `local:storybook`
 * behind it in the `&&` chain.
 *
 * The workaround proven on the 2.10.0 release tree is the same smokes inside
 * `mcr.microsoft.com/playwright:v<pinned>-noble`. Three things about it are
 * load-bearing:
 *
 *   - **The image tag comes from `clients/web/package-lock.json`**, never a
 *     literal here. The container's preinstalled browsers belong to that
 *     Playwright release; a tag that drifted from the lockfile would have the
 *     in-container `playwright install` fetch a second build, or launch one the
 *     pinned client was never tested against.
 *   - **It runs from an export of the working tree, not a bind mount of it.**
 *     The host `node_modules` carry macOS native binaries that cannot load on
 *     Linux, and an in-container `npm install` into a mounted checkout would
 *     overwrite them. The export is the tracked + untracked-not-ignored files,
 *     so it tests what the rest of the gate tests (uncommitted edits included),
 *     where a `git archive HEAD` would quietly test the last commit instead.
 *   - **No Docker skips loudly and exits 0.** A host that cannot launch Firefox
 *     natively and has no container runtime has no way to produce the signal;
 *     failing would only stop the chain before Storybook, which is the outcome
 *     this module exists to remove. The message names #2625 so the skip is
 *     never mistaken for a pass.
 *
 * Retire this when a Playwright release ships a Firefox that launches on
 * macOS 27: bump to it and delete the container path (#2625, step 3).
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** The tracking issue every message here names. */
export const ISSUE = "#2625";

/**
 * Override for the routing decision: `container` forces the container on any
 * host, `native` forces a native launch on any host, and unset or empty
 * leaves the decision to the host check. `native` is how to try a new
 * Playwright build on macOS 27 before retiring this module.
 *
 * Any other value is an error, not a fallthrough — the same fail-closed rule
 * as `SMOKE_BROWSER` (`headless-browser.mjs`). A typo'd `contaner` on Linux
 * would otherwise run natively and report green for a container path that
 * never ran, and a typo'd `native` on macOS 27 would defeat the trial.
 */
export const MODE_ENV = "INSPECTOR_FIREFOX_SMOKE";

/** First Darwin kernel major on which Playwright's Firefox fails to launch. */
const FIRST_UNSUPPORTED_DARWIN = 27;

/**
 * Whether this engine pass must run in the container rather than natively.
 *
 * Only Firefox, and only on Darwin 27+ unless overridden. Earlier macOS hosts
 * launch Playwright's Firefox fine, so routing them through a ~2GB image would
 * be pure cost.
 */
export function shouldUseContainer({ engine, platform, release, env }) {
  const mode = env[MODE_ENV];
  if (mode && mode !== "container" && mode !== "native") {
    throw new Error(
      `unsupported ${MODE_ENV}="${mode}" — expected "native", "container", or unset`,
    );
  }
  if (engine !== "firefox") return false;
  if (mode === "container") return true;
  if (mode === "native") return false;
  if (platform !== "darwin") return false;
  const major = Number.parseInt(String(release).split(".")[0], 10);
  return Number.isInteger(major) && major >= FIRST_UNSUPPORTED_DARWIN;
}

/**
 * The Playwright version `clients/web` resolves, read from its lockfile text.
 *
 * Throws rather than guessing: a missing or malformed entry means the image
 * tag cannot be derived, and a hard-coded fallback is exactly the drift this
 * derivation exists to prevent.
 */
export function pinnedPlaywrightVersion(lockfileText) {
  const lock = JSON.parse(lockfileText);
  const version = lock?.packages?.["node_modules/playwright"]?.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      "clients/web/package-lock.json has no exact node_modules/playwright version",
    );
  }
  return version;
}

/** The Playwright image matching a pinned Playwright version. */
export function playwrightImage(version) {
  return `mcr.microsoft.com/playwright:v${version}-noble`;
}

/**
 * The `docker run` argv for one engine pass over an exported tree.
 *
 * Inside the container the host check sees Linux and launches natively, so
 * this cannot recurse; `MODE_ENV=native` makes that explicit rather than
 * incidental. `--ipc=host` is Playwright's own recommendation for Chromium-
 * family shared memory and harmless for Firefox. `CI` is not forwarded, so the
 * smokes behave as they do on a developer machine.
 *
 * The image runs as root, so on a rootful Linux daemon everything the install
 * and build write into the bind mount is root-owned and the host cannot remove
 * it afterwards. When the caller's `owner` (`uid:gid`) is known, an `EXIT` trap
 * hands the tree back before the container exits — on success or failure — so
 * the host-side cleanup can delete it. Docker Desktop maps ownership itself,
 * where the `chown` is a harmless no-op.
 */
export function dockerRunArgs({ exportDir, image, engine, owner }) {
  const run = `npm install --no-audit --no-fund && npm run build && node scripts/run-engine-smokes.mjs ${engine}`;
  const script = owner ? `trap 'chown -R ${owner} /src' EXIT; ${run}` : run;
  return [
    "run",
    "--rm",
    "--ipc=host",
    "-e",
    `${MODE_ENV}=native`,
    "-v",
    `${exportDir}:/src`,
    "-w",
    "/src",
    image,
    "bash",
    "-lc",
    script,
  ];
}

/**
 * The files to export: tracked plus untracked-not-ignored, minus anything
 * tracked but deleted in the working tree. Parsed from
 * `git ls-files -z -co --exclude-standard` output.
 */
export function exportablePaths(lsFilesOutput, exists) {
  const unique = new Set(lsFilesOutput.split("\0").filter(Boolean));
  return [...unique].filter((path) => exists(path));
}

/** Copy the working tree's exportable files from `repoRoot` into `dest`. */
function exportWorkingTree(repoRoot, dest) {
  const ls = spawnSync("git", ["ls-files", "-z", "-co", "--exclude-standard"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (ls.status !== 0) {
    throw new Error(`git ls-files failed: ${ls.stderr || ls.error?.message}`);
  }
  const paths = exportablePaths(ls.stdout, (p) =>
    existsSync(join(repoRoot, p)),
  );
  for (const path of paths) {
    const from = join(repoRoot, path);
    const to = join(dest, path);
    mkdirSync(dirname(to), { recursive: true });
    if (lstatSync(from).isSymbolicLink()) symlinkSync(readlinkSync(from), to);
    else copyFileSync(from, to);
  }
  return paths.length;
}

/**
 * How long `docker info` may take before the daemon counts as unreachable.
 *
 * Measured on macOS 27 / Docker Desktop: a healthy daemon answers in
 * 0.07–0.12s, while an unreachable remote context (`DOCKER_HOST` pointing at a
 * dead address) took 32s to fail on the CLI's own dial timeout — and a wedged
 * daemon need not fail at all. 10s is ~80x the healthy case and well under
 * the dead-host one, so the gate reaches the loud skip instead of hanging.
 */
export const DOCKER_PROBE_TIMEOUT_MS = 10_000;

/**
 * Whether a Docker daemon answers, and if not, why. `docker info` fails when
 * only the CLI is installed; the timeout bounds a wedged or remote daemon.
 */
export function probeDocker(spawn = spawnSync) {
  const probe = spawn("docker", ["info"], {
    stdio: "ignore",
    timeout: DOCKER_PROBE_TIMEOUT_MS,
  });
  if (probe.error?.code === "ETIMEDOUT") {
    return {
      ok: false,
      reason: `\`docker info\` did not answer within ${DOCKER_PROBE_TIMEOUT_MS / 1000}s`,
    };
  }
  if (probe.error) return { ok: false, reason: probe.error.message };
  if (probe.status !== 0) {
    return { ok: false, reason: "no Docker daemon is reachable" };
  }
  return { ok: true };
}

/** The caller's `uid:gid`, or undefined where POSIX ids do not exist (Windows). */
function hostOwner() {
  return typeof process.getuid === "function" &&
    typeof process.getgid === "function"
    ? `${process.getuid()}:${process.getgid()}`
    : undefined;
}

/**
 * The side effects `runInContainer` performs, injectable so its branches —
 * the no-daemon skip, exit propagation, temp-tree cleanup — are tested
 * without Docker.
 */
export const defaultContainerDeps = {
  probeDocker: () => probeDocker(),
  readLockfile: (repoRoot) =>
    readFileSync(join(repoRoot, "clients/web/package-lock.json"), "utf8"),
  makeTempDir: (engine) =>
    mkdtempSync(join(tmpdir(), `inspector-${engine}-smoke-`)),
  exportWorkingTree,
  runDocker: (args) => spawnSync("docker", args, { stdio: "inherit" }),
  removeDir: (dir) =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 }),
  hostOwner,
  log: console.log,
  warn: console.warn,
  error: console.error,
};

/**
 * Run the engine pass in the container. Returns the exit status to use:
 * the container's status, or 0 on a loud skip when Docker is unavailable.
 */
export function runInContainer(
  { repoRoot, engine, env = process.env },
  deps = {},
) {
  const {
    probeDocker,
    readLockfile,
    makeTempDir,
    exportWorkingTree,
    runDocker,
    removeDir,
    hostOwner,
    log,
    warn,
    error,
  } = { ...defaultContainerDeps, ...deps };
  // A forced run says so; claiming the host cannot launch the engine would be
  // false on, say, a Linux host using the override.
  const banner =
    env[MODE_ENV] === "container"
      ? `run-engine-smokes: ${engine} routed to the container by ${MODE_ENV}=container`
      : `run-engine-smokes: ${engine} cannot launch natively on this host (${ISSUE})`;

  const docker = probeDocker();
  if (!docker.ok) {
    warn(
      [
        "",
        `⚠️  ${banner}, and Docker is unavailable: ${docker.reason}.`,
        `⚠️  SKIPPING the ${engine} engine pass — this is NOT a pass. Start Docker`,
        `⚠️  (or set ${MODE_ENV}=native to try a native launch) and re-run`,
        `⚠️  \`npm run smoke:web:${engine}\` before pushing.`,
        "",
      ].join("\n"),
    );
    return 0;
  }

  const image = playwrightImage(
    pinnedPlaywrightVersion(readLockfile(repoRoot)),
  );
  const exportDir = makeTempDir(engine);
  try {
    const count = exportWorkingTree(repoRoot, exportDir);
    log(`${banner}; running it in ${image} over ${count} exported files`);
    const run = runDocker(
      dockerRunArgs({ exportDir, image, engine, owner: hostOwner() }),
    );
    if (run.error) {
      error(`run-engine-smokes: docker failed: ${run.error.message}`);
      return 1;
    }
    if (run.status !== 0) {
      error(`run-engine-smokes: the ${engine} pass failed inside ${image}`);
    }
    return run.status ?? 1;
  } finally {
    // Best effort: the container wrote node_modules and builds here, and a
    // leftover temp directory is not worth failing a green run over.
    try {
      removeDir(exportDir);
    } catch (err) {
      warn(
        `run-engine-smokes: could not remove ${exportDir}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
