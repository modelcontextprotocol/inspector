# Running the Inspector in Docker


A container image is published to GHCR (`ghcr.io/modelcontextprotocol/inspector`, `linux/amd64` + `linux/arm64`) by the release workflow. The [`Dockerfile`](../Dockerfile) is a two-stage build: the first stage installs and `npm pack`s the publishable tarball; the second stage `npm install -g`s that tarball, so the image ships the exact same artifact as npm, with a clean `mcp-inspector` bin.

```bash
# run the web UI (reads the auth token from the container logs)
docker run --rm -p 127.0.0.1:6274:6274 ghcr.io/modelcontextprotocol/inspector

# or build the image locally
docker build -t mcp-inspector .
docker run --rm -p 127.0.0.1:6274:6274 mcp-inspector
```

**Using the Apps tab? Publish `6275` too.** The MCP Apps sandbox is a second listener the browser reaches directly, on `MCP_SANDBOX_PORT` (default `6275`). Nothing else needs it, so the single-port commands above are fine for ordinary inspection — but the Apps tab renders a blank widget without it:

```bash
docker run --rm -p 127.0.0.1:6274:6274 -p 127.0.0.1:6275:6275 \
  ghcr.io/modelcontextprotocol/inspector
```

**And `6278` if your app declares `_meta.ui.domain`.** That is the spec field a server uses to ask its host for a stable, dedicated origin — without one the app runs at an opaque origin and its requests carry `Origin: null`, which no CORS / OAuth-callback / API-key allowlist can admit. The Inspector answers the request with a real loopback origin on a third listener, `MCP_APP_ORIGIN_PORT` (default `6278`); apps that declare no `domain` never touch it. **Publish it if you use one** — this is the one failure that does not fall back: the backend publishes fine (its listener bound inside the container), so it hands the browser a URL on a port the browser cannot reach, and that app's frame stays **blank**. The cross-origin navigation failure is not observable from the page, so there is no opaque-origin fallback and no console warning here; those cover the failures the *backend* can see (no listener, a port that never bound, an older backend). See [MCP App dedicated origins](../clients/web/README.md#mcp-app-dedicated-origins-metauidomain) for the host-specific contract and its isolation trade-offs.

```bash
docker run --rm -p 127.0.0.1:6274:6274 -p 127.0.0.1:6275:6275 -p 127.0.0.1:6278:6278 \
  ghcr.io/modelcontextprotocol/inspector
```

Publish each on the **same port number** inside and out. The sandbox URL is handed to the browser via `/api/config` as `http://localhost:<container port>/sandbox`, so remapping it (`-p 9000:6275`) advertises a port the browser can't reach; use `-e MCP_SANDBOX_PORT=9000 -p 127.0.0.1:9000:9000` instead. The same holds for the app origin: the URL a published app document is served from is built from the port the container bound, so remap with `-e MCP_APP_ORIGIN_PORT=9001 -p 127.0.0.1:9001:9001` rather than with `-p` alone.

**Behind a reverse proxy or an ingress**, where the browser reaches the listeners at public hostnames rather than at `localhost`, the same-number rule is not enough: the advertised URLs name the container's bind. Set `MCP_SANDBOX_FULL_ADDRESS` (e.g. `https://inspector-sandbox.example.com/sandbox`) and, for apps declaring `_meta.ui.domain`, `MCP_APP_ORIGIN_FULL_ADDRESS` (e.g. `https://inspector-apps.example.com`), route each to its container port, and set `ALLOWED_ORIGINS` to the public Inspector origin. Each listener needs its own hostname or port — an address sharing the Inspector's origin is refused. See [Behind a reverse proxy](../clients/web/README.md#host-binding--the-origin-allow-list) for the full contract.

**Keep the `127.0.0.1:` prefix on the published port.** A bare `-p 6274:6274` publishes on **every host interface**, putting the Inspector on your local network. The container's `HOST=0.0.0.0` is a separate concern — it governs the _container's_ interfaces, not the host's — so the `DANGEROUSLY_BIND_ALL_INTERFACES` opt-in that guards a wildcard bind outside a container does not cover this. It matters more here than for an ordinary web app: the backend spawns processes on request, `GET /` embeds the API token into the served HTML, and a request arriving with **no** `Origin` header skips the origin allow-list entirely — so for any non-browser client the API token is the only guard. Publishing wider needs a real access-control boundary in front of the Inspector — a reverse proxy that authenticates, an SSH tunnel, a private network. Setting your own `MCP_INSPECTOR_API_TOKEN` does **not** substitute: `GET /` discloses whatever token is in use, so a custom one is harvested exactly as easily as a generated one.

**Keeping the servers you add.** The Inspector saves your server list to `$HOME/.mcp-inspector/mcp.json`, which in the image is `/home/node/.mcp-inspector/mcp.json` — inside the container's writable layer, so `--rm` discards it and every run starts with an empty list. Mount a volume there to keep it:

```bash
docker run --rm -p 127.0.0.1:6274:6274 \
  -v mcp-inspector-data:/home/node/.mcp-inspector \
  ghcr.io/modelcontextprotocol/inspector
```

The same volume also persists OAuth tokens and stored state, so an authorized server stays authorized across runs. Use `-e MCP_CATALOG_PATH=/some/other/path.json` to put the catalog somewhere else — mount a volume covering whatever directory you point it at. If you **bind-mount a host directory** instead of a named volume (`-v "$PWD/inspector-data:/home/node/.mcp-inspector"`), the directory keeps its host ownership, so on Linux add `--user "$(id -u):$(id -g)"` or `chown` it to uid `1000` — otherwise the non-root `node` user can't write and adding a server fails with `EACCES`.

**Where secrets go, and how to make them survive (#1950).** The Inspector keeps an OAuth client secret, an enterprise IdP client secret and each stdio `env:` value out of `mcp.json`, in the OS keychain. A container has no keychain (the published image has no D-Bus session), so it falls back, and which fallback you get depends on whether the secrets directory is going to survive:

| Situation                                               | Store                                        | Secrets survive a restart? |
| ------------------------------------------------------- | -------------------------------------------- | -------------------------- |
| **No volume** on `/home/node/.mcp-inspector`            | Memory                                       | No — session only          |
| **With** that volume                                    | `~/.mcp-inspector/secrets.json`, mode `0600` | Yes                        |

So the same volume that keeps your server list also switches secrets from session-scoped to durable — nothing extra to configure. The in-memory default for an unmounted container is deliberate: a file in the writable layer is discarded by `--rm` and by every image update, and promising durability it can't deliver is worse than declining to. The check looks at the **directory that holds the secrets file**, so if you relocate it with `-e MCP_STORAGE_DIR=…` or `-e MCP_INSPECTOR_SECRET_FILE=…`, mount a volume at that file's parent directory. Don't bind-mount the file on its own: it is not recognized as durable, so you get the memory store, and even with `-e MCP_INSPECTOR_SECRET_STORE=file` it cannot be written, because every save replaces the file by renaming a temporary file over it.

> [!WARNING]
> **Mounting that volume turns on file storage of secrets, and without a key the file is plaintext.** Every OAuth client secret, IdP client secret and stdio `env:` value you save is then written to `secrets.json` on the volume, readable by anyone who can read the volume: root and every member of the `docker` group on the host, and anyone who gets a backup, snapshot or copy of it. Mode `0600` only keeps out other non-root users.
>
> **Give it a key, and keep that key only where the Inspector can read it.** Generate one into a file only you can read, outside the volume, backups and any repository that holds the secrets file:
>
> ```bash
> mkdir -p ~/.config/mcp-inspector
> (umask 077 && openssl rand -base64 32 > ~/.config/mcp-inspector/secret-key)
> ```
>
> Then hand it to the container **as a file** with `MCP_INSPECTOR_SECRET_KEY_FILE`, not as an environment variable:
>
> ```bash
> docker run --rm -p 127.0.0.1:6274:6274 \
>   -v mcp-inspector-data:/home/node/.mcp-inspector \
>   -v "$HOME/.config/mcp-inspector/secret-key:/run/secrets/mcp_inspector_secret_key:ro" \
>   -e MCP_INSPECTOR_SECRET_KEY_FILE=/run/secrets/mcp_inspector_secret_key \
>   ghcr.io/modelcontextprotocol/inspector
> ```
>
> Or with Compose secrets:
>
> ```yaml
> services:
>   inspector:
>     image: ghcr.io/modelcontextprotocol/inspector
>     ports: ["127.0.0.1:6274:6274"]
>     volumes: ["mcp-inspector-data:/home/node/.mcp-inspector"]
>     environment:
>       MCP_INSPECTOR_SECRET_KEY_FILE: /run/secrets/mcp_inspector_secret_key
>     secrets: [mcp_inspector_secret_key]
> secrets:
>   mcp_inspector_secret_key:
>     file: ${HOME}/.config/mcp-inspector/secret-key
> volumes:
>   mcp-inspector-data:
> ```
>
> A key passed as a file stays out of `docker inspect`, the container's environment, your shell history and the Compose file. The container runs as uid `1000`, and without Swarm, Compose secrets are bind mounts that keep the host file's owner and mode, so the `0600` file must be owned by uid `1000`. On a Linux host where your uid is not `1000`, `sudo chown 1000 ~/.config/mcp-inspector/secret-key`; if the container can't read it, the log and the settings footer say the key file could not be read. Don't loosen the mode to make it readable instead: that hands the key to every other user on the host, and anyone who also gets a copy of the secrets file can then open it. `MCP_INSPECTOR_SECRET_KEY` still works, but a key passed that way is readable by anyone who can run `docker inspect` or `docker exec` against the container. If the key file is missing, unreadable or empty, `MCP_INSPECTOR_SECRET_KEY_FILE` is set to an empty value, or it is set together with a non-blank `MCP_INSPECTOR_SECRET_KEY`, the Inspector **refuses to read or write the secrets file** rather than falling back to plaintext, and says why in the log and the settings footer.
>
> **Even encrypted, secrets on disk carry moderate risk.** Encryption protects against the file leaking **on its own**. It does not protect against anyone who can also reach the key, which on a single host usually includes root and the `docker` group. Read [what the file store protects against](./secret-storage.md#what-the-file-store-protects-against) before relying on it. If that is not acceptable, don't mount the volume (secrets then stay in memory for the session), or run the Inspector outside a container, where it uses the OS keychain.

⚠️ Keep supplying the **same** passphrase on every run: a file that can no longer be decrypted is read as empty and refuses to be written. Everything else about the store — the selection order, the file's location, encryption, permissions, locking, and choosing a store explicitly with `MCP_INSPECTOR_SECRET_STORE` — applies to every runtime and is in [Where secrets are stored](./secret-storage.md).

**Upgrading from an image before this fix?** Earlier images did not create `/home/node/.mcp-inspector`, so Docker created the volume's mount point as `root` and the non-root `node` user couldn't write to it. An **empty** volume repairs itself on the first run of a current image (Docker applies the image directory's ownership to an empty volume), but one that already has files in it keeps its old `root` ownership and still fails with `EACCES`. Fix it once:

```bash
docker run --rm -u 0 --entrypoint chown \
  -v mcp-inspector-data:/data ghcr.io/modelcontextprotocol/inspector \
  -R node:node /data
```

The image defaults to `--web` bound to `0.0.0.0:6274` with browser auto-open disabled; override the args to run another mode (`docker run --rm ghcr.io/modelcontextprotocol/inspector --cli …`). Pass `-e MCP_INSPECTOR_API_TOKEN=…` to set a known token (otherwise one is generated and printed in the logs), or `-e DANGEROUSLY_OMIT_AUTH=true` to disable auth. Binding `0.0.0.0` (all network interfaces) is refused by default outside a container — it exposes the process-spawning backend to the local network — so the image opts in explicitly with `DANGEROUSLY_BIND_ALL_INTERFACES=true` (already set in the `Dockerfile`); a bare `HOST=0.0.0.0` without that flag exits with an error. If you **remap the published port** (`-p 127.0.0.1:8080:6274`), the browser's origin (`http://localhost:8080`) no longer matches the in-container port, so set `-e ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080` (or run `-e CLIENT_PORT=8080 -p 127.0.0.1:8080:8080`) or connects will 403. `ALLOWED_ORIGINS` **replaces** the default list rather than merging, so list every loopback form you'll browse from (see the [web README](../clients/web/README.md#host-binding--the-origin-allow-list)). The image runs as the non-root `node` user and has a `HEALTHCHECK` that probes the web UI at the address `HOST` binds (a wildcard such as `0.0.0.0` is probed on loopback), so pinning `-e HOST=` to one interface keeps it valid — it assumes the default `--web` mode, so add `--no-healthcheck` when running `--cli`/`--tui` (which have no web server).

