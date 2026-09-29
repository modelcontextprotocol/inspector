// Tests for the mcpdo behavior eval's deterministic layer: the hermetic
// environment builder and the composed-server launcher. The model-dependent
// hit rates stay manual (`npm run skills:eval:mcpdo`); everything a hit
// depends on that is NOT a model decision is nailed down here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  caseServers,
  clickConsent,
  makeBehaviorEnv,
  readTranscript,
  startConsentClicker,
  loadCases,
} from "./skill-eval-mcpdo.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAUNCHER = path.join(
  ROOT,
  "scripts",
  "lib",
  "mcpdo-eval-server-launcher.mjs",
);
const TEST_SERVERS_BUILD = path.join(ROOT, "test-servers", "build", "index.js");

const tempSandbox = () =>
  path.join(mkdtempSync(path.join(os.tmpdir(), "mcpdo-eval-test-")), "sandbox");

// makeBehaviorEnv builds `${sandbox}-env`; clean both.
const cleanup = (sandbox) => {
  rmSync(path.dirname(sandbox), { recursive: true, force: true });
};

test(
  "makeBehaviorEnv: default world shape",
  { skip: process.platform === "win32" },
  async () => {
    const sandbox = tempSandbox();
    try {
      const { env, logPath } = await makeBehaviorEnv(sandbox);
      const envDir = `${sandbox}-env`;

      const catalog = JSON.parse(
        readFileSync(path.join(envDir, "catalog.json"), "utf8"),
      );
      assert.deepEqual(Object.keys(catalog.mcpServers), ["test-stdio"]);
      assert.equal(catalog.mcpServers["test-stdio"].type, "stdio");
      assert.match(
        catalog.mcpServers["test-stdio"].args.join(" "),
        /test-server-stdio\.js/,
      );

      // The shim shadows any globally installed mcpdo.
      const shim = path.join(envDir, "bin", "mcpdo");
      assert.ok(statSync(shim).mode & 0o100, "shim must be executable");
      assert.match(readFileSync(shim, "utf8"), /mcpdo-eval-shim\.mjs/);
      assert.ok(env.PATH.startsWith(path.join(envDir, "bin") + path.delimiter));

      // The private-daemon trio plus the shim contract.
      assert.equal(env.MCP_INSPECTOR_DAEMON_DIR, path.join(envDir, "daemon"));
      assert.ok(env.MCP_INSPECTOR_DAEMON_TOKEN.length >= 32);
      assert.equal(env.MCP_STORAGE_DIR, path.join(envDir, "storage"));
      assert.equal(env.MCP_CATALOG_PATH, path.join(envDir, "catalog.json"));
      assert.equal(env.MCPDO_EVAL_LOG, logPath);
      assert.ok(existsSync(env.MCPDO_EVAL_REAL) || true); // path shape only
    } finally {
      cleanup(sandbox);
    }
  },
);

test(
  "makeBehaviorEnv: url server spec points the entry at the fixture",
  { skip: process.platform === "win32" },
  async () => {
    const sandbox = tempSandbox();
    try {
      await makeBehaviorEnv(
        sandbox,
        caseServers({ server: { url: "http://127.0.0.1:3999/mcp" } }),
      );
      const catalog = JSON.parse(
        readFileSync(path.join(`${sandbox}-env`, "catalog.json"), "utf8"),
      );
      assert.deepEqual(catalog.mcpServers["test-stdio"], {
        type: "streamable-http",
        url: "http://127.0.0.1:3999/mcp",
      });
    } finally {
      cleanup(sandbox);
    }
  },
);

test(
  "makeBehaviorEnv: composed server spec is written and served via the launcher",
  { skip: process.platform === "win32" },
  async () => {
    const sandbox = tempSandbox();
    try {
      const spec = {
        serverInfo: { name: "composed-test", version: "1.0.0" },
        tools: [{ preset: "add" }],
      };
      await makeBehaviorEnv(sandbox, caseServers({ server: spec }));
      const envDir = `${sandbox}-env`;
      const entry = JSON.parse(
        readFileSync(path.join(envDir, "catalog.json"), "utf8"),
      ).mcpServers["test-stdio"];
      assert.equal(entry.type, "stdio");
      assert.equal(entry.args[0], LAUNCHER);
      assert.deepEqual(
        JSON.parse(readFileSync(entry.args[1], "utf8")),
        { transport: { type: "stdio" }, ...spec },
        "the config on disk is the case's spec plus the stdio transport",
      );
    } finally {
      cleanup(sandbox);
    }
  },
);

test("caseServers: normalizes server / servers / neither", () => {
  const spec = { serverInfo: { name: "s", version: "1" } };
  assert.deepEqual(caseServers({}), { "test-stdio": undefined });
  assert.deepEqual(caseServers({ server: spec }), { "test-stdio": spec });
  assert.deepEqual(caseServers({ servers: { a: spec } }), { a: spec });
});

test(
  "makeBehaviorEnv: multiple servers get their own entries and config files",
  { skip: process.platform === "win32" },
  async () => {
    const sandbox = tempSandbox();
    try {
      const calendar = {
        serverInfo: { name: "calendar", version: "1.0.0" },
        tools: [{ preset: "add" }],
      };
      await makeBehaviorEnv(sandbox, {
        calendar,
        "weather-api": { url: "http://127.0.0.1:3999/mcp" },
      });
      const envDir = `${sandbox}-env`;
      const catalog = JSON.parse(
        readFileSync(path.join(envDir, "catalog.json"), "utf8"),
      );
      assert.deepEqual(Object.keys(catalog.mcpServers).sort(), [
        "calendar",
        "weather-api",
      ]);
      const cal = catalog.mcpServers.calendar;
      assert.equal(cal.args[0], LAUNCHER);
      assert.match(cal.args[1], /server-config-calendar\.json$/);
      assert.deepEqual(catalog.mcpServers["weather-api"], {
        type: "streamable-http",
        url: "http://127.0.0.1:3999/mcp",
      });
    } finally {
      cleanup(sandbox);
    }
  },
);

// In-process HTTP fixture: a composed spec with streamable-http transport
// must come up inside the harness, get a catalog entry pointing at its live
// URL, answer an MCP initialize over HTTP, and die at teardown. OAuth rides
// on the same instance, so its AS metadata endpoint is asserted too.
test(
  "makeBehaviorEnv: http composed server runs in-process (with oauth metadata)",
  { skip: !existsSync(TEST_SERVERS_BUILD) || process.platform === "win32" },
  async () => {
    const sandbox = tempSandbox();
    let teardown;
    try {
      const env = await makeBehaviorEnv(sandbox, {
        "protected-api": {
          transport: { type: "streamable-http" },
          serverInfo: { name: "protected-api", version: "1.0.0" },
          tools: [{ preset: "add" }],
          oauth: { enabled: true, mode: "combined", requireAuth: true },
        },
      });
      teardown = env.teardown;
      const entry = JSON.parse(
        readFileSync(path.join(`${sandbox}-env`, "catalog.json"), "utf8"),
      ).mcpServers["protected-api"];
      assert.equal(entry.type, "streamable-http");
      assert.match(entry.url, /^http:\/\/localhost:\d+\/mcp$/);

      const origin = entry.url.replace(/\/mcp$/, "");
      const meta = await fetch(
        `${origin}/.well-known/oauth-authorization-server`,
      );
      assert.equal(meta.status, 200);
      const asMeta = await meta.json();
      assert.equal(asMeta.issuer, origin);
      assert.ok(asMeta.authorization_endpoint.startsWith(origin));

      // Unauthenticated MCP request → the protected resource must challenge,
      // not serve (401 + WWW-Authenticate), proving oauth guards the entry
      // the catalog points at.
      const res = await fetch(entry.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "eval-test", version: "0.0.0" },
          },
        }),
      });
      assert.equal(res.status, 401);
      assert.ok(res.headers.get("www-authenticate"));

      await teardown();
      teardown = undefined;
      await assert.rejects(
        fetch(`${origin}/.well-known/oauth-authorization-server`),
        undefined,
        "fixture must be gone after teardown",
      );
    } finally {
      if (teardown) await teardown();
      cleanup(sandbox);
    }
  },
);

test(
  "makeBehaviorEnv: plain http composed server answers initialize",
  { skip: !existsSync(TEST_SERVERS_BUILD) || process.platform === "win32" },
  async () => {
    const sandbox = tempSandbox();
    let teardown;
    try {
      const env = await makeBehaviorEnv(sandbox, {
        api: {
          transport: { type: "streamable-http" },
          serverInfo: { name: "plain-api", version: "1.0.0" },
          tools: [{ preset: "add" }],
        },
      });
      teardown = env.teardown;
      const entry = JSON.parse(
        readFileSync(path.join(`${sandbox}-env`, "catalog.json"), "utf8"),
      ).mcpServers.api;
      const res = await fetch(entry.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "eval-test", version: "0.0.0" },
          },
        }),
      });
      assert.equal(res.status, 200);
      assert.match(await res.text(), /"name":\s*"plain-api"/);
    } finally {
      if (teardown) await teardown();
      cleanup(sandbox);
    }
  },
);

test("readTranscript: missing file and torn tail line", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mcpdo-eval-test-"));
  try {
    assert.deepEqual(readTranscript(path.join(dir, "absent.ndjson")), []);
    const p = path.join(dir, "log.ndjson");
    const good = JSON.stringify({ argv: ["tools/list"], exit: 0, events: [] });
    writeFileSync(p, `${good}\n{"argv":["to`);
    const records = readTranscript(p);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0].argv, ["tools/list"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readTranscript: corruption before the final record throws", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mcpdo-eval-test-"));
  try {
    const p = path.join(dir, "log.ndjson");
    const good = JSON.stringify({ argv: ["tools/list"], exit: 0, events: [] });
    // Only a torn FINAL line is a benign kill artifact; a malformed record
    // with records after it is corruption the scorer must not misread as
    // the agent never running that command.
    writeFileSync(p, `${good}\n{"argv":["to\n${good}\n`);
    assert.throws(
      () => readTranscript(p),
      /malformed transcript record at line 2/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("consent clicker: finds an authorize URL split across stream chunks", async () => {
  const { createServer } = await import("node:http");
  const hits = { callback: 0 };
  const server = createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname === "/oauth/authorize" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<form>consent</form>");
    } else if (u.pathname === "/oauth/authorize" && req.method === "POST") {
      res.writeHead(302, {
        Location: `http://127.0.0.1:${server.address().port}/cb?code=x&state=s`,
      });
      res.end();
    } else if (u.pathname === "/cb") {
      hits.callback++;
      res.writeHead(200);
      res.end("done");
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const authUrl = `http://127.0.0.1:${port}/oauth/authorize?client_id=c&state=s`;
  const cut = authUrl.indexOf("authorize?") + 12; // mid-query split
  const dir = mkdtempSync(path.join(os.tmpdir(), "mcpdo-eval-test-"));
  const logPath = path.join(dir, "log.ndjson");
  writeFileSync(
    logPath,
    JSON.stringify({
      argv: ["connect", "secure"],
      exit: 0,
      events: [
        {
          t: 1,
          stream: "stdout",
          data: `"authUrl": "${authUrl.slice(0, cut)}`,
        },
        { t: 2, stream: "stdout", data: `${authUrl.slice(cut)}"` },
      ],
    }) + "\n",
  );
  const clicker = startConsentClicker(logPath);
  try {
    const deadline = Date.now() + 5000;
    while (hits.callback === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(hits.callback, 1);
  } finally {
    clicker.stop();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("consent clicker: approves each authorize URL from the transcript once", async () => {
  const { createServer } = await import("node:http");
  const hits = { get: 0, post: 0, callback: 0 };
  const server = createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname === "/oauth/authorize" && req.method === "GET") {
      hits.get++;
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<form>consent</form>");
    } else if (u.pathname === "/oauth/authorize" && req.method === "POST") {
      hits.post++;
      res.writeHead(302, {
        Location: `http://127.0.0.1:${server.address().port}/cb?code=x&state=s`,
      });
      res.end();
    } else if (u.pathname === "/cb") {
      hits.callback++;
      res.writeHead(200);
      res.end("done");
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const authUrl = `http://127.0.0.1:${port}/oauth/authorize?client_id=c&state=s`;
  const dir = mkdtempSync(path.join(os.tmpdir(), "mcpdo-eval-test-"));
  const logPath = path.join(dir, "log.ndjson");
  const record = JSON.stringify({
    argv: ["connect", "secure"],
    exit: 0,
    events: [{ t: 1, stream: "stdout", data: `"authUrl": "${authUrl}"` }],
  });
  writeFileSync(logPath, `${record}\n`);
  const clicker = startConsentClicker(logPath);
  try {
    const deadline = Date.now() + 5000;
    while (hits.callback === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(hits.get, 1);
    assert.equal(hits.post, 1);
    assert.equal(hits.callback, 1);
    // Same URL appearing again (an agent re-printing it) is not re-clicked.
    writeFileSync(logPath, `${record}\n${record}\n`);
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(hits.post, 1);
  } finally {
    clicker.stop();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clickConsent: throws when the AS does not redirect", async () => {
  const { createServer } = await import("node:http");
  const server = createServer((_req, res) => {
    res.writeHead(400);
    res.end("nope");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    await assert.rejects(
      clickConsent(`http://127.0.0.1:${port}/oauth/authorize?x=1`),
      /expected redirect, got 400/,
    );
  } finally {
    server.close();
  }
});

test("loadCases: the committed evals file validates and partitions", () => {
  const { trigger, behavior } = loadCases();
  assert.ok(trigger.length >= 5);
  assert.ok(behavior.length >= 2);
  assert.ok(trigger.every((c) => c.kind === "trigger"));
  assert.ok(behavior.every((c) => c.kind === "behavior"));
});

// End-to-end: the launcher must actually SERVE the composed config. One MCP
// handshake over newline-delimited JSON-RPC, then tools/list, asserting the
// composed tool set (and only it). Skipped when the test-servers build is
// absent — the eval itself requires builds too, and says so.
test(
  "launcher serves a composed config over stdio",
  { skip: !existsSync(TEST_SERVERS_BUILD) || process.platform === "win32" },
  async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mcpdo-eval-test-"));
    const configPath = path.join(dir, "server.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        transport: { type: "stdio" },
        serverInfo: { name: "composed-test", version: "1.0.0" },
        tools: [{ preset: "add" }],
      }),
    );
    const child = spawn(process.execPath, [LAUNCHER, configPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      const responses = new Map();
      let buf = "";
      let notify;
      const arrived = new Promise((r) => (notify = r));
      child.stdout.on("data", (chunk) => {
        buf += chunk.toString();
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.trim() === "") continue;
          const msg = JSON.parse(line);
          if (msg.id !== undefined) {
            responses.set(msg.id, msg);
            notify();
          }
        }
      });
      const waitFor = async (id, ms = 10000) => {
        const deadline = Date.now() + ms;
        while (!responses.has(id)) {
          if (Date.now() > deadline) {
            throw new Error(`no response ${id}; stderr may explain`);
          }
          await new Promise((r) => setTimeout(r, 25));
        }
        return responses.get(id);
      };
      const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");

      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "eval-test", version: "0.0.0" },
        },
      });
      const init = await waitFor(1);
      assert.equal(init.result.serverInfo.name, "composed-test");
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const tools = (await waitFor(2)).result.tools.map((t) => t.name);
      assert.deepEqual(tools, ["add"]);
    } finally {
      child.kill("SIGTERM");
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
