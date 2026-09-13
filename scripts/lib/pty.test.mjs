import { strict as assert } from "node:assert";
import test from "node:test";

import {
  ptyCommand,
  probeScriptVersion,
  SCRIPT_PROBE_TIMEOUT_MS,
  resolvePtyWrapper,
  scriptFlavorFor,
  shellQuote,
} from "./pty.mjs";

// The flavors are not interchangeable: BSD `script` takes argv after the
// typescript file, util-linux takes ONE shell string before it, and busybox
// takes that string without `-e`. Getting it wrong is not a subtle failure —
// `script` refuses to start, and the smoke reports it as a TUI crash.
test("scriptFlavorFor prefers the version probe over the platform", () => {
  assert.equal(
    scriptFlavorFor({
      platform: "linux",
      versionOutput: "script from util-linux 2.39.3",
    }),
    "util-linux",
  );
  assert.equal(
    scriptFlavorFor({
      platform: "linux",
      versionOutput: "BusyBox v1.36.1 (2024-01-01) multi-call binary.",
    }),
    "busybox",
  );
  // Alpine is the reason the probe exists at all: "linux" does not imply
  // util-linux, and busybox's `script` rejects `-e`.
  assert.notEqual(
    scriptFlavorFor({ platform: "linux", versionOutput: "BusyBox v1.36.1" }),
    "util-linux",
  );
});

test("scriptFlavorFor falls back to the platform when the probe says nothing", () => {
  // BSD `script` has no --version, so failing the probe is itself the signal.
  assert.equal(scriptFlavorFor({ platform: "darwin" }), "bsd");
  assert.equal(scriptFlavorFor({ platform: "freebsd" }), "bsd");
  // NOT every BSD: NetBSD takes the command through `-c`, and nobody has run
  // either it or OpenBSD here. Guessing builds an invocation that fails at
  // `script` startup, which this smoke would then report as a TUI crash.
  assert.equal(scriptFlavorFor({ platform: "netbsd" }), null);
  assert.equal(scriptFlavorFor({ platform: "openbsd" }), null);
  // An unidentifiable `script` on linux is overwhelmingly util-linux. Guess it:
  // a wrong guess fails loudly with `script`'s own usage error in the captured
  // output, whereas skipping is the silence this issue exists to stop.
  assert.equal(scriptFlavorFor({ platform: "linux" }), "util-linux");
});

test("scriptFlavorFor returns null where there is no verified invocation", () => {
  assert.equal(scriptFlavorFor({ platform: "win32" }), null);
  assert.equal(
    scriptFlavorFor({ platform: "win32", versionOutput: "not a thing" }),
    null,
  );
  // Unsupported is the default, not a win32 special case.
  assert.equal(scriptFlavorFor({ platform: "aix" }), null);
  assert.equal(scriptFlavorFor({ platform: "sunos" }), null);
});

test("ptyCommand builds the BSD argv form", () => {
  assert.deepEqual(
    ptyCommand({
      command: "/bin/node",
      args: ["app.js", "--x"],
      flavor: "bsd",
    }),
    {
      command: "script",
      args: ["-q", "/dev/null", "/bin/node", "app.js", "--x"],
    },
  );
});

test("ptyCommand builds the util-linux shell-string form with -e", () => {
  // -e is what makes `script` exit with the child's status instead of its own.
  assert.deepEqual(
    ptyCommand({
      command: "/bin/node",
      args: ["app.js"],
      flavor: "util-linux",
    }),
    {
      command: "script",
      args: ["-qec", "'/bin/node' 'app.js'", "/dev/null"],
    },
  );
});

test("ptyCommand omits -e for busybox, which has no such flag", () => {
  const { args } = ptyCommand({
    command: "node",
    args: ["app.js"],
    flavor: "busybox",
  });
  assert.equal(args[0], "-qc");
  assert.deepEqual(args, ["-qc", "'node' 'app.js'", "/dev/null"]);
});

test("ptyCommand quotes arguments for the shell-string flavors", () => {
  // The smoke passes an mkdtemp path; a space in it would otherwise split into
  // two arguments inside the shell `script -c` runs.
  const { args } = ptyCommand({
    command: "/usr/local/my node/bin/node",
    args: ["/tmp/a dir/catalog.json", "it's-fine"],
    flavor: "util-linux",
  });
  assert.equal(
    args[1],
    `'/usr/local/my node/bin/node' '/tmp/a dir/catalog.json' 'it'\\''s-fine'`,
  );
});

test("shellQuote survives an embedded single quote", () => {
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
  assert.equal(shellQuote("plain"), "'plain'");
});

test("probeScriptVersion combines both streams and reads a runner failure as unavailable", () => {
  assert.deepEqual(
    probeScriptVersion(() => ({ stdout: "out ", stderr: "err" })),
    { available: true, output: "out err" },
  );
  // A non-zero exit is NOT unavailability. BSD `script` has no `--version` and
  // answers with `illegal option -- -` plus its usage on stderr — which is the
  // very evidence the flavor fallback reads, so it must survive the probe.
  assert.deepEqual(
    probeScriptVersion(() => ({
      status: 1,
      stdout: "",
      stderr: "script: illegal option -- -\nusage: script [-aeFkpqr] ...",
    })),
    {
      available: true,
      output: "script: illegal option -- -\nusage: script [-aeFkpqr] ...",
    },
  );
  // A runner that throws outright (injected, or a future spawn shape).
  assert.deepEqual(
    probeScriptVersion(() => {
      throw new Error("ENOENT");
    }),
    { available: false, output: "" },
  );
  // Told nothing at all is not evidence of a working `script`.
  assert.deepEqual(
    probeScriptVersion(() => undefined),
    {
      available: false,
      output: "",
    },
  );
});

// `spawnSync` REPORTS ENOENT in `result.error` — it does not throw — so a
// try/catch alone reads a missing binary as "ran, printed nothing". On linux
// that empty output falls through to the util-linux guess, and `smoke:tui`
// hard-fails spawning a binary that does not exist instead of skipping.
test("probeScriptVersion treats result.error as unavailable, not as empty output", () => {
  const enoent = Object.assign(new Error("spawnSync script ENOENT"), {
    code: "ENOENT",
  });
  assert.deepEqual(
    probeScriptVersion(() => ({ error: enoent, stdout: "", stderr: "" })),
    { available: false, output: "" },
  );
  // An `error` with no recognisable code is still "could not run it".
  assert.equal(
    probeScriptVersion(() => ({ error: new Error("EACCES") })).available,
    false,
  );
});

// The one `error` that must NOT read as unavailable (#2333). `script(1)` was
// found and started; the machine did not let it finish. Folded into
// `available: false` it becomes a `smoke:tui` SKIP — exit 0, blaming PATH — on
// exactly the loaded machine the gate is supposed to be believable on.
test("probeScriptVersion throws on a timed-out probe instead of reporting no script(1)", () => {
  const timedOut = Object.assign(new Error("spawnSync script ETIMEDOUT"), {
    code: "ETIMEDOUT",
  });
  assert.throws(
    () =>
      probeScriptVersion(() => ({ error: timedOut, stdout: "", stderr: "" })),
    new RegExp(`did not exit within ${SCRIPT_PROBE_TIMEOUT_MS}ms`),
  );
  // And it reaches the caller: resolvePtyWrapper must not turn it into a skip.
  assert.throws(
    () =>
      resolvePtyWrapper({
        platform: "darwin",
        probe: () => probeScriptVersion(() => ({ error: timedOut })),
      }),
    /did not exit within/,
  );
});

test("resolvePtyWrapper reports a missing script(1) rather than guessing", () => {
  // linux would otherwise be classified util-linux off the empty output.
  const r = resolvePtyWrapper({
    platform: "linux",
    probe: () => ({ available: false, output: "" }),
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /on PATH/);
});

test("resolvePtyWrapper wraps with the resolved flavor, or reports why not", () => {
  const wrapper = resolvePtyWrapper({
    platform: "linux",
    probe: () => ({ available: true, output: "script from util-linux 2.39.3" }),
  });
  assert.equal(wrapper.ok, true);
  assert.equal(wrapper.flavor, "util-linux");
  assert.deepEqual(wrapper.wrap({ command: "node", args: ["a.js"] }), {
    command: "script",
    args: ["-qec", "'node' 'a.js'", "/dev/null"],
  });
  // `args` is optional at the call site.
  assert.deepEqual(wrapper.wrap({ command: "node" }).args[1], "'node'");

  // A present `script` on a platform whose invocation nobody verified is a
  // DIFFERENT failure from a missing one, and the reason must say which.
  const unsupported = resolvePtyWrapper({
    platform: "win32",
    probe: () => ({ available: true, output: "" }),
  });
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.reason, /no verified .* invocation for win32/);
});

// The platforms this repo claims a verified `script(1)` invocation for. Any
// other — win32, aix, sunos, netbsd, openbsd — resolves to null BY DESIGN and
// makes `smoke:tui` skip, so asserting "supported unless Windows" would fail
// `test:scripts` on a machine where the smoke is behaving exactly as intended.
const SUPPORTED_PLATFORMS = new Set(["darwin", "freebsd", "linux"]);

test("resolvePtyWrapper resolves on the platforms we claim to support", () => {
  // Not a tautology: it runs the real probe against the real machine, so a
  // `script` that has vanished from PATH surfaces here rather than as an opaque
  // smoke failure.
  const wrapper = resolvePtyWrapper();
  if (SUPPORTED_PLATFORMS.has(process.platform)) {
    assert.equal(
      wrapper.ok,
      true,
      `no PTY wrapper on ${process.platform}: ${wrapper.reason ?? ""}`,
    );
    assert.equal(wrapper.wrap({ command: "node" }).command, "script");
  } else {
    assert.equal(
      wrapper.ok,
      false,
      `${process.platform} is not in SUPPORTED_PLATFORMS but resolved a wrapper`,
    );
  }
});
