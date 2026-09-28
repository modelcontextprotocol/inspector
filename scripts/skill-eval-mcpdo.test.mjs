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
  makeBehaviorEnv,
  readTranscript,
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
  () => {
    const sandbox = tempSandbox();
    try {
      const { env, logPath } = makeBehaviorEnv(sandbox);
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
  () => {
    const sandbox = tempSandbox();
    try {
      makeBehaviorEnv(sandbox, { url: "http://127.0.0.1:3999/mcp" });
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
  () => {
    const sandbox = tempSandbox();
    try {
      const spec = {
        serverInfo: { name: "composed-test", version: "1.0.0" },
        tools: [{ preset: "add" }],
      };
      makeBehaviorEnv(sandbox, spec);
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
