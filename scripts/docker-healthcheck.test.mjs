/**
 * The Docker HEALTHCHECK probe (#2424).
 *
 * `probeUrl` is where the bug lived: the probe connected to a hardcoded
 * `127.0.0.1` whatever `HOST` the server bound. The table pins the derivation —
 * a specific host is probed as given, a wildcard is mapped to the loopback of
 * its own family. The `probe` cases run it against a real listener, since the
 * exit status is the whole contract Docker reads.
 *
 * The last block reads the Dockerfile, because the script being right is no use
 * if the image stops running it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { probe, probeUrl } from "./docker-healthcheck.mjs";

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
