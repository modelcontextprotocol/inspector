import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/cli-runner.js";
import {
  warnOnFetchRefusals,
  writeFetchRefusalWarning,
} from "@inspector/core/cli/fetchRefusalWarning.js";
import { InspectorClientEventTarget } from "@inspector/core/mcp/inspectorClientEventTarget.js";

const REFUSAL = {
  url: "http://169.254.169.254/.well-known/oauth-authorization-server",
  reason:
    "Refusing to fetch from a link-local or metadata address (169.254.169.254)",
};
const LINE = `Warning: Refused to fetch ${REFUSAL.url}: ${REFUSAL.reason}\n`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("writeFetchRefusalWarning (#2846)", () => {
  it("writes one Warning line to the sink", () => {
    const sink = vi.fn();
    writeFetchRefusalWarning(REFUSAL, sink);
    expect(sink).toHaveBeenCalledWith(LINE);
  });

  it("writes to stderr by default", () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    writeFetchRefusalWarning(REFUSAL);
    expect(write).toHaveBeenCalledWith(LINE);
  });
});

describe("warnOnFetchRefusals (#2846)", () => {
  it("prints each refusal the client reports, until unsubscribed", () => {
    // The client's own event target: the helper only subscribes to it.
    const target = new InspectorClientEventTarget();
    const sink = vi.fn();
    const stop = warnOnFetchRefusals(target, sink);

    target.dispatchTypedEvent("fetchRefused", REFUSAL);
    expect(sink).toHaveBeenCalledWith(LINE);

    stop();
    target.dispatchTypedEvent("fetchRefused", REFUSAL);
    expect(sink).toHaveBeenCalledTimes(1);
  });
});

// End to end through the CLI (#2846): a server whose 401 points discovery at
// the metadata address, while it publishes AS metadata at its own origin and
// refuses registration — so the run fails on a DCR 401 that names nothing the
// refusal did. The warning is the only trace of why.
describe("CLI refusal warning, end to end (#2846)", () => {
  let server: Server;
  let url: string;
  const statePath = join(tmpdir(), `mcp-oauth-${process.pid}-refusal.json`);

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (path === "/mcp") {
        res.writeHead(401, {
          "www-authenticate":
            'Bearer resource_metadata="http://169.254.169.254/.well-known/oauth-protected-resource"',
        });
        res.end();
      } else if (path === "/.well-known/oauth-authorization-server") {
        const origin = url.replace(/\/mcp$/, "");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            issuer: origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            registration_endpoint: `${origin}/register`,
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"],
          }),
        );
      } else if (path === "/register") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end('{"error":"invalid_client"}');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    url = `http://127.0.0.1:${port}/mcp`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(statePath, { force: true });
  });

  const env = () => ({
    MCP_AUTO_OPEN_ENABLED: "true",
    MCP_INSPECTOR_OAUTH_STATE_PATH: statePath,
  });

  it("warns on stderr before the unrelated failure", async () => {
    const result = await runCli([url, "--method", "tools/list"], {
      env: env(),
    });
    expect(result.stderr).toContain(
      "Warning: Refused to fetch http://169.254.169.254/.well-known/oauth-protected-resource: Refusing to fetch from a link-local or metadata address (169.254.169.254)",
    );
  });

  it("stays silent under --quiet", async () => {
    const result = await runCli([url, "--method", "tools/list", "--quiet"], {
      env: env(),
    });
    expect(result.stderr).not.toContain("Refused to fetch");
    expect(result.output).toContain("auth_required");
  });
});
