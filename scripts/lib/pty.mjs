/**
 * Wrap a command so it runs attached to a pseudoterminal (#2147).
 *
 * `smoke:tui` spawns the Ink TUI with `stdio: ["ignore", …]`, which makes the
 * child's stdin `/dev/null`. Ink mounts `useInput`, `useInput` needs raw mode,
 * and raw mode is a property of the *file descriptor* — so the child threw
 * "Raw mode is not supported on the current process.stdin" and exited 1 about
 * 40ms after painting its first frame, on every machine, TTY or not. A parent
 * cannot assert raw mode on a child's behalf; the fd has to be a terminal.
 *
 * `script(1)` allocates one, with no dependency to install. Measured here on
 * darwin: without it the TUI paints at ~400ms and is dead at ~440ms; with it
 * the same TUI is still running at 6s and never logs the raw-mode error.
 *
 * The invocation differs by flavor, which is why this is a module rather than
 * a string literal at the call site:
 *
 *   BSD (macOS)   script -q /dev/null <cmd> <args...>       argv, no shell
 *   util-linux    script -qec "<cmd args...>" /dev/null     ONE shell string
 *   busybox       script -qc  "<cmd args...>" /dev/null     as above, no -e
 *
 * The `-c` flavors take a single command *string* that the child shell parses,
 * so every word has to be quoted on the way in — an unquoted temp path with a
 * space would otherwise split into two arguments.
 *
 * `-e` (util-linux) makes `script` exit with the child's status rather than its
 * own. busybox has no such flag, so under it a crashed child reports 0. That is
 * survivable and deliberately not worked around: the smoke's assertion is the
 * child's `exit` *event*, not its code — the code only sharpens the diagnostic.
 */

import { spawnSync } from "node:child_process";

/**
 * Platforms whose `script` takes the BSD argv form (`script -q FILE cmd args…`).
 *
 * Deliberately just these two. darwin is verified empirically here; freebsd is
 * where darwin's implementation comes from and shares its usage. **netbsd and
 * openbsd are excluded on purpose** — the BSDs do not agree on this, NetBSD's
 * `script` takes the command through `-c` — and nobody has run either here. A
 * guessed invocation is worse than none: it fails at `script` startup, which
 * this smoke would then report as a TUI crash. They fall through to `null` and
 * the smoke skips, saying so. Adding a `-c` flavor for them is a small change
 * for whoever can actually verify it on the box.
 */
const BSD_PLATFORMS = new Set(["darwin", "freebsd"]);

/**
 * Quote one argument for a POSIX shell command string.
 *
 * Single quotes are literal for everything except a single quote itself, which
 * has to leave the quoted run, emit an escaped quote, and re-enter it.
 *
 * @param {string} arg
 * @returns {string}
 */
export function shellQuote(arg) {
  return `'${String(arg).replaceAll("'", `'\\''`)}'`;
}

/**
 * Decide which `script` flavor to build for.
 *
 * The version output is consulted first because it is the only *evidence*:
 * "linux" does not imply util-linux (Alpine ships busybox, whose `script`
 * rejects `-e`). Platform is the fallback for the case where `script --version`
 * tells us nothing, which is itself informative — BSD `script` has no
 * `--version` and fails the probe.
 *
 * @param {object} opts
 * @param {string} opts.platform          `process.platform`.
 * @param {string} [opts.versionOutput]   Combined stdout+stderr of `script --version`.
 * @returns {"bsd" | "util-linux" | "busybox" | null} null when unsupported.
 */
export function scriptFlavorFor({ platform, versionOutput = "" }) {
  if (/util-linux/i.test(versionOutput)) return "util-linux";
  if (/busybox/i.test(versionOutput)) return "busybox";
  if (BSD_PLATFORMS.has(platform)) return "bsd";
  // Linux with an unidentifiable `script` is overwhelmingly util-linux; guess
  // it rather than skip the smoke. A wrong guess fails loudly with `script`'s
  // own usage error in the captured output, which is diagnosable — silently
  // skipping is the outcome this issue exists to stop rewarding.
  if (platform === "linux") return "util-linux";
  // win32 (no `script(1)` at all), and any platform whose invocation nobody has
  // verified — aix, sunos, netbsd, openbsd. The caller skips loudly rather than
  // guessing. `node-pty` is the portable answer if this ever has to run there.
  return null;
}

/**
 * Build the PTY-wrapped spawn arguments for a command.
 *
 * @param {object} opts
 * @param {string} opts.command
 * @param {string[]} [opts.args]
 * @param {"bsd" | "util-linux" | "busybox"} opts.flavor
 * @returns {{ command: string, args: string[] }}
 */
export function ptyCommand({ command, args = [], flavor }) {
  if (flavor === "bsd") {
    return { command: "script", args: ["-q", "/dev/null", command, ...args] };
  }
  if (flavor === "util-linux" || flavor === "busybox") {
    const line = [command, ...args].map(shellQuote).join(" ");
    const flags = flavor === "util-linux" ? "-qec" : "-qc";
    return { command: "script", args: [flags, line, "/dev/null"] };
  }
  throw new Error(`unknown script(1) flavor: ${flavor}`);
}

/**
 * How long `script --version` gets to exit (#2333).
 *
 * A ceiling on a synchronous spawn, not a sleep: the probe returns the moment
 * the process exits, and `script --version` exits at once on every flavor —
 * BSD `script` with a usage error, util-linux and busybox with a version line.
 * Measured here on darwin, twenty spawns with the machine at load average 4
 * (recent peak 19): 1.3ms median, 3.6ms max. Five seconds is over a thousand
 * times that, and what it has to absorb is process creation on a machine
 * several gates deep, not the command.
 *
 * The number matters less than what its expiry means. `spawnSync` reports a
 * timeout in the same `error` slot as ENOENT, and `probeScriptVersion` used to
 * read both as "no `script(1)`" — so a starved probe turned `smoke:tui` into a
 * documented **skip**, exit 0, with a message blaming the machine's PATH. A
 * false skip on the one pre-push gate is worse than a false failure, which is
 * why the timeout is now told apart and thrown instead (see below).
 */
export const SCRIPT_PROBE_TIMEOUT_MS = 5_000;

/**
 * Probe the local `script(1)`: is it there, and what does it say about itself?
 *
 * **`spawnSync` does not throw on ENOENT** — it *returns* `{ error }` with
 * empty output. So a `try`/`catch` alone cannot tell "no `script` on this box"
 * from "a `script` that printed nothing", and collapsing both to `""` is
 * actively harmful: on linux the empty output falls through to the
 * `util-linux` guess, and `smoke:tui` then hard-fails spawning a binary that
 * does not exist, instead of taking the documented skip. Hence the `available`
 * flag rather than a bare string. The `catch` stays for a runner that really
 * does throw (an injected one, or a future spawn shape).
 *
 * A non-zero exit is NOT unavailability: BSD `script` has no `--version` and
 * answers `illegal option -- -` plus its usage on stderr — which is exactly the
 * evidence `scriptFlavorFor` reads. Only `error` means "could not run it".
 *
 * A **timeout** is not unavailability either, and it is the one `error` that
 * must not be folded into "not available": `script(1)` was found and started,
 * and the machine did not let it finish. Reporting that as "no `script(1)` on
 * PATH" would make `smoke:tui` skip — a green exit on a run that tested
 * nothing — so it throws, naming the budget, and the caller fails loudly.
 *
 * @param {(cmd: string, args: string[]) => { stdout?: string, stderr?: string, error?: Error & { code?: string } }} [runner]
 *   Injected for tests; defaults to a real `spawnSync`.
 * @returns {{ available: boolean, output: string }}
 * @throws {Error} when the probe timed out (`error.code === "ETIMEDOUT"`).
 */
export function probeScriptVersion(
  runner = (cmd, args) =>
    spawnSync(cmd, args, {
      encoding: "utf8",
      timeout: SCRIPT_PROBE_TIMEOUT_MS,
    }),
) {
  let r;
  try {
    r = runner("script", ["--version"]);
  } catch {
    // A runner that throws outright (injected, or a future spawn shape).
    return { available: false, output: "" };
  }
  if (r?.error?.code === "ETIMEDOUT") {
    throw new Error(
      `\`script --version\` did not exit within ${SCRIPT_PROBE_TIMEOUT_MS}ms — ` +
        "a starved or hung probe, not a missing `script(1)`, so smoke:tui " +
        "must not skip on it",
    );
  }
  // `error` covers ENOENT and EACCES; a missing result at all means the runner
  // told us nothing, which is not evidence of a working one.
  if (!r || r.error) return { available: false, output: "" };
  return { available: true, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * Resolve a PTY wrapper for this machine, or say why there isn't one.
 *
 * The two ways it can be unavailable are worth telling apart in the skip
 * message — "you have no `script(1)`" and "nobody has verified this platform's
 * invocation" send the reader somewhere different — so the failure carries a
 * `reason` rather than being a bare `null` the caller has to narrate.
 *
 * A probe that **timed out** is neither — it throws through here untouched,
 * because "the machine would not run `script`" is a failure to report, not a
 * reason to skip (see `probeScriptVersion`).
 *
 * @param {object} [opts]
 * @param {string} [opts.platform]
 * @param {() => { available: boolean, output: string }} [opts.probe]
 * @returns {{ ok: true, flavor: string, wrap: (spec: { command: string, args?: string[] }) => { command: string, args: string[] } }
 *          | { ok: false, reason: string }}
 * @throws {Error} when the probe timed out.
 */
export function resolvePtyWrapper({
  platform = process.platform,
  probe = probeScriptVersion,
} = {}) {
  const { available, output } = probe();
  if (!available) {
    return { ok: false, reason: "no `script(1)` on PATH" };
  }
  const flavor = scriptFlavorFor({ platform, versionOutput: output });
  if (!flavor) {
    return {
      ok: false,
      reason: `no verified \`script(1)\` invocation for ${platform}`,
    };
  }
  return {
    ok: true,
    flavor,
    wrap: ({ command, args = [] }) => ptyCommand({ command, args, flavor }),
  };
}
