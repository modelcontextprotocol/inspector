# Smoke-testing an MCP server from the shell

A **smoke test** here means: connect to a server, prove it speaks MCP, prove the
one or two things you actually depend on still work, and fail the job when they
don't. It is deliberately not a conformance suite — it is the check you run on
every commit and every deploy, in a few seconds, with no browser.

Everything below uses the Inspector **CLI**, which is built for exactly this:
one process per assertion, a machine-readable result on stdout, and a stable
exit code. The full flag reference is
[`clients/cli/README.md`](../clients/cli/README.md); this guide is the workflow
that composes those flags.

> Coming from v1? Exit codes, argument ordering, and the `--` separator all
> changed — see the [v1 → v2 migration guide](./v1-to-v2-migration.md) before
> porting a v1 script.

**Prerequisites:** Node `>= 22.19.0` and [`jq`](https://jqlang.github.io/jq/)
for the assertions. Every example invokes the CLI as
`npx @modelcontextprotocol/inspector --cli`, which resolves the **latest**
release each time it runs — fine while you are working at a terminal, wrong for
CI.

**In CI, pin an exact version** — `npx --yes @modelcontextprotocol/inspector@2.5.0
--cli …`. A range like `@2` is *not* a pin: `npx` will happily resolve a newer
2.x, so the same commit can run against a different Inspector on a later day.
`--yes` suppresses the first-run install prompt, which would otherwise hang an
unattended job.

## 1. Connect

The server can be a **stdio** command or an **HTTP/SSE** URL. The Inspector's
own flags are the same either way; only the target differs.

```bash
# stdio — the server is a command the Inspector spawns
npx @modelcontextprotocol/inspector --cli node build/index.js --method initialize

# Streamable HTTP
npx @modelcontextprotocol/inspector --cli \
  --transport http --server-url https://example.com/mcp --method initialize

# SSE
npx @modelcontextprotocol/inspector --cli \
  --transport sse --server-url https://example.com/sse --method initialize
```

`--method initialize` is a **connect-only probe**: it completes the handshake,
prints `{serverInfo, protocolVersion, capabilities, instructions}`, and
disconnects without invoking anything. It is the cheapest possible "is the
server alive and speaking MCP" assertion, and the right first line of a smoke
job.

⚠️ **If your stdio server takes flags of its own, you need a `--` separator, and
it splits the opposite way from the web and TUI clients.** Under `--cli`,
everything **before** `--` is the target command and everything **after** is the
Inspector's own options:

```bash
npx @modelcontextprotocol/inspector --cli \
  node build/index.js --config ./server.conf -- --method tools/list
```

Without the `--`, the target is only the leading run of non-dash tokens, so
`--config ./server.conf` would be eaten by the Inspector (and rejected as a
conflict with its own `--config` flag).

**Always bound the connect.** `--connect-timeout <ms>` defaults to `15000` for
ad-hoc `--server-url`/target runs and to the file-level timeout for
`--catalog`/`--config` runs; `0` disables it. A CI job should never inherit a
disabled timeout — a black-holed host would hang the runner until the job's own
limit kills it.

For a server you connect to repeatedly, put it in a config file once and select
it by name, so the smoke script carries no transport details:

```bash
npx @modelcontextprotocol/inspector --cli --config ./mcp.json --server my-server \
  --method initialize
```

`--config` is a **read-only** session file and errors if it is absent;
`--catalog` is the writable catalog and is seeded empty when missing. The two
are mutually exclusive, and neither combines with an ad-hoc target. The file
format is [MCP server configuration](./mcp-server-configuration.md).

## 2. Make every result machine-readable

`--format json` prints a single JSON object on stdout with no banners:

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js \
  --method tools/list --format json
# → {"result":{"tools":[{"name":"echo","description":"…","inputSchema":{…}}, …]}}
```

For every method **except** an `--app-info` probe, the envelope carries
`"result"` plus up to two optional siblings:

| Key | Present when |
| --- | --- |
| `result` | Always — except under `--app-info`, see below. |
| `appInfo` | The result belongs to an [MCP App](./mcp-app-review.md) tool. |
| `schemaFindings` | `--strict` is passed to `tools/list` **and** there is at least one portability finding. |

⚠️ **`--app-info` is a different shape, not a variation on this one.** It probes
without invoking the tool, so there is no result to report and the envelope is
`{"appInfo": …}` **alone** — including in the `hasApp:false` case, which is
reported through exit code `2` rather than through a key. A consumer that
requires `.result` will break on every `--app-info` run:

```bash
mcp-inspector --cli <server> --method tools/call --tool-name <t> --app-info --format json
# → {"appInfo":{"hasApp":true,…}}      — no "result" key, in either case
```

Parse the envelope by key rather than assuming a fixed shape — a consumer that
reads `.result` and stops will drop the `schemaFindings` diagnostics described in
[§7](#7-negative-assertions), and one that *requires* it will reject the
`--app-info` shape outright.

Three more things worth knowing before you build a pipeline on it:

- **The default is `text`**, which pretty-prints for a human. Pass `--format
  json` on every command a script parses.
- **`tools/list --app-info` always emits NDJSON** (one app-info object per
  line) regardless of `--format`. Only the single-result paths get the
  envelope above.
- **stdout is the result; stderr is diagnostics.** Never merge them (`2>&1`)
  into something you then pipe to `jq` — the one place this guide does merge
  them is the secret scan in §7, which greps rather than parses.

## 3. Assert a tool exists

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js \
  --method tools/list --format json \
  | jq -e '.result.tools | map(.name) | index("my_tool")' > /dev/null
```

`jq -e` sets its own exit status from the output — non-zero when the result is
`null` or `false` — so a missing tool fails the step with no extra shell. To
assert a whole set at once:

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js \
  --method tools/list --format json \
  | jq -e --argjson want '["my_tool","other_tool"]' \
      '[.result.tools[].name] as $have | $want - $have | length == 0' > /dev/null
```

The same shape works for `resources/list`, `resources/templates/list` and
`prompts/list` — only the key under `.result` changes (`.resources`,
`.resourceTemplates`, `.prompts`).

## 4. Call one representative tool

Pick a tool that is **safe to call repeatedly**: read-only, idempotent, and
cheap. A smoke test runs on every commit; it is not the place to exercise the
tool that sends email.

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js \
  --method tools/call --tool-name get_temp \
  --tool-args-json '{"city":"Paris","units":"C"}' --format json
# → {"result":{"content":[{"type":"text","text":"…"}],"structuredContent":{…}}}
```

Two ways to pass arguments, and the difference matters in a script:

| Flag | Behavior |
| --- | --- |
| `--tool-arg key=value` | Repeatable. Each value is **JSON-parsed when it parses**, so `count=1` sends the number `1` and `zip=10001` sends the number `10001`; anything that is not valid JSON is sent as the literal string (`zip=012` stays `"012"`, because `012` is not valid JSON). |
| `--tool-args-json '{…}'` | One JSON object, passed **verbatim** — no `key=value` coercion, so `{"zip":"10001"}` sends the string. Mutually exclusive with `--tool-arg`. |

That coercion is the trap: a zip code, an order number, or an ID that happens to
be all digits arrives at the server as a **number** through `--tool-arg`, and a
schema expecting a string rejects it. Prefer `--tool-args-json` for anything
typed — it says exactly what you mean. Then assert on the payload:

```bash
# Structured output: assert a field
… --format json | jq -e '.result.structuredContent.unit == "C"' > /dev/null

# Text content: assert a substring
… --format json | jq -e '[.result.content[] | select(.type=="text") | .text]
                          | any(test("temperature"))' > /dev/null
```

A `tools/call` whose result carries `isError:true` still prints its payload, but
exits **5**, so it will not silently pass an `&&` chain.

## 5. Branch on exit codes

Every non-zero exit maps to a stable failure class, and the CLI also writes a
one-line `ErrorEnvelope` to **stderr**:

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Usage / unexpected error (the catch-all) |
| `2` | No MCP App found on the tool (`--app-info` probe) |
| `3` | Server requires authentication (401/403, `WWW-Authenticate`, OAuth) |
| `4` | Server unreachable (DNS, connection refused, timeout, `fetch failed`) |
| `5` | Tool error (`isError:true`, or the tool was not found) |
| `6` | `--strict` found an error-severity schema portability problem |

[`clients/cli/README.md`](../clients/cli/README.md#exit-codes--error-envelopes)
owns this table; treat it as the source of truth if the two ever disagree.

Because the envelope is exactly one line, a caller can read the machine-readable
reason without scraping prose:

```bash
err=$(mktemp)
status=0
npx @modelcontextprotocol/inspector --cli \
  --transport http --server-url https://example.com/mcp \
  --method tools/list --format json 2>"$err" || status=$?

if [ "$status" -ne 0 ]; then
  code=$(tail -1 "$err" | jq -r '.error.code')   # → unreachable | auth_required | …
  echo "::error::MCP smoke failed: $code"
fi
rm -f "$err"
exit "$status"
```

⚠️ **Do not put the recovery in a `|| { … }` group and stop there.** The group's
own status becomes the list's status, so a successful `jq` turns a failed run
into a **green** one — the exact failure this guide warns about twice elsewhere.
Capture into `status`, report, then exit with it.

Take the **last** stderr line, not the whole stream: the human-readable error,
`--strict` findings and OAuth notices are printed there too, and only the
envelope is guaranteed to be one line at the end.

In a script under `set -e`, capture the status rather than letting the shell
abort on the first non-zero exit — you usually want to report *which* class
failed:

```bash
set -euo pipefail
run() { npx @modelcontextprotocol/inspector --cli "$@"; }

status=0
out=$(run node build/index.js --method tools/list --format json) || status=$?
if [ "$status" -ne 0 ]; then
  case "$status" in
    3) echo "::error::server needs auth — no usable token in the store" ;;
    4) echo "::error::server unreachable" ;;
    *) echo "::error::CLI failed with exit $status" ;;
  esac
  exit "$status"
fi
```

⚠️ Capture the status with `|| status=$?`, not with `if ! cmd; then status=$?`.
`!` inverts the pipeline's status, so `$?` inside that branch is **`0`** and
every failure class looks identical.

⚠️ `set -e` does **not** fire for a command on the left of `|`; only the
pipeline's last status is checked unless `set -o pipefail` is also on. Every
example here pipes into `jq`, so keep `pipefail`.

## 6. Never let CI wait on interactive OAuth

The CLI's interactive OAuth flow opens a browser and waits on a loopback
callback for **up to 15 minutes**. That is right for a human at a terminal and
completely wrong for a runner.

**Use `--stored-auth-only`.** It never starts interactive OAuth or step-up and
never opens a browser. When the server issues an authentication challenge it
satisfies it from the shared token store, and fails immediately with exit **3**
(`auth_required`) when the store has nothing that fits — instead of opening a
browser and waiting.

```bash
npx @modelcontextprotocol/inspector --cli \
  --transport http --server-url https://example.com/mcp \
  --method tools/list --stored-auth-only --format json
# challenged, and no usable token → {"error":{"code":"auth_required",…}} on stderr, exit 3
```

⚠️ **The flag is a no-op against a server that never challenges**, so a green run
is *not* evidence that your token store was seeded correctly. A smoke job whose
server authenticates today and stops authenticating tomorrow — a misconfigured
gateway, a route that silently became public — will keep passing. If you need to
assert that authentication actually happened, assert it directly: run once
*without* a usable token in an isolated `MCP_STORAGE_DIR` and require exit `3`.

The CLI already fails fast with `auth_required` when neither stdin nor stderr is
a TTY and `MCP_AUTO_OPEN_ENABLED` is unset — the typical CI shape. But that
depends on the runner's TTY situation and on an env var it does not own, so it
is a safety net, not a contract to build on. **Passing `--stored-auth-only`
explicitly is what makes the behavior yours.** Note also that `MCP_AUTO_OPEN_ENABLED=true`
*admits* interactive OAuth without a TTY — never set it in CI.

Related flags for the same problem:

| Flag | Use |
| --- | --- |
| `--use-stored-auth` | Read the stored token for `--server-url` and inject `Authorization: Bearer`. Runs the refresh grant first when a `refresh_token` is stored. Exits `3` (`no_stored_token`) when nothing matches. |
| `--list-stored-auth` | Print `{oauthStatePath, storedServerUrls}` and exit without connecting — a useful preflight step that says *why* a later run will fail. |
| `--wait-for-auth <sec>` | Poll for a token to land, then run. For a human-in-the-loop handoff, **not** for unattended CI. |

**Isolate the store per job.** The CLI resolves its OAuth state from
`MCP_INSPECTOR_OAUTH_STATE_PATH` → `<MCP_STORAGE_DIR>/oauth.json` →
`~/.mcp-inspector/storage/oauth.json`. Pointing it at a scratch directory keeps a
smoke run from reading — or rotating — a developer's real tokens.

⚠️ **`MCP_STORAGE_DIR` alone is not isolation.** `MCP_INSPECTOR_OAUTH_STATE_PATH`
is checked **first**, so an inherited value silently wins and the run reaches the
real token file anyway. Set both, in that order of precedence:

```bash
export MCP_STORAGE_DIR="$(mktemp -d)"
export MCP_INSPECTOR_OAUTH_STATE_PATH="$MCP_STORAGE_DIR/oauth.json"
```

This matters most where the variable is least visible — a developer's shell, a
runner with org-wide env defaults, a container image that sets it. Confirm with
`--list-stored-auth`, which prints the `oauthStatePath` it actually resolved:

```bash
npx @modelcontextprotocol/inspector --cli --server-url "$SERVER_URL" --list-stored-auth
# → {"oauthStatePath":"/tmp/tmp.XXXX/oauth.json","storedServerUrls":[]}
```

For a server that genuinely needs a credential in CI, prefer a static header
over OAuth entirely — `--header 'Authorization: Bearer <token>'`, with the token
from your CI secret store. And **do not** put a credential in the URL: the CLI
redacts `env` values and sensitive headers when printing a server, but it does
**not** scrub credentials embedded in a `url` or in stdio `args`.

## 7. Negative assertions

A smoke test that only proves the happy path will not notice the day a tool
starts answering questions it should refuse.

**Assert a refusal is still a refusal.** If your server is supposed to reject a
request — a path outside its root, an argument it should validate — assert the
*failure*, not the success. `isError:true` exits `5`, so invert the check:

```bash
if npx @modelcontextprotocol/inspector --cli node build/index.js \
     --method tools/call --tool-name read_file \
     --tool-args-json '{"path":"/etc/passwd"}' --format json > /dev/null 2>&1; then
  echo "::error::read_file accepted a path outside its root"; exit 1
fi
```

Note that this asserts only "the call did not succeed". If you need to
distinguish a refusal from a crash or an unreachable server, capture the exit
code and require exactly `5`.

**Scan captured output for obvious secret shapes.** This is a coarse net — it
catches a credential accidentally echoed back in a tool result or an error
message, and it will neither catch every leak nor absolve you of reviewing what
your server returns:

```bash
status=0
out=$(npx @modelcontextprotocol/inspector --cli node build/index.js \
        --method tools/call --tool-name my_tool --format json 2>&1) || status=$?

# Scan first — an error message is exactly where a leaked credential shows up.
if grep -Eiq '(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)' <<<"$out"; then
  echo "::error::tool output matched a secret pattern"; exit 1
fi
# …then propagate the call's own failure, which the capture would otherwise hide.
[ "$status" -eq 0 ] || { printf '%s\n' "$out"; exit "$status"; }
```

⚠️ **`out=$(…)` swallows the exit code.** Without the `|| status=$?`, a
non-matching `grep` returns 1, the `if` is simply not taken, and the step exits
**0** even though the tool call failed — the scan silently becomes the only
assertion. Under `set -e` the opposite happens: the script dies at the
assignment and never scans the error output, which is where a leaked credential
is most likely to appear. Capturing the status explicitly is what gets both.

Keep the pattern list to shapes you can justify; a regex tuned for a low false
positive rate is one people keep, and one that cries wolf is one they disable.

**Check schema portability.** A tool schema can be legal JSON Schema and still
be refused by the client your server is meant to serve. `--strict` names those
constructs — path, issue, and a concrete fix — and exits `6` when any is
error-severity:

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js \
  --method tools/list --strict
```

**Where the findings land depends on `--format`, and a JSON pipeline should read
stdout:**

| | Human report on stderr | `schemaFindings` on stdout |
| --- | --- | --- |
| `--strict` (default `text`) | ✅ | — |
| `--strict --format json` | ✅ (still printed) | ✅ |

So with `--format json` you get the findings **both** ways — the structured copy
folded into the same envelope as the result, and the human report on stderr — and
on a non-zero exit stderr additionally ends with the one-line `ErrorEnvelope`.
Read the structured copy, not the prose:

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js \
  --method tools/list --strict --format json \
  | jq -e '[.schemaFindings[]?.findings[]? | select(.severity=="error")] | length == 0' > /dev/null
```

`schemaFindings` is grouped per tool — `[{toolName, findings:[{rule, severity,
schema, path, issue, suggestion}]}]` — so that filter reaches across every tool
in one pass. Note the `?` operators: the key is **absent** when there are no
findings, and a plain `.schemaFindings[]` would error on that clean run rather
than pass it.

Only error-severity findings fail the run; warnings are reported and do not
change the exit code. Worth running in CI on any server whose tool schemas are
generated, where a dependency bump can change the emitted shape without anyone
editing a schema.

## 8. Putting it together

A complete smoke script. It bounds the connect, isolates the token store, and
fails the job on the first assertion that does not hold:

```bash
#!/usr/bin/env bash
# smoke.sh — connect → list → call → assert against an MCP server.
set -euo pipefail

SERVER_URL="${SERVER_URL:?set SERVER_URL}"
# Both, in precedence order — MCP_INSPECTOR_OAUTH_STATE_PATH is checked first,
# so an inherited one would defeat the scratch directory. See §6.
export MCP_STORAGE_DIR="$(mktemp -d)"
export MCP_INSPECTOR_OAUTH_STATE_PATH="$MCP_STORAGE_DIR/oauth.json"
trap 'rm -rf "$MCP_STORAGE_DIR"' EXIT

mcp() {
  npx --yes @modelcontextprotocol/inspector@2.5.0 --cli \
    --transport http --server-url "$SERVER_URL" \
    --connect-timeout 10000 --stored-auth-only --format json "$@"
}

# 1. Handshake.
mcp --method initialize | jq -e '.result.protocolVersion' > /dev/null
echo "ok: handshake"

# 2. The tools we depend on are present.
mcp --method tools/list \
  | jq -e --argjson want '["my_tool"]' \
      '[.result.tools[].name] as $have | $want - $have | length == 0' > /dev/null
echo "ok: tools present"

# 3. One representative call, with an assertion on the payload.
mcp --method tools/call --tool-name my_tool --tool-args-json '{"q":"ping"}' \
  | jq -e '.result.isError != true' > /dev/null
echo "ok: tools/call"

echo "smoke OK"
```

As a GitHub Actions job:

```yaml
smoke:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v7
    - uses: actions/setup-node@v7
      with:
        node-version: "22.x"
    # `bash smoke.sh`, not `./smoke.sh` — a file copied out of this guide (or
    # checked out on a runner that did not preserve the mode bit) is not
    # executable, and `./smoke.sh` fails with "Permission denied".
    - run: bash smoke.sh
      env:
        SERVER_URL: ${{ vars.MCP_SERVER_URL }}
```

The script exits non-zero on the first failed assertion, and the CLI's own exit
code propagates through `set -e`, so the job's status already carries the
result. Add the `case "$status"` block from [§5](#5-branch-on-exit-codes) when
you want the annotation to name the failure class.

## What this does not cover

- **Anything that needs a rendered UI.** For MCP App tools, `--app-info` gets
  you the security posture without a browser; rendering the widget is
  [Reviewing an MCP App](./mcp-app-review.md).
- **Streaming and session-only methods.** `--method` rejects them (e.g.
  `logging/tail`) — one CLI invocation is one request/response.
- **The Inspector's own test suite.** `scripts/smoke-cli.mjs` is an internal
  end-to-end check of the launcher → CLI path, not a template for testing your
  server; [Testing and the quality gate](./quality-gate.md) covers it.
