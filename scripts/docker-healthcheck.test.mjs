/**
 * The Docker HEALTHCHECK probe (#2424).
 *
 * `probeUrl` is where the bug lived: the probe connected to a hardcoded
 * `127.0.0.1` whatever `HOST` the server bound. The table pins the derivation —
 * a specific host is probed as given, a wildcard is mapped to the loopback of
 * its own family. The `probe` cases run it against a real listener, since the
 * exit status is the whole contract Docker reads.
 *
 * `launchMode` is #2415: only `--web` has a server, so the verdict reads the
 * mode from PID 1's argv and a `--cli`/`--tui` container is not probed.
 *
 * The last block reads the Dockerfile, because the script being right is no use
 * if the image stops running it.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  healthy,
  launchMode,
  probe,
  probeUrl,
  readPid1Argv,
} from "./docker-healthcheck.mjs";

describe("probeUrl", () => {
  const cases = [
    // [HOST, expected host in the URL]
    [undefined, "127.0.0.1"],
    ["", "127.0.0.1"],
    ["   ", "127.0.0.1"],
    ["0.0.0.0", "127.0.0.1"],
    ["0", "127.0.0.1"],
    ["0x0", "127.0.0.1"],
    ["::ffff:0:0", "127.0.0.1"],
    ["::", "[::1]"],
    ["[::]", "[::1]"],
    ["::0", "[::1]"],
    ["172.17.0.2", "172.17.0.2"],
    [" 172.17.0.2 ", "172.17.0.2"],
    ["127.0.0.1", "127.0.0.1"],
    ["::1", "[::1]"],
    ["[::1]", "[::1]"],
    ["fe80::1%eth0", "[fe80::1]"],
    ["inspector.internal", "inspector.internal"],
  ];
  for (const [host, expected] of cases) {
    it(`HOST=${JSON.stringify(host)} probes ${expected}`, () => {
      const env = host === undefined ? {} : { HOST: host };
      assert.equal(probeUrl(env), `http://${expected}:6274/`);
    });
  }

  it("takes the port from CLIENT_PORT", () => {
    assert.equal(
      probeUrl({ HOST: "172.17.0.2", CLIENT_PORT: "8080" }),
      "http://172.17.0.2:8080/",
    );
  });

  it("trims CLIENT_PORT and treats an empty one as unset, as the server does", () => {
    assert.equal(probeUrl({ CLIENT_PORT: " 8080 " }), "http://127.0.0.1:8080/");
    assert.equal(probeUrl({ CLIENT_PORT: "   " }), "http://127.0.0.1:6274/");
    assert.equal(probeUrl({ CLIENT_PORT: "" }), "http://127.0.0.1:6274/");
  });

  it("throws on a HOST no server could bind", () => {
    assert.throws(() => probeUrl({ HOST: "not a host" }));
  });
});

describe("probe", () => {
  let server;
  let port;
  let status = 200;

  before(async () => {
    server = createServer((_req, res) => {
      res.statusCode = status;
      res.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = String(server.address().port);
  });
  after(() => new Promise((resolve) => server.close(resolve)));

  it("is healthy when / answers 2xx", async () => {
    status = 200;
    assert.equal(await probe({ HOST: "127.0.0.1", CLIENT_PORT: port }), true);
  });

  it("is unhealthy when / answers non-2xx", async () => {
    status = 503;
    assert.equal(await probe({ HOST: "127.0.0.1", CLIENT_PORT: port }), false);
  });

  it("is unhealthy when nothing is listening", async () => {
    const closed = createServer();
    await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const freePort = String(closed.address().port);
    await new Promise((resolve) => closed.close(resolve));
    assert.equal(
      await probe({ HOST: "127.0.0.1", CLIENT_PORT: freePort }),
      false,
    );
  });

  it("is unhealthy, not a crash, on an unparseable HOST", async () => {
    assert.equal(await probe({ HOST: "not a host", CLIENT_PORT: port }), false);
  });
});

describe("launchMode", () => {
  const BIN = "/usr/local/bin/mcp-inspector";
  const cases = [
    // [PID 1 argv, expected mode]
    [["node", BIN], "web"],
    [["node", BIN, "--web"], "web"],
    [["node", BIN, "--cli", "npx", "server"], "cli"],
    [["node", BIN, "--tui"], "tui"],
    // Only the token right after the bin is a mode flag, as in the launcher.
    [["node", BIN, "--config", "x.json", "--tui"], "web"],
    // `docker run --init` puts an init in front of the launcher.
    [["/sbin/docker-init", "--", "mcp-inspector", "--tui"], "tui"],
    // An overridden entrypoint names no launcher.
    [["sh", "-c", "sleep 1"], undefined],
    [[], undefined],
  ];
  for (const [argv, expected] of cases) {
    it(`${JSON.stringify(argv)} is ${expected}`, () => {
      assert.equal(launchMode(argv), expected);
    });
  }
});

describe("readPid1Argv", () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "healthcheck-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("splits a NUL-separated cmdline", () => {
    const path = join(dir, "cmdline");
    writeFileSync(path, "node\0/usr/local/bin/mcp-inspector\0--tui\0");
    assert.deepEqual(readPid1Argv(path), [
      "node",
      "/usr/local/bin/mcp-inspector",
      "--tui",
    ]);
  });

  it("is empty where the file cannot be read", () => {
    assert.deepEqual(readPid1Argv(join(dir, "missing")), []);
  });
});

describe("healthy", () => {
  // Nothing listens here, so any mode that probes is unhealthy.
  const env = { HOST: "127.0.0.1", CLIENT_PORT: "1" };
  const BIN = "/usr/local/bin/mcp-inspector";

  it("does not probe a --cli or --tui container", async () => {
    assert.equal(await healthy(env, ["node", BIN, "--cli"]), true);
    assert.equal(await healthy(env, ["node", BIN, "--tui"]), true);
  });

  it("probes --web, the default mode, and an unrecognized argv", async () => {
    assert.equal(await healthy(env, ["node", BIN, "--web"]), false);
    assert.equal(await healthy(env, ["node", BIN]), false);
    assert.equal(await healthy(env, []), false);
  });
});

describe("Dockerfile", () => {
  const dockerfile = readFileSync(
    join(import.meta.dirname, "..", "Dockerfile"),
    "utf8",
  );

  it("runs the probe it copies into the runtime stage as its HEALTHCHECK", () => {
    const runner = dockerfile.slice(dockerfile.indexOf(" AS runner"));
    const copied =
      /^COPY --from=builder \S*\/scripts\/docker-healthcheck\.mjs (\S+)$/m.exec(
        runner,
      );
    assert.ok(
      copied,
      "the runtime stage copies scripts/docker-healthcheck.mjs",
    );
    const healthcheck = runner.slice(runner.indexOf("HEALTHCHECK "));
    assert.ok(
      healthcheck.includes(`CMD ["node", "${copied[1]}"]`),
      `HEALTHCHECK runs ${copied[1]}`,
    );
    assert.doesNotMatch(healthcheck.split("\n\n")[0], /127\.0\.0\.1/);
  });
});
