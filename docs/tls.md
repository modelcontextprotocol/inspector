# Serving the web UI over HTTPS

The web UI is served over plain `http` by default. Set **both** of these and it is served over `https` instead:

| Variable                  | Effect                                      |
| ------------------------- | ------------------------------------------- |
| `INSPECTOR_TLS_KEY_PATH`  | Path to the PEM private key.                |
| `INSPECTOR_TLS_CERT_PATH` | Path to the PEM certificate (or its chain). |

They work the same way for every web entry point: the production listener (`npm run web`, `mcp-inspector --web`) and Vite development (`npm run web:dev`, `cd clients/web && npm run dev`). With TLS on:

- the launch banner prints an `https://` URL;
- the default `ALLOWED_ORIGINS` list uses `https://` origins (loopback, all-interfaces, or the configured host, exactly as for `http`);
- in Vite development the UI is served over HTTP/2, falling back to HTTP/1.1.

**Startup fails instead of falling back to `http`** when only one of the two variables is set, when a file cannot be read, or when the key and certificate are not a usable pair. Each error names the variable and path to fix. A blank value counts as unset.

## A trusted local certificate with mkcert

[mkcert](https://github.com/FiloSottile/mkcert) creates a local certificate authority, installs it in your system and browser trust stores, and issues certificates from it, so the browser trusts the UI without an exception:

```sh
mkcert -install
mkcert localhost 127.0.0.1 ::1

export INSPECTOR_TLS_KEY_PATH="$PWD/localhost+2-key.pem"
export INSPECTOR_TLS_CERT_PATH="$PWD/localhost+2.pem"

npm install
npm run build
npm run web
```

The certificate covers `127.0.0.1` because that is the default `HOST`, and therefore the host the banner prints.

Check the listener independently of the browser, with verification left on:

```sh
curl --cacert "$(mkcert -CAROOT)/rootCA.pem" https://localhost:6274/
```

## A custom local hostname

To browse the UI at a name such as `inspector.test`, point the name at loopback, issue a certificate that covers it, and add its `https` origin to the allow-list:

```sh
echo "127.0.0.1 inspector.test" | sudo tee -a /etc/hosts
mkcert inspector.test localhost 127.0.0.1 ::1

export INSPECTOR_TLS_KEY_PATH="$PWD/inspector.test+3-key.pem"
export INSPECTOR_TLS_CERT_PATH="$PWD/inspector.test+3.pem"
export ALLOWED_ORIGINS="https://inspector.test:6274,https://localhost:6274,https://127.0.0.1:6274"
```

The default allow-list cannot include the name: it is built from the bind address (`127.0.0.1`), and a browser at `https://inspector.test:6274` sends that as its `Origin`, so every `/api` call is refused with `403` until it is listed. `ALLOWED_ORIGINS` **replaces** the default list, so name every origin you browse from, each with its `https://` scheme. An `http://` entry never matches a page loaded over `https`. See [Environment variables](./environment-variables.md#authentication-and-network-exposure).

## Outbound connections are separate

These variables cover the UI listener only. The Inspector connects to MCP servers and OAuth endpoints **from its Node backend**, not from the browser, so trusting a certificate in the browser does nothing for those connections. When a server you are testing has a certificate from a private CA (mkcert's included), give Node that CA:

```sh
export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
```

Node reads it once at startup and keeps verifying every other connection against its bundled CAs. See [Connecting to a server with a self-signed certificate](./environment-variables.md#connecting-to-a-server-with-a-self-signed-certificate).

⚠️ **Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0` to get past a certificate error.** It turns off verification for every TLS connection the process makes, including every OAuth authorization server and token endpoint, not only the one you are testing. A connection that should be refused as an impersonation is then accepted, and the tokens it is handed go with it. `NODE_EXTRA_CA_CERTS` is the fix. Disabling verification only hides the problem.

## The MCP Apps listeners stay on `http`

The MCP Apps sandbox (`MCP_SANDBOX_PORT`) and app-origin (`MCP_APP_ORIGIN_PORT`) listeners are not covered by these variables and keep serving plain `http`. On loopback that is still loadable from an `https` page, because the Mixed Content spec treats `http://127.0.0.1` and `http://localhost` as potentially trustworthy. On any other address the browser blocks it as mixed content. There, put an `https` reverse proxy in front of each and advertise it with `MCP_SANDBOX_FULL_ADDRESS` / `MCP_APP_ORIGIN_FULL_ADDRESS` (see [Public addresses](./environment-variables.md#public-addresses-reverse-proxy)). The Inspector warns at startup when one of those is plain `http` while `ALLOWED_ORIGINS` lists an `https` origin.
