/**
 * Classifies environment variables that control the launched *runtime* rather
 * than configure the MCP server it starts.
 *
 * A registry `server.json` may declare env vars with a `default`/`value`, and
 * the import copies those into the saved config's `env`, which the stdio
 * transport passes to the spawned process. Most declared variables are server
 * settings (`API_KEY`, `REGION`). A handful instead change which code the
 * launch command loads, or where it fetches the package from — so an
 * unchanged-looking `npx -y @scope/pkg@1.0.0` can run something else
 * entirely: `NODE_OPTIONS=--require …` preloads a module into `npx` itself,
 * `npm_config_registry` points `npx` at another registry, `UV_INDEX_URL` /
 * `PIP_INDEX_URL` do the same for `uvx`, `DOCKER_HOST` hands `docker run` to
 * another daemon, `DOTNET_STARTUP_HOOKS` loads an assembly into `dnx`, and
 * `PATH` / `LD_PRELOAD` / `DYLD_*` swap the binary or inject a library.
 *
 * The import panel flags these so the user sees them, and asks for an explicit
 * confirmation before saving. They are not refused outright: a legitimate
 * server can need one (a private registry mirror, `PYTHONPATH`, a remote
 * docker host), and silently dropping it would launch a misconfigured server.
 *
 * Matching is case-insensitive. Windows treats env names case-insensitively
 * (`Path` is `PATH`) and npm reads `npm_config_*` in either case.
 *
 * Pure + isomorphic (no Node deps).
 */

/** Exact names that control the runtime. */
const RUNTIME_CONTROL_NAMES: ReadonlySet<string> = new Set(["PATH"]);

/**
 * Name prefixes that control the runtime. Each covers a family the launch
 * commands (`npx`, `uvx`, `docker`, `dnx`) or the dynamic loader read:
 * Node (`NODE_OPTIONS`, `NODE_PATH`, `NODE_EXTRA_CA_CERTS`,
 * `NODE_TLS_REJECT_UNAUTHORIZED`), npm config, uv, pip, the Python
 * interpreter (`PYTHONPATH`, `PYTHONSTARTUP`, `PYTHONHOME`), docker, the
 * Linux and macOS dynamic loaders, and the .NET host and NuGet.
 */
const RUNTIME_CONTROL_PREFIXES: readonly string[] = [
  "NODE_",
  "NPM_CONFIG_",
  "UV_",
  "PIP_",
  "PYTHON",
  "DOCKER_",
  "LD_",
  "DYLD_",
  "DOTNET_",
  "NUGET_",
];

/**
 * Names inside a flagged family that only tune output or mode and cannot load
 * code or redirect a fetch. Kept deliberately short: anything not listed here
 * is flagged, so a variable added to a runtime later is caught by default.
 * (`PYTHONWARNINGS` is *not* here: a warning filter names a category class,
 * which Python imports.)
 */
const BENIGN_NAMES: ReadonlySet<string> = new Set([
  "NODE_ENV",
  "NODE_NO_WARNINGS",
  "PYTHONUNBUFFERED",
  "PYTHONIOENCODING",
  "PYTHONUTF8",
  "PYTHONDONTWRITEBYTECODE",
]);

/**
 * Whether setting `name` changes which code the launched command loads or
 * where it fetches packages from.
 */
export function isRuntimeControlEnvVar(name: string): boolean {
  const upper = name.toUpperCase();
  if (BENIGN_NAMES.has(upper)) return false;
  if (RUNTIME_CONTROL_NAMES.has(upper)) return true;
  return RUNTIME_CONTROL_PREFIXES.some((prefix) => upper.startsWith(prefix));
}
