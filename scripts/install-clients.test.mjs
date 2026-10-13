/**
 * Tests for scripts/install-clients.mjs — the root postinstall cascade.
 *
 * The unit cases pin `childInstallEnv`. The end-to-end cases run the real
 * script and the real npm against a throwaway repo layout, because #2518 is
 * an interaction between two npm processes: the parent exports a user's
 * npmrc `allow-scripts` as `npm_config_allow_scripts`, and npm 11.19+ refuses
 * that env var in a project install. Only running npm shows the cascade
 * surviving it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { childInstallEnv } from "./install-clients.mjs";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "install-clients.mjs",
);

test("childInstallEnv strips npm_config_allow_scripts", () => {
  const env = childInstallEnv({
    PATH: "/bin",
    npm_config_allow_scripts: "esbuild",
  });
  assert.deepEqual(env, { PATH: "/bin" });
});

test("childInstallEnv strips the key whatever its case, as npm reads it", () => {
  const env = childInstallEnv({
    NPM_CONFIG_ALLOW_SCRIPTS: "a",
    Npm_Config_Allow_Scripts: "b",
  });
  assert.deepEqual(env, {});
});

test("childInstallEnv keeps every other npm config and does not mutate its input", () => {
  const input = {
    npm_config_allow_scripts: "esbuild",
    npm_config_registry: "https://registry.example/",
    npm_config_allow_scripts_pin: "true",
  };
  const env = childInstallEnv(input);
  assert.deepEqual(env, {
    npm_config_registry: "https://registry.example/",
    npm_config_allow_scripts_pin: "true",
  });
  assert.equal(input.npm_config_allow_scripts, "esbuild");
});

/**
 * A repo-shaped temp dir: scripts/install-clients.mjs plus one dependency-free
 * client, and a HOME whose .npmrc sets allow-scripts — the reporter's setup.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "install-clients-"));
  mkdirSync(join(root, "scripts"));
  copyFileSync(SCRIPT, join(root, "scripts", "install-clients.mjs"));
  const client = join(root, "clients", "web");
  mkdirSync(client, { recursive: true });
  writeFileSync(
    join(client, "package.json"),
    JSON.stringify({ name: "fixture-web", version: "1.0.0", private: true }),
  );
  const home = join(root, "home");
  mkdirSync(home);
  writeFileSync(join(home, ".npmrc"), "allow-scripts=esbuild\n");
  return { root, client, home };
}

/** The env a parent npm hands its postinstall when ~/.npmrc sets allow-scripts. */
function parentNpmEnv(home) {
  const env = childInstallEnv(process.env);
  for (const key of Object.keys(env)) {
    if (key.toLowerCase().startsWith("npm_config_")) delete env[key];
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    npm_config_allow_scripts: "esbuild",
    npm_config_offline: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
}

const npmCmd = { shell: process.platform === "win32", encoding: "utf8" };

const npmVersion = spawnSync("npm", ["--version"], npmCmd).stdout.trim();
const [major, minor] = npmVersion.split(".").map(Number);
const npmGatesAllowScripts = major > 11 || (major === 11 && minor >= 19);

test(
  "premise: npm rejects allow-scripts arriving through the environment",
  { skip: !npmGatesAllowScripts && `npm ${npmVersion} predates the gate` },
  () => {
    const { root, client, home } = fixture();
    try {
      const result = spawnSync("npm", ["install"], {
        ...npmCmd,
        cwd: client,
        env: parentNpmEnv(home),
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /EALLOWSCRIPTS/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("the cascade installs a client when the parent npm exported allow-scripts", () => {
  const { root, home } = fixture();
  try {
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts", "install-clients.mjs")],
      { ...npmCmd, cwd: root, env: parentNpmEnv(home) },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Installing dependencies for clients\/web/);
    assert.doesNotMatch(result.stderr, /EALLOWSCRIPTS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
